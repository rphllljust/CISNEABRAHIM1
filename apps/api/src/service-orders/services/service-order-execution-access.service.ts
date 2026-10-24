import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import type { ClientStatus } from '../../clients/domain/client-status';
import { buildExecutionFactsComparison } from '../domain/execution-facts';
import {
  assertEvidenceKindInSnapshot,
  assertExecutionCompletePreconditions,
  assertExecutionOperationalState,
  assertExecutionStartPreconditions,
  assertUnitAllowed,
  collectSatisfiedEvidenceKinds,
  EXECUTION_COMMANDS,
  EXECUTION_ENTRY_TYPES,
  EXECUTION_RECORDING_ALLOWED_STATUSES,
  mapEntryTypeToEvidenceKind,
  ServiceOrderExecutionError,
} from '../domain/service-order-execution';
import {
  validateRecordEvidenceInput,
  validateRecordMeasuredValueInput,
  validateRecordObservationInput,
  validateRecordOccurrenceInput,
  validateRecordQuantityInput,
  validateRowVersionCommandInput,
  type RecordEvidenceInput,
  type RecordMeasuredValueInput,
  type RecordObservationInput,
  type RecordOccurrenceInput,
  type RecordQuantityInput,
  type RowVersionCommandInput,
} from '../domain/service-order-execution.validation';
import type { ServiceOrderServiceSnapshot } from '../domain/service-order-snapshot';
import { SERVICE_ORDER_STATUSES } from '../domain/service-order';
import { assertTransition, ServiceOrderStateError } from '../domain/service-order.state-machine';
import { OperationsRepository } from '../repositories/operations.repository';
import { buildActualsComparison, buildResourceSubstitutions } from '../domain/execution-actuals';
import { evaluateCompletionGate, type CompletionGate } from '../domain/completion-gate';
import {
  buildCompletionFacts,
  buildExecutedResources,
  toActualFacts,
} from './operations-facts.provider';
import type { ExecutionOperationsFacts, ExecutionActualRow } from '../repositories/operations.repository.types';
import { SERVICE_ORDERS_ERROR_CODES } from '../errors/service-orders-error-codes';
import { ServiceOrdersHttpException } from '../errors/service-orders-http.exception';
import { ServiceOrderExecutionRepository } from '../repositories/service-order-execution.repository';
import type {
  ExecutionEntryRow,
  ExecutionEvidenceRow,
  ExecutionOccurrenceRow,
} from '../repositories/service-order-execution.repository.types';
import { ResourcePlanningRepository } from '../repositories/resource-planning.repository';
import { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import type { ServiceOrderRow } from '../repositories/service-orders.repository.types';
import {
  toExecutionBundleResponse,
  toExecutionEntryResponse,
  toExecutionEvidenceResponse,
  toExecutionOccurrenceResponse,
  type ExecutionBundleResponse,
} from '../serializers/service-order-execution-response.serializer';
import { toServiceOrderDetailResponse } from '../serializers/service-orders-response.serializer';
import { ServiceOrdersAccessAuthz } from './service-orders-access.authz';
import {
  mapServiceOrderExecutionError,
  serviceOrdersAccessNotFound,
  serviceOrdersIdempotencyKeyConflict,
  serviceOrdersInvalidState,
  serviceOrdersValidationFailed,
  serviceOrdersVersionConflict,
} from './service-orders-access.errors';
import { assertValidServiceOrderId } from './service-orders-input-resolution';

@Injectable()
export class ServiceOrderExecutionAccessService {
  constructor(
    private readonly serviceOrdersRepository: ServiceOrdersRepository,
    private readonly executionRepository: ServiceOrderExecutionRepository,
    private readonly planningRepository: ResourcePlanningRepository,
    private readonly operationsRepository: OperationsRepository,
    private readonly authz: ServiceOrdersAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
    @Optional() @Inject(FAULT_INJECTION_PORT) private readonly faultInjection?: FaultInjectionPort,
  ) {}

  async getExecution(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ): Promise<ExecutionBundleResponse> {
    const order = await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.ServiceOrdersExecutionRead);
    const [entries, evidence, occurrences, planned, allocations] = await Promise.all([
      this.executionRepository.listEntries(serviceOrderId),
      this.executionRepository.listEvidence(serviceOrderId),
      this.executionRepository.listOccurrences(serviceOrderId),
      this.planningRepository.listPlannedResources(serviceOrderId),
      this.planningRepository.listAllocations(serviceOrderId),
    ]);
    const comparison = buildExecutionFactsComparison({
      snapshot: order.service_snapshot,
      plannedResources: planned.map((item) => ({
        id: item.id,
        requirementKind: item.requirement_kind,
        resourceTypeCode: item.resource_type_code,
        laborTypeCode: item.labor_type_code,
        plannedQuantity: item.planned_quantity,
        operationalStart: item.operational_start,
        operationalEnd: item.operational_end,
        status: item.status,
      })),
      allocations: allocations.map((item) => ({
        plannedResourceId: item.planned_resource_id,
        resourceTypeCode: item.resource_type_code,
        operationalStart: item.operational_start,
        operationalEnd: item.operational_end,
        status: item.status,
      })),
      entries: entries.map((item) => ({
        entryType: item.entry_type,
        quantityValue: item.quantity_value,
        quantityUnitCode: item.quantity_unit_code,
      })),
      occurrenceCount: occurrences.length,
      startedAt: order.started_at,
      completedAt: order.completed_at,
      pausedAt: order.paused_at,
    });
    return toExecutionBundleResponse(order, entries, evidence, occurrences, comparison);
  }

  async start(actor: IdentityAuthzContext, serviceOrderId: string, input: RowVersionCommandInput) {
    return this.runTransition(actor, serviceOrderId, input, 'start', AUTHZ_ACTIONS.ServiceOrdersExecutionStart);
  }

  async pause(actor: IdentityAuthzContext, serviceOrderId: string, input: RowVersionCommandInput) {
    return this.runTransition(actor, serviceOrderId, input, 'pause', AUTHZ_ACTIONS.ServiceOrdersExecutionPause);
  }

  async resume(actor: IdentityAuthzContext, serviceOrderId: string, input: RowVersionCommandInput) {
    return this.runTransition(actor, serviceOrderId, input, 'resume', AUTHZ_ACTIONS.ServiceOrdersExecutionResume);
  }

  async complete(actor: IdentityAuthzContext, serviceOrderId: string, input: RowVersionCommandInput) {
    assertValidServiceOrderId(serviceOrderId);
    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersExecutionComplete,
    );
    let validated: RowVersionCommandInput;
    try {
      validated = validateRowVersionCommandInput(input);
    } catch {
      throw serviceOrdersValidationFailed();
    }

    if (validated.idempotencyKey) {
      const existing = await this.executionRepository.findIdempotency(
        serviceOrderId,
        EXECUTION_COMMANDS.Complete,
        validated.idempotencyKey,
      );
      if (existing) {
        const history = await this.serviceOrdersRepository.listHistoryEvents(serviceOrderId);
        const refreshed = await this.serviceOrdersRepository.findById(serviceOrderId);
        return toServiceOrderDetailResponse(refreshed!, history);
      }
    }

    /**
     * ESTADO PRIMEIRO, GATE DEPOIS.
     *
     * A conclusão só é possível em `IN_EXECUTION`. `PAUSED` NÃO entra: concluir
     * durante a pausa esconderia tempo que ninguém mediu. E aqui a causa é de
     * ESTADO, não de dado faltante — devolver `COMPLETION_BLOCKED` faria o operador
     * procurar um campo quando o que falta é retomar a execução.
     *
     * A state machine é autoridade do ESTADO; o gate é autoridade dos REQUISITOS.
     */
    if (order.status !== SERVICE_ORDER_STATUSES.InExecution) {
      throw serviceOrdersInvalidState(
        'Service order is not in a valid state for this operation.',
      );
    }

    /**
     * GATE DE CONCLUSÃO — a autoridade é o DOMÍNIO, não a contagem de evidência.
     *
     * A verificação anterior olhava apenas evidência exigida pelo snapshot. Faltava
     * o que a conclusão realmente precisa: medidor final, combustível real, horas
     * por pessoa, material, assinatura e situações abertas. Sem isso era possível
     * concluir uma execução SEM NENHUM REALIZADO, e medição e custo eram produzidos
     * sobre o planejado sem que nada indicasse a falta.
     *
     * Os fatos são lidos UMA vez e o domínio decide. Os motivos voltam TODOS, para
     * que o operador resolva de uma vez em vez de descobrir um por um.
     */
    const operationsFacts = await this.operationsRepository.loadFacts(serviceOrderId);
    if (!operationsFacts) {
      throw serviceOrdersAccessNotFound();
    }

    const completionGate = evaluateCompletionGate(
      buildCompletionFacts(operationsFacts, { completionBlockedReasons: [] }),
    );

    if (!completionGate.canComplete) {
      throw this.completionBlocked(completionGate);
    }

    const [entries, evidence] = await Promise.all([
      this.executionRepository.listEntries(serviceOrderId),
      this.executionRepository.listEvidence(serviceOrderId),
    ]);
    const satisfied = collectSatisfiedEvidenceKinds({
      evidenceKinds: evidence.map((item) => item.evidence_kind),
      entryEvidenceKinds: entries.map((item) => item.evidence_kind ?? ''),
      entryTypes: entries.map(
        (item) => item.entry_type as (typeof EXECUTION_ENTRY_TYPES)[keyof typeof EXECUTION_ENTRY_TYPES],
      ),
    });

    try {
      assertExecutionCompletePreconditions(order.service_snapshot, satisfied);
    } catch (error) {
      if (error instanceof ServiceOrderExecutionError) {
        throw mapServiceOrderExecutionError(error);
      }
      throw error;
    }

    let nextStatus: string;
    try {
      nextStatus = assertTransition(order.status, 'complete');
    } catch (error) {
      if (error instanceof ServiceOrderStateError) {
        throw serviceOrdersInvalidState('Service order is not in a valid state for this operation.');
      }
      throw error;
    }
    await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ExecutionCompleteAfterValidationBeforeMutation);
    const result = await this.executionRepository.transitionExecution({
      serviceOrderId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      currentStatus: order.status,
      nextStatus,
      transition: 'complete',
      commandName: EXECUTION_COMMANDS.Complete,
      idempotencyKey: validated.idempotencyKey,
      responsePayload: {},
      /**
       * O fechamento viaja na MESMA transação. Construir o snapshot aqui (e não
       * depois do COMMIT) é o que impede a janela em que a OS já está concluída e
       * os realizados ainda podem mudar.
       */
      closure: buildExecutionClosureInput(operationsFacts, completionGate, order),
    });

    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw serviceOrdersInvalidState('Service order is not in a valid state for this operation.');
    }

    await this.audit(actor, SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionComplete, serviceOrderId, {
      rowVersion: result.rowVersion,
    });

    const history = await this.serviceOrdersRepository.listHistoryEvents(serviceOrderId);
    const refreshed = await this.serviceOrdersRepository.findById(serviceOrderId);
    return toServiceOrderDetailResponse(refreshed!, history);
  }

  async recordQuantity(actor: IdentityAuthzContext, serviceOrderId: string, input: RecordQuantityInput) {
    return this.recordMeasuredEntry(actor, serviceOrderId, input, EXECUTION_ENTRY_TYPES.Quantity, (validated) => {
      const quantity = validated as RecordQuantityInput;
      return {
        quantityValue: quantity.quantityValue,
        quantityUnitCode: quantity.unitCode,
        textValue: null,
      };
    });
  }

  async recordMileage(actor: IdentityAuthzContext, serviceOrderId: string, input: RecordMeasuredValueInput) {
    return this.recordMeasuredEntry(actor, serviceOrderId, input, EXECUTION_ENTRY_TYPES.Mileage, (validated) => {
      const measured = validated as RecordMeasuredValueInput;
      return {
        quantityValue: measured.value,
        quantityUnitCode: 'KM',
        textValue: null,
      };
    });
  }

  async recordHourMeter(actor: IdentityAuthzContext, serviceOrderId: string, input: RecordMeasuredValueInput) {
    return this.recordMeasuredEntry(actor, serviceOrderId, input, EXECUTION_ENTRY_TYPES.HourMeter, (validated) => {
      const measured = validated as RecordMeasuredValueInput;
      return {
        quantityValue: measured.value,
        quantityUnitCode: 'H',
        textValue: null,
      };
    });
  }

  async recordObservation(actor: IdentityAuthzContext, serviceOrderId: string, input: RecordObservationInput) {
    return this.recordMeasuredEntry(actor, serviceOrderId, input, EXECUTION_ENTRY_TYPES.Observation, (validated) => {
      const observation = validated as RecordObservationInput;
      return {
        quantityValue: null,
        quantityUnitCode: null,
        textValue: observation.text,
      };
    });
  }

  async recordOccurrence(actor: IdentityAuthzContext, serviceOrderId: string, input: RecordOccurrenceInput) {
    assertValidServiceOrderId(serviceOrderId);
    const order = await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.ServiceOrdersExecutionRecord);
    let validated: RecordOccurrenceInput;
    try {
      validated = validateRecordOccurrenceInput(input);
      assertExecutionOperationalState(order.status, EXECUTION_RECORDING_ALLOWED_STATUSES);
    } catch (error) {
      if (error instanceof ServiceOrderExecutionError) {
        throw mapServiceOrderExecutionError(error);
      }
      throw serviceOrdersValidationFailed();
    }

    const result = await this.executionRepository.recordOccurrence({
      serviceOrderId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      occurrenceCode: validated.occurrenceCode,
      description: validated.description,
      payload: validated.payload ?? {},
      idempotencyKey: validated.idempotencyKey,
    });

    return this.mapOccurrenceResult(result, actor, serviceOrderId);
  }

  async recordEvidence(actor: IdentityAuthzContext, serviceOrderId: string, input: RecordEvidenceInput) {
    assertValidServiceOrderId(serviceOrderId);
    const order = await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.ServiceOrdersExecutionRecord);
    let validated: RecordEvidenceInput;
    try {
      validated = validateRecordEvidenceInput(input);
      assertExecutionOperationalState(order.status, EXECUTION_RECORDING_ALLOWED_STATUSES);
      const snapshot = order.service_snapshot as unknown as ServiceOrderServiceSnapshot;
      assertEvidenceKindInSnapshot(snapshot, validated.evidenceKind);
    } catch (error) {
      if (error instanceof ServiceOrderExecutionError) {
        throw mapServiceOrderExecutionError(error);
      }
      throw serviceOrdersValidationFailed();
    }

    const result = await this.executionRepository.recordEvidence({
      serviceOrderId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      evidenceKind: validated.evidenceKind,
      payload: validated.payload,
      idempotencyKey: validated.idempotencyKey,
    });

    return this.mapEvidenceResult(result, actor, serviceOrderId);
  }

  private async runTransition(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: RowVersionCommandInput,
    transition: 'start' | 'pause' | 'resume',
    action: AuthzAction,
  ) {
    assertValidServiceOrderId(serviceOrderId);
    const order = await this.requireServiceOrder(actor, serviceOrderId, action);
    let validated: RowVersionCommandInput;
    try {
      validated = validateRowVersionCommandInput(input);
    } catch {
      throw serviceOrdersValidationFailed();
    }

    const commandName =
      transition === 'start'
        ? EXECUTION_COMMANDS.Start
        : transition === 'pause'
          ? EXECUTION_COMMANDS.Pause
          : EXECUTION_COMMANDS.Resume;

    if (validated.idempotencyKey) {
      const existing = await this.executionRepository.findIdempotency(
        serviceOrderId,
        commandName,
        validated.idempotencyKey,
      );
      if (existing) {
        const history = await this.serviceOrdersRepository.listHistoryEvents(serviceOrderId);
        const refreshed = await this.serviceOrdersRepository.findById(serviceOrderId);
        return toServiceOrderDetailResponse(refreshed!, history);
      }
    }

    let nextStatus: string;
    try {
      nextStatus = assertTransition(order.status as typeof SERVICE_ORDER_STATUSES.Released, transition);
    } catch (error) {
      if (error instanceof ServiceOrderStateError) {
        throw serviceOrdersInvalidState('Service order is not in a valid state for this operation.');
      }
      throw error;
    }

    if (transition === 'start') {
      const planned = await this.executionRepository.listPlannedResourceCoverage(serviceOrderId);
      const client = order.client_id
        ? await this.serviceOrdersRepository.findClientById(order.client_id)
        : null;
      try {
        assertExecutionStartPreconditions(
          order,
          planned.map((item) => ({
            requirementKind: item.requirement_kind,
            resourceTypeCode: item.resource_type_code,
            laborTypeCode: item.labor_type_code,
            plannedQuantity: item.planned_quantity,
            status: item.status,
          })),
          client ? { id: client.id, status: client.status as ClientStatus } : null,
        );
      } catch (error) {
        if (error instanceof ServiceOrderExecutionError) {
          throw mapServiceOrderExecutionError(error);
        }
        throw error;
      }
    }

    const result = await this.executionRepository.transitionExecution({
      serviceOrderId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      currentStatus: order.status,
      nextStatus,
      transition,
      commandName,
      idempotencyKey: validated.idempotencyKey,
      responsePayload: {},
    });

    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw serviceOrdersInvalidState('Service order is not in a valid state for this operation.');
    }

    const auditAction =
      transition === 'start'
        ? SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionStart
        : transition === 'pause'
          ? SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionPause
          : SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionResume;
    await this.audit(actor, auditAction, serviceOrderId, { rowVersion: result.rowVersion });

    const history = await this.serviceOrdersRepository.listHistoryEvents(serviceOrderId);
    const refreshed = await this.serviceOrdersRepository.findById(serviceOrderId);
    return toServiceOrderDetailResponse(refreshed!, history);
  }

  private async recordMeasuredEntry(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: RecordQuantityInput | RecordMeasuredValueInput | RecordObservationInput,
    entryType: (typeof EXECUTION_ENTRY_TYPES)[keyof typeof EXECUTION_ENTRY_TYPES],
    mapValues: (
      validated: RecordQuantityInput | RecordMeasuredValueInput | RecordObservationInput,
    ) => { quantityValue: string | null; quantityUnitCode: string | null; textValue: string | null },
  ) {
    assertValidServiceOrderId(serviceOrderId);
    const order = await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.ServiceOrdersExecutionRecord);
    let validated: RecordQuantityInput | RecordMeasuredValueInput | RecordObservationInput;
    try {
      if (entryType === EXECUTION_ENTRY_TYPES.Quantity) {
        validated = validateRecordQuantityInput(input);
        const snapshot = order.service_snapshot as unknown as ServiceOrderServiceSnapshot;
        assertUnitAllowed(snapshot, validated.unitCode);
      } else if (entryType === EXECUTION_ENTRY_TYPES.Observation) {
        validated = validateRecordObservationInput(input);
      } else {
        validated = validateRecordMeasuredValueInput(input);
      }
      assertExecutionOperationalState(order.status, EXECUTION_RECORDING_ALLOWED_STATUSES);
      const evidenceKind = mapEntryTypeToEvidenceKind(entryType);
      if (evidenceKind) {
        const snapshot = order.service_snapshot as unknown as ServiceOrderServiceSnapshot;
        assertEvidenceKindInSnapshot(snapshot, evidenceKind);
      }
    } catch (error) {
      if (error instanceof ServiceOrderExecutionError) {
        throw mapServiceOrderExecutionError(error);
      }
      throw serviceOrdersValidationFailed();
    }

    const values = mapValues(validated);
    const result = await this.executionRepository.recordEntry({
      serviceOrderId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      entryType,
      evidenceKind: mapEntryTypeToEvidenceKind(entryType),
      quantityValue: values.quantityValue,
      quantityUnitCode: values.quantityUnitCode,
      textValue: values.textValue,
      context: 'context' in validated && validated.context ? validated.context : {},
      idempotencyKey: validated.idempotencyKey,
    });

    return this.mapEntryResult(result, actor, serviceOrderId);
  }

  private async mapEntryResult(
    result: Awaited<ReturnType<ServiceOrderExecutionRepository['recordEntry']>>,
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ) {
    if (result.outcome === 'idempotent') {
      return { entry: toExecutionEntryResponse(result.payload.entry as ExecutionEntryRow), rowVersion: null };
    }
    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'idempotency_conflict') {
      throw serviceOrdersIdempotencyKeyConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw serviceOrdersInvalidState('Service order is not in a valid state for this operation.');
    }
    await this.audit(actor, SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionRecord, serviceOrderId, {
      entryId: result.entry.id,
    });
    return { entry: toExecutionEntryResponse(result.entry), rowVersion: result.rowVersion };
  }

  private async mapEvidenceResult(
    result: Awaited<ReturnType<ServiceOrderExecutionRepository['recordEvidence']>>,
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ) {
    if (result.outcome === 'idempotent') {
      return {
        evidence: toExecutionEvidenceResponse(result.payload.evidence as ExecutionEvidenceRow),
        rowVersion: null,
      };
    }
    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'idempotency_conflict') {
      throw serviceOrdersIdempotencyKeyConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw serviceOrdersInvalidState('Service order is not in a valid state for this operation.');
    }
    await this.audit(actor, SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionRecord, serviceOrderId, {
      evidenceId: result.evidence.id,
    });
    return { evidence: toExecutionEvidenceResponse(result.evidence), rowVersion: result.rowVersion };
  }

  private async mapOccurrenceResult(
    result: Awaited<ReturnType<ServiceOrderExecutionRepository['recordOccurrence']>>,
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ) {
    if (result.outcome === 'idempotent') {
      return {
        occurrence: toExecutionOccurrenceResponse(result.payload.occurrence as ExecutionOccurrenceRow),
        rowVersion: null,
      };
    }
    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'idempotency_conflict') {
      throw serviceOrdersIdempotencyKeyConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw serviceOrdersInvalidState('Service order is not in a valid state for this operation.');
    }
    await this.audit(actor, SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionRecord, serviceOrderId, {
      occurrenceId: result.occurrence.id,
    });
    return { occurrence: toExecutionOccurrenceResponse(result.occurrence), rowVersion: result.rowVersion };
  }

  private async requireServiceOrder(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    action: AuthzAction,
  ): Promise<ServiceOrderRow> {
    const row = await this.serviceOrdersRepository.findById(serviceOrderId);
    if (!row) {
      throw serviceOrdersAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, action, row);
    return row;
  }

  private async audit(
    actor: IdentityAuthzContext,
    action: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
    serviceOrderId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata,
    });
  }

  /**
   * Conclusão recusada pelo GATE.
   *
   * `409 CONFLICT` com código próprio e os motivos no corpo: o estado do negócio
   * impede, e o operador precisa saber EXATAMENTE o que falta. Devolver um 400
   * genérico obrigaria a tela a traduzir, e é assim que a causa se perde.
   */
  private completionBlocked(gate: CompletionGate): ServiceOrderCompletionBlockedException {
    return new ServiceOrderCompletionBlockedException(gate);
  }
}

/**
 * Conclusão recusada — com os MOTIVOS no corpo do erro.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA CLASSE EXISTE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * O corpo de erro do projeto é `{ error: { code, message } }` e não tem onde
 * carregar a lista de bloqueios. Devolver só a frase faria o operador recarregar a
 * tela para descobrir o que falta — o comportamento que esta capability elimina.
 *
 * A subclasse acrescenta `details` e `resolution` ao MESMO envelope, então nenhum
 * consumidor existente quebra: quem lê `code`/`message` continua igual, e quem quer
 * a lista passa a ter.
 */
export class ServiceOrderCompletionBlockedException extends ServiceOrdersHttpException {
  constructor(readonly gate: CompletionGate) {
    super(409, SERVICE_ORDERS_ERROR_CODES.COMPLETION_BLOCKED, gate.summary);
  }

  override getResponse(): Record<string, unknown> {
    const base = super.getResponse() as Record<string, unknown>;
    const error = (base['error'] ?? {}) as Record<string, unknown>;
    return {
      ...base,
      error: {
        ...error,
        details: {
          blockingReasons: this.gate.blockingReasons.map((item) => ({
            code: item.reasonCode,
            message: item.reason,
            missingCode: item.missingCode,
            resourceCode: item.resource?.code ?? null,
            resolution: item.resolution,
          })),
          canComplete: this.gate.canComplete,
        },
        resolution: {
          command: this.gate.nextAction,
          label: this.gate.nextActionLabel,
        },
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MONTAGEM DO FECHAMENTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Materializa o que a conclusão CONGELA.
 *
 * Três artefatos, cada um com um consumidor real:
 *
 *   `actualsSnapshot`  → o realizado no instante do fechamento. É o que o COSTING
 *                        consome e o que impede variação retroativa.
 *   `planVsActual`     → a comparação planejado × realizado, com substituições.
 *   `measurementLines` → a BASE DE MEDIÇÃO por unidade. É o insumo da capability
 *                        seguinte; sem ela, "pronto para medir" seria só um rótulo.
 *
 * A função é PURA: recebe fatos e o gate, devolve o registro. Não consulta banco.
 */
export function buildExecutionClosureInput(
  facts: ExecutionOperationsFacts,
  gate: CompletionGate,
  order: { unit_id: string; client_id: string | null; order_number: string },
): {
  unitId: string;
  clientId: string | null;
  orderNumber: string;
  actualsSnapshot: Record<string, unknown>;
  planVsActual: Record<string, unknown>;
  evidenceSummary: Record<string, unknown>;
  resolvedSituations: unknown[];
  measurementLines: unknown[];
  measurementActuals: Record<string, unknown>;
  measurementEvidence: Record<string, unknown>;
} {
  const actualFacts = toActualFacts(facts);
  const substitutes = buildResourceSubstitutions(buildExecutedResources(facts));

  // Planejado por tipo, para a comparação congelada.
  const planned: Record<string, { quantity: string; unitOfMeasure: string }> = {};
  const plannedLabor = facts.plannedResources
    .filter((row) => row.status === 'PLANNED' && row.requirement_kind === 'LABOR')
    .reduce((sum, row) => sum + Number(row.planned_quantity), 0);
  if (plannedLabor > 0) {
    planned['LABOR_HOURS'] = { quantity: String(plannedLabor), unitOfMeasure: 'H' };
  }

  const comparison = buildActualsComparison({
    actuals: actualFacts,
    planned,
    substitutions: substitutes,
  });

  /**
   * BASE DE MEDIÇÃO — uma linha por unidade de medida do realizado.
   *
   * A quantidade MEDIDA é o valor real; o planejado acompanha como referência. Não
   * há preço aqui: precificação é da MEDIÇÃO/BILLING, não da execução.
   */
  const byUnit = new Map<string, { actual: number; planned: number; count: number }>();
  for (const row of facts.actuals) {
    const bucket = byUnit.get(row.unit_of_measure) ?? { actual: 0, planned: 0, count: 0 };
    bucket.actual += Number(row.actual_value);
    bucket.planned += Number(row.planned_value ?? '0');
    bucket.count += 1;
    byUnit.set(row.unit_of_measure, bucket);
  }

  const measurementLines = [...byUnit.entries()].map(([unitCode, bucket]) => ({
    unitCode,
    actualQuantity: String(bucket.actual),
    plannedQuantity: bucket.planned > 0 ? String(bucket.planned) : null,
    recordCount: bucket.count,
    source: 'EXECUTION_ACTUALS',
  }));

  const verifiedEvidence = facts.evidence.filter((row) => row.status === 'VERIFIED');

  return {
    unitId: order.unit_id,
    clientId: order.client_id,
    orderNumber: order.order_number,
    actualsSnapshot: {
      recordCount: facts.actuals.length,
      meters: facts.meters.length,
      fuelRecords: facts.fuel.length,
      signatures: facts.signatures.length,
      capturedAt: new Date().toISOString(),
      byKind: summariseByKind(facts.actuals),
    },
    planVsActual: {
      lines: comparison.lines.map((line) => ({
        group: line.group,
        actualValue: line.actualValue,
        plannedValue: line.plannedValue,
        variance: line.variance,
        explainable: line.explainable,
      })),
      substitutions: comparison.substitutions,
      summary: comparison.summary,
    },
    evidenceSummary: {
      total: facts.evidence.length,
      verified: verifiedEvidence.length,
      kinds: [...new Set(facts.evidence.map((row) => row.evidence_kind))],
    },
    resolvedSituations: gate.blockingReasons.map((item) => ({
      reasonCode: item.reasonCode,
      resolution: item.resolution,
    })),
    measurementLines,
    measurementActuals: Object.fromEntries(
      [...byUnit.entries()].map(([unitCode, bucket]) => [
        unitCode,
        String(bucket.actual),
      ]),
    ),
    measurementEvidence: {
      verifiedKinds: [...new Set(verifiedEvidence.map((row) => row.evidence_kind))],
    },
  };
}

function summariseByKind(rows: ExecutionActualRow[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const row of rows) {
    summary[row.actual_kind] = (summary[row.actual_kind] ?? 0) + Number(row.actual_value);
  }
  return summary;
}

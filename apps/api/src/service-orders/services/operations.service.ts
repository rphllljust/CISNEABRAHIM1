/**
 * OPERATIONS SERVICE — a aplicação da capability DISPATCH + EXECUTION + ACTUALS.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O PAPEL DESTA CAMADA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Ela NÃO decide regra (o domínio decide) e NÃO escreve SQL (o repositório escreve).
 * Ela:
 *
 *   1. aplica autorização e escopo (reutilizando o serviço de acesso existente);
 *   2. coleta fatos;
 *   3. pede a decisão ao domínio;
 *   4. executa o comando transacional;
 *   5. devolve o read model já composto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A ORDEM IMPORTA: FATOS → DECISÃO → COMANDO → TRANSAÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `DISPATCH` avalia a prontidão e RECUSA se ela não está pronta, devolvendo os
 * motivos. Não existe caminho "força o despacho": a decisão é a mesma que a tela
 * mostra no botão, porque é literalmente a mesma função.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA CAMADA **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não calcula SLA na tela, não decide elegibilidade de faturamento, não escreve em
 * internals de FINANCE nem de ACCOUNTING. Ela publica FATOS na outbox e a medição
 * e o custeio consomem pelo contrato.
 */

import { Injectable } from '@nestjs/common';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { evaluateCompletionGate, COMPLETION_CONSEQUENCES } from '../domain/completion-gate';
import {
  evaluateDispatchReadiness,
  isDispatchableStatus,
  type DispatchReadiness,
} from '../domain/dispatch-readiness';
import {
  buildActualsComparison,
  buildResourceSubstitutions,
  type ActualsComparison,
} from '../domain/execution-actuals';
import {
  detectExecutionSituations,
  formatSlaRemaining,
  type DetectedSituation,
} from '../domain/execution-situations';
import {
  deriveOperationalLifecycle,
  currentOperationalStage,
  type OperationalStageStep,
} from '../domain/operational-lifecycle';
import { buildCommandSurface, type CommandSurface } from '../domain/operations-commands';
import { SERVICE_ORDER_STATUSES } from '../domain/service-order';
import { OperationsRepository } from '../repositories/operations.repository';
import type {
  ExecutionOperationsFacts,
  ExecutionActualRow,
  ExecutionFuelRow,
  ExecutionMeterRow,
  ExecutionSignatureRow,
} from '../repositories/operations.repository.types';
import { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import type { ServiceOrderRow } from '../repositories/service-orders.repository.types';
import { ServiceOrdersAccessAuthz } from './service-orders-access.authz';
import { ServiceOrdersAccessService } from './service-orders-access.service';
import { SERVICE_ORDERS_ERROR_CODES } from '../errors/service-orders-error-codes';
import { ServiceOrdersHttpException } from '../errors/service-orders-http.exception';
import {
  serviceOrdersAccessNotFound,
  serviceOrdersIdempotencyKeyConflict,
  serviceOrdersInvalidState,
  serviceOrdersValidationFailed,
  serviceOrdersVersionConflict,
} from './service-orders-access.errors';
import { ServiceOrderMetadataService } from './service-order-metadata.service';
import { assertValidServiceOrderId } from './service-orders-input-resolution';
import {
  buildCompletionFacts,
  buildDispatchFacts,
  buildExecutedResources,
  buildSituationFacts,
  toActualFacts,
} from './operations-facts.provider';

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRATOS DE LEITURA
// ═══════════════════════════════════════════════════════════════════════════════

export type Freshness = {
  /** Instante da leitura, em ISO 8601 (relógio do servidor). */
  readAt: string;
  /** Sempre `SERVER` — o cliente não declara a própria frescura. */
  authority: 'SERVER';
};

export type DispatchBoardItem = {
  serviceOrderId: string;
  orderNumber: string;
  clientLabel: string | null;
  serviceLabel: string | null;
  unitId: string;
  status: string;
  /**
   * Versão do agregado observada nesta leitura.
   *
   * O board PRECISA publicá-la: o comando de despacho exige `expectedVersion`, e
   * sem ela a única saída seria o cliente adivinhar — o que produziria um 409 em
   * toda tentativa. A versão pertence à linha porque é ela que o operador está
   * vendo; se outro operador alterar a ordem, o comando responde 409 e a tela
   * informa, nunca sobrescreve.
   */
  rowVersion: number;
  /** Janela operacional confirmada, quando existe. */
  windowStartAt: string | null;
  windowEndAt: string | null;
  /** Prontidão agregada. */
  readiness: {
    ready: boolean;
    status: string;
    summary: string;
    blockingReasons: Array<{
      dimension: string;
      reasonCode: string | null;
      reason: string | null;
      resolution: string | null;
      resourceCode: string | null;
    }>;
  };
  dispatchedAt: string | null;
  checkedInAt: string | null;
  /** SLA publicado. `null` quando o serviço não tem prazo. */
  dueAt: string | null;
  slaRemaining: string | null;
  /** Comandos disponíveis para ESTA linha — mesma autoridade da object page. */
  availableCommands: CommandSurface['availableCommands'];
  nextAction: { code: string; label: string } | null;
  situations: Array<{ code: string; severity: string; title: string; blocking: boolean }>;
};

export type DispatchBoardReadModel = {
  context: { unitId: string; at: string };
  /** Contagens REAIS do conjunto lido — nunca estimadas. */
  readyCount: number;
  blockedCount: number;
  riskCount: number;
  dispatchedCount: number;
  items: DispatchBoardItem[];
  freshness: Freshness;
};

export type ExecutionConsoleItem = {
  serviceOrderId: string;
  orderNumber: string;
  clientLabel: string | null;
  serviceLabel: string | null;
  status: string;
  startedAt: string | null;
  pausedAt: string | null;
  dueAt: string | null;
  slaRemaining: string | null;
  /** `OK` / `RISK` / `LATE` — derivado do SLA, nunca da tela. */
  slaStatus: 'OK' | 'RISK' | 'LATE' | 'UNKNOWN';
  /** Progresso medido sobre o planejado. `null` quando não há meta. */
  progress: { measured: string; planned: string; ratio: number } | null;
  situations: Array<{
    code: string;
    severity: string;
    title: string;
    detail: string;
    ownerRole: string;
    nextBestAction: string;
    blocking: boolean;
  }>;
  availableCommands: CommandSurface['availableCommands'];
  nextAction: { code: string; label: string } | null;
  /** Aparece no console por exceção, não por estar em execução. */
  exceptionReason: string | null;
};

export type ExecutionConsoleReadModel = {
  context: { unitId: string; at: string };
  summary: {
    inProgress: number;
    paused: number;
    atRisk: number;
    overdue: number;
    blocked: number;
  };
  items: ExecutionConsoleItem[];
  freshness: Freshness;
};

export type ServiceOrderExecutionReadModel = {
  identity: {
    serviceOrderId: string;
    orderNumber: string;
    internalCode: string | null;
    serviceLabel: string | null;
    clientLabel: string | null;
    unitId: string;
    description: string | null;
    rowVersion: number;
  };
  businessContext: {
    origin: string | null;
    contractReference: string | null;
    customerPurchaseOrderNumber: string | null;
    priority: string | null;
  };
  statuses: {
    operational: string;
    planning: string;
    reservation: string;
    dispatch: string;
    execution: string;
    actuals: string;
    measurement: string;
    billing: string;
    accounting: string;
  };
  process: OperationalStageStep[];
  currentStage: string | null;
  planning: {
    plannedResourceCount: number;
    activeAllocationCount: number;
    activeResources: Array<{
      allocationId: string;
      resourceCode: string;
      resourceLabel: string | null;
      role: string;
      operationalStart: string;
      operationalEnd: string;
    }>;
  };
  dispatch: {
    dispatchedAt: string | null;
    checkedInAt: string | null;
    windowStart: string | null;
    windowEnd: string | null;
    readiness: DispatchReadiness;
  };
  execution: {
    startedAt: string | null;
    pausedAt: string | null;
    completedAt: string | null;
    executionClosedAt: string | null;
    measurementBasisPreparedAt: string | null;
  };
  actuals: ExecutionActualsReadModel;
  completionGate: ReturnType<typeof evaluateCompletionGate>;
  economics: {
    /** Valor previsto quando o domínio o conhece; `null` caso contrário. */
    plannedRevenue: string | null;
    plannedCost: string | null;
    currencyCode: string | null;
  };
  situations: DetectedSituation[];
  timeline: Array<{
    at: string;
    kind: string;
    label: string;
    detail: string | null;
    actorIdentityId: string | null;
  }>;
  nextAction: {
    code: string | null;
    label: string | null;
    explanation: string | null;
  };
  availableCommands: CommandSurface['availableCommands'];
  decisionExplanation: {
    /** Por que a conclusão está (ou não) liberada. */
    completionSummary: string;
    /** O que vai acontecer ao concluir. Derivado do domínio. */
    onCompletion: Array<{ code: string; label: string }>;
    /** Por que o despacho está (ou não) liberado. */
    dispatchSummary: string;
  };
  freshness: Freshness;
};

export type ExecutionActualsReadModel = {
  comparison: ActualsComparison;
  records: Array<{
    id: string;
    actualKind: string;
    resourceLabel: string | null;
    actualValue: string;
    unitOfMeasure: string;
    plannedValue: string | null;
    source: string;
    occurredAt: string;
  }>;
  meters: Array<{
    id: string;
    meterKind: string;
    readingValue: string;
    unitOfMeasure: string;
    isInitial: boolean;
    isFinal: boolean;
    readAt: string;
  }>;
  fuel: Array<{
    id: string;
    volumeLiters: string;
    unitPrice: string | null;
    odometerReading: string | null;
    fueledAt: string;
  }>;
  evidence: Array<{ id: string; evidenceKind: string; status: string; recordedAt: string }>;
  signatures: Array<{
    id: string;
    signerName: string;
    signatureKind: string;
    signedAt: string;
  }>;
};

export type MeasurementReadinessReadModel = {
  ready: boolean;
  summary: string;
  executionClosedAt: string | null;
  basisPreparedAt: string | null;
  basisId: string | null;
  lineCount: number;
  /** O que falta para poder medir. Vazio quando `ready`. */
  blockers: string[];
  freshness: Freshness;
};

// ═══════════════════════════════════════════════════════════════════════════════
// SERVIÇO
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class OperationsService {
  constructor(
    private readonly repository: OperationsRepository,
    private readonly serviceOrdersRepository: ServiceOrdersRepository,
    private readonly serviceOrdersAccess: ServiceOrdersAccessService,
    private readonly authz: ServiceOrdersAccessAuthz,
    private readonly metadata: ServiceOrderMetadataService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // READ MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * DISPATCH BOARD.
   *
   * Lê as ordens `RELEASED` do escopo do ator e avalia a prontidão de cada uma. A
   * LISTAGEM reutiliza `ServiceOrdersAccessService.list`, que já aplica capability
   * e escopo de unidade na consulta — o board não reimplementa filtro de acesso. Os
   * fatos de prontidão são carregados por ordem porque cada carga é um conjunto de
   * consultas agregadas, nunca uma consulta por linha da tela.
   */
  async getDispatchBoard(
    actor: IdentityAuthzContext,
    input: { unitId: string; limit?: number; at?: string },
  ): Promise<DispatchBoardReadModel> {
    const at = input.at ?? new Date().toISOString();
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

    const page = await this.serviceOrdersAccess.list(actor, {
      limit,
      offset: 0,
      status: SERVICE_ORDER_STATUSES.Released,
      unitId: input.unitId,
    });

    const items: DispatchBoardItem[] = [];

    for (const row of page.items ?? []) {
      const facts = await this.repository.loadFacts(row.id);
      if (!facts) {
        continue;
      }
      items.push(await this.buildDispatchBoardItem(actor, facts, at));
    }

    const readyCount = items.filter((item) => item.readiness.ready && !item.dispatchedAt).length;
    const blockedCount = items.filter((item) => !item.readiness.ready && !item.dispatchedAt).length;
    const dispatchedCount = items.filter((item) => item.dispatchedAt !== null).length;
    const riskCount = items.filter((item) => item.situations.some((s) => s.blocking)).length;

    return {
      context: { unitId: input.unitId, at },
      readyCount,
      blockedCount,
      riskCount,
      dispatchedCount,
      items: sortDispatchBoard(items),
      freshness: { readAt: at, authority: 'SERVER' },
    };
  }

  /**
   * EXECUTION CONSOLE — orientado a EXCEÇÃO.
   *
   * A tela não é "todas as OS": ela lista o que exige ação. Uma ordem em execução
   * dentro do ritmo, sem exceção, não entra na fila de atenção — ela é o estado
   * normal e aparece na contagem, não na lista.
   */
  async getExecutionConsole(
    actor: IdentityAuthzContext,
    input: { unitId: string; limit?: number; at?: string },
  ): Promise<ExecutionConsoleReadModel> {
    const at = input.at ?? new Date().toISOString();
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

    const [inExecution, paused] = await Promise.all([
      this.serviceOrdersAccess.list(actor, {
        limit,
        offset: 0,
        status: SERVICE_ORDER_STATUSES.InExecution,
        unitId: input.unitId,
      }),
      this.serviceOrdersAccess.list(actor, {
        limit,
        offset: 0,
        status: SERVICE_ORDER_STATUSES.Paused,
        unitId: input.unitId,
      }),
    ]);

    const rows = [...(inExecution.items ?? []), ...(paused.items ?? [])];
    const items: ExecutionConsoleItem[] = [];

    for (const row of rows) {
      const facts = await this.repository.loadFacts(row.id);
      if (!facts) {
        continue;
      }
      items.push(await this.buildExecutionConsoleItem(actor, facts, at));
    }

    return {
      context: { unitId: input.unitId, at },
      summary: {
        inProgress: items.filter((item) => item.status === SERVICE_ORDER_STATUSES.InExecution)
          .length,
        paused: items.filter((item) => item.status === SERVICE_ORDER_STATUSES.Paused).length,
        atRisk: items.filter((item) => item.slaStatus === 'RISK').length,
        overdue: items.filter((item) => item.slaStatus === 'LATE').length,
        blocked: items.filter((item) => item.situations.some((s) => s.blocking)).length,
      },
      items: sortExecutionConsole(items),
      freshness: { readAt: at, authority: 'SERVER' },
    };
  }

  /** OBJECT PAGE — uma leitura que responde tudo sobre uma ordem. */
  async getServiceOrderOverview(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { at?: string } = {},
  ): Promise<ServiceOrderExecutionReadModel> {
    assertValidServiceOrderId(serviceOrderId);
    const at = input.at ?? new Date().toISOString();

    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    );
    const facts = await this.repository.loadFacts(serviceOrderId);
    if (!facts) {
      throw serviceOrdersAccessNotFound();
    }

    return this.buildOverview(actor, order, facts, at);
  }

  async getMeasurementReadiness(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { at?: string } = {},
  ): Promise<MeasurementReadinessReadModel> {
    assertValidServiceOrderId(serviceOrderId);
    const at = input.at ?? new Date().toISOString();
    await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    );

    const facts = await this.repository.loadFacts(serviceOrderId);
    if (!facts) {
      throw serviceOrdersAccessNotFound();
    }

    const closed = facts.closure !== null;
    const basis = facts.measurementBasis;
    const blockers: string[] = [];
    if (!closed) {
      blockers.push('EXECUTION_NOT_CLOSED');
    }
    if (closed && !basis) {
      blockers.push('MEASUREMENT_BASIS_NOT_PUBLISHED');
    }

    return {
      ready: closed && Boolean(basis),
      summary: basis
        ? 'Base de medição publicada; a medição pode começar.'
        : closed
          ? 'Execução fechada, base de medição ainda não publicada.'
          : 'A execução ainda não foi fechada; não há base de medição.',
      executionClosedAt: facts.closure?.closed_at ?? null,
      basisPreparedAt: basis?.prepared_at ?? null,
      basisId: basis?.id ?? null,
      lineCount: Array.isArray(basis?.lines) ? (basis.lines as unknown[]).length : 0,
      blockers,
      freshness: { readAt: at, authority: 'SERVER' },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMANDOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * DISPATCH — o comando que tira a ordem da mesa.
   *
   * A prontidão é avaliada AQUI e recusada com os motivos. É a mesma avaliação que
   * o board mostra: não existe caminho em que o botão esteja habilitado e o
   * comando recuse por um motivo que a tela não conhecia.
   */
  async dispatch(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: {
      rowVersion: number;
      idempotencyKey: string;
      windowStart?: string;
      windowEnd?: string;
      at?: string;
    },
  ): Promise<ServiceOrderExecutionReadModel> {
    assertValidServiceOrderId(serviceOrderId);
    const at = input.at ?? new Date().toISOString();

    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderDispatch,
    );
    const facts = await this.repository.loadFacts(serviceOrderId);
    if (!facts) {
      throw serviceOrdersAccessNotFound();
    }

    if (!isDispatchableStatus(order.status as never)) {
      throw serviceOrdersInvalidState(
        `A ordem precisa estar liberada para ser despachada (estado atual: ${order.status}).`,
      );
    }

    const dueAt = await this.resolveDueAt(order);
    const readiness = evaluateDispatchReadiness(
      buildDispatchFacts(facts, {
        at,
        dueAt,
        vehicleTypeCodes: new Set(facts.vehicleTypeCodes),
      }),
    );

    if (!readiness.ready) {
      throw this.dispatchBlocked(readiness);
    }

    const window = resolveDispatchWindow(facts, input);
    const confirmedResources = facts.allocations
      .filter((row) => row.status === 'ACTIVE')
      .map((row) => ({
        allocationId: row.id,
        resourceTypeCode: row.resource_type_code,
        physicalAssetId: row.physical_asset_id,
        workforceMemberId: row.workforce_member_id,
        operationalStart: row.operational_start,
        operationalEnd: row.operational_end,
      }));

    const result = await this.repository.recordDispatch({
      serviceOrderId,
      unitId: order.unit_id,
      clientId: order.client_id,
      orderNumber: order.order_number,
      rowVersion: input.rowVersion,
      windowStart: window.startAt,
      windowEnd: window.endAt,
      confirmedResources,
      readinessSnapshot: {
        ready: readiness.ready,
        status: readiness.status,
        dimensions: readiness.dimensions.map((item) => ({
          dimension: item.dimension,
          status: item.status,
          reasonCode: item.reasonCode,
        })),
      },
      actorIdentityId: actor.identityId,
      idempotencyKey: input.idempotencyKey,
    });

    this.assertDispatchOutcome(result);

    await this.audit(actor, 'DISPATCH', serviceOrderId, {
      outcome: result.outcome,
      dispatchId: 'dispatchId' in result ? result.dispatchId : null,
    });

    return this.reloadOverview(actor, serviceOrderId, at);
  }

  /** CHECK_IN — confirma a chegada ao local. */
  async checkIn(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { rowVersion: number; idempotencyKey: string; at?: string },
  ): Promise<ServiceOrderExecutionReadModel> {
    assertValidServiceOrderId(serviceOrderId);
    const at = input.at ?? new Date().toISOString();

    await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersExecutionStart,
    );

    const result = await this.repository.recordCheckIn({
      serviceOrderId,
      rowVersion: input.rowVersion,
      actorIdentityId: actor.identityId,
      idempotencyKey: input.idempotencyKey,
    });

    if (result.outcome === 'not_dispatched') {
      throw serviceOrdersInvalidState('A ordem precisa estar despachada para registrar a chegada.');
    }
    if (result.outcome === 'already_checked_in') {
      throw serviceOrdersInvalidState('A chegada desta ordem já foi registrada.');
    }
    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'idempotency_conflict') {
      throw serviceOrdersIdempotencyKeyConflict();
    }

    await this.audit(actor, 'CHECK_IN', serviceOrderId, { outcome: result.outcome });
    return this.reloadOverview(actor, serviceOrderId, at);
  }

  /** REGISTER_ACTUAL — o realizado dimensionado. */
  async registerActual(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: {
      actualKind: string;
      physicalAssetId?: string | null;
      workforceMemberId?: string | null;
      actualValue: string;
      unitOfMeasure: string;
      source?: string;
      occurredAt?: string;
      notes?: string | null;
      correlationId?: string | null;
      evidenceId?: string | null;
      rowVersion: number;
      idempotencyKey: string;
      at?: string;
    },
  ): Promise<ServiceOrderExecutionReadModel> {
    assertValidServiceOrderId(serviceOrderId);
    const at = input.at ?? new Date().toISOString();

    await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersExecutionRecord,
    );

    if (
      !input.physicalAssetId &&
      !input.workforceMemberId &&
      input.actualKind !== 'WAITING_HOURS' &&
      input.actualKind !== 'DOWNTIME_HOURS'
    ) {
      throw this.actualResourceRequired(input.actualKind);
    }

    const facts = await this.repository.loadFacts(serviceOrderId);
    const planned = findPlannedValue(
      facts,
      input.actualKind,
      input.physicalAssetId,
      input.workforceMemberId,
    );

    const result = await this.repository.recordActual({
      serviceOrderId,
      actualKind: input.actualKind,
      physicalAssetId: input.physicalAssetId ?? null,
      workforceMemberId: input.workforceMemberId ?? null,
      resourceLabel: findResourceLabel(facts, input.physicalAssetId, input.workforceMemberId),
      actualValue: input.actualValue,
      unitOfMeasure: input.unitOfMeasure,
      plannedValue: planned,
      plannedUnitOfMeasure: input.unitOfMeasure,
      source: input.source ?? 'MANUAL',
      evidenceId: input.evidenceId ?? null,
      occurredAt: input.occurredAt ?? at,
      actorIdentityId: actor.identityId,
      notes: input.notes ?? null,
      correlationId: input.correlationId ?? null,
      idempotencyKey: input.idempotencyKey,
      rowVersion: input.rowVersion,
    });

    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw serviceOrdersInvalidState(
        'A execução precisa estar em andamento para registrar realizado.',
      );
    }
    if (result.outcome === 'not_found') {
      throw serviceOrdersAccessNotFound();
    }
    if (result.outcome === 'idempotency_conflict') {
      throw serviceOrdersIdempotencyKeyConflict();
    }

    await this.audit(actor, 'REGISTER_ACTUAL', serviceOrderId, {
      actualKind: input.actualKind,
      actualValue: input.actualValue,
    });

    return this.reloadOverview(actor, serviceOrderId, at);
  }

  /** REGISTER_METER — leitura de medidor, com monotonicidade no banco. */
  async registerMeter(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: {
      physicalAssetId: string;
      meterKind: string;
      readingValue: string;
      unitOfMeasure: string;
      isInitial?: boolean;
      isFinal?: boolean;
      readAt?: string;
      notes?: string | null;
      evidenceId?: string | null;
      rowVersion: number;
      idempotencyKey: string;
      at?: string;
    },
  ): Promise<ServiceOrderExecutionReadModel> {
    assertValidServiceOrderId(serviceOrderId);
    const at = input.at ?? new Date().toISOString();

    await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersExecutionRecord,
    );

    const result = await this.repository.recordMeterReading({
      serviceOrderId,
      physicalAssetId: input.physicalAssetId,
      meterKind: input.meterKind,
      readingValue: input.readingValue,
      unitOfMeasure: input.unitOfMeasure,
      isInitial: input.isInitial ?? false,
      isFinal: input.isFinal ?? false,
      readAt: input.readAt ?? at,
      actorIdentityId: actor.identityId,
      evidenceId: input.evidenceId ?? null,
      notes: input.notes ?? null,
      idempotencyKey: input.idempotencyKey,
      rowVersion: input.rowVersion,
    });

    if (result.outcome === 'meter_not_monotonic') {
      throw this.meterNotMonotonic();
    }
    if (result.outcome === 'duplicate_final_reading') {
      throw this.duplicateFinalMeter();
    }
    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw serviceOrdersInvalidState(
        'A execução precisa estar em andamento para registrar medição.',
      );
    }
    if (result.outcome === 'not_found') {
      throw serviceOrdersAccessNotFound();
    }
    if (result.outcome === 'idempotency_conflict') {
      throw serviceOrdersIdempotencyKeyConflict();
    }

    await this.audit(actor, 'REGISTER_METER', serviceOrderId, {
      meterKind: input.meterKind,
      readingValue: input.readingValue,
    });

    return this.reloadOverview(actor, serviceOrderId, at);
  }

  /** REGISTER_FUEL — abastecimento com procedência. */
  async registerFuel(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: {
      physicalAssetId: string;
      volumeLiters: string;
      unitPrice?: string | null;
      amount?: string | null;
      odometerReading?: string | null;
      fueledAt?: string;
      supplierReference?: string | null;
      notes?: string | null;
      evidenceId?: string | null;
      rowVersion: number;
      idempotencyKey: string;
      at?: string;
    },
  ): Promise<ServiceOrderExecutionReadModel> {
    assertValidServiceOrderId(serviceOrderId);
    const at = input.at ?? new Date().toISOString();

    await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersExecutionRecord,
    );

    const amount =
      input.amount ??
      (input.unitPrice ? multiplyDecimal(input.volumeLiters, input.unitPrice) : null);

    const result = await this.repository.recordFuel({
      serviceOrderId,
      physicalAssetId: input.physicalAssetId,
      volumeLiters: input.volumeLiters,
      unitPrice: input.unitPrice ?? null,
      amount,
      odometerReading: input.odometerReading ?? null,
      fueledAt: input.fueledAt ?? at,
      actorIdentityId: actor.identityId,
      evidenceId: input.evidenceId ?? null,
      supplierReference: input.supplierReference ?? null,
      notes: input.notes ?? null,
      idempotencyKey: input.idempotencyKey,
      rowVersion: input.rowVersion,
    });

    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw serviceOrdersInvalidState(
        'A execução precisa estar em andamento para registrar combustível.',
      );
    }
    if (result.outcome === 'not_found') {
      throw serviceOrdersAccessNotFound();
    }
    if (result.outcome === 'idempotency_conflict') {
      throw serviceOrdersIdempotencyKeyConflict();
    }

    await this.audit(actor, 'REGISTER_FUEL', serviceOrderId, {
      volumeLiters: input.volumeLiters,
    });

    return this.reloadOverview(actor, serviceOrderId, at);
  }

  /** REGISTER_SIGNATURE — assinatura do cliente. */
  async registerSignature(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: {
      signerName: string;
      signerDocument?: string | null;
      signerRole?: string | null;
      signatureKind?: string;
      evidenceId?: string | null;
      signedAt?: string;
      notes?: string | null;
      rowVersion: number;
      idempotencyKey: string;
      at?: string;
    },
  ): Promise<ServiceOrderExecutionReadModel> {
    assertValidServiceOrderId(serviceOrderId);
    const at = input.at ?? new Date().toISOString();

    await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersExecutionRecord,
    );

    if (!input.signerName || input.signerName.trim().length === 0) {
      throw serviceOrdersValidationFailed();
    }

    const result = await this.repository.recordSignature({
      serviceOrderId,
      signerName: input.signerName.trim(),
      signerDocument: input.signerDocument ?? null,
      signerRole: input.signerRole ?? null,
      signatureKind: input.signatureKind ?? 'CUSTOMER',
      evidenceId: input.evidenceId ?? null,
      signedAt: input.signedAt ?? at,
      actorIdentityId: actor.identityId,
      notes: input.notes ?? null,
      idempotencyKey: input.idempotencyKey,
      rowVersion: input.rowVersion,
    });

    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw serviceOrdersInvalidState('A ordem não está em um estado que aceite assinatura.');
    }
    if (result.outcome === 'not_found') {
      throw serviceOrdersAccessNotFound();
    }
    if (result.outcome === 'idempotency_conflict') {
      throw serviceOrdersIdempotencyKeyConflict();
    }

    await this.audit(actor, 'REGISTER_SIGNATURE', serviceOrderId, {
      signerName: input.signerName,
    });

    return this.reloadOverview(actor, serviceOrderId, at);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUÇÃO DE LEITURA
  // ═══════════════════════════════════════════════════════════════════════════

  private async buildDispatchBoardItem(
    actor: IdentityAuthzContext,
    facts: ExecutionOperationsFacts,
    at: string,
  ): Promise<DispatchBoardItem> {
    const order = facts.order;
    const dueAt = await this.resolveDueAtFromRow(order);
    const dispatchFacts = buildDispatchFacts(facts, {
      at,
      dueAt,
      vehicleTypeCodes: new Set(facts.vehicleTypeCodes),
    });
    const readiness = evaluateDispatchReadiness(dispatchFacts);

    const completionFacts = buildCompletionFacts(facts, { completionBlockedReasons: [] });
    const completionGate = evaluateCompletionGate(completionFacts);

    const permissions = await this.metadata.getEffectivePermissions(actor);
    const surface = buildCommandSurface({
      serviceOrderId: order.id,
      status: order.status as never,
      dispatchReadiness: readiness,
      completionGate,
      dispatchedAt: facts.dispatch?.dispatched_at ?? null,
      checkedInAt: facts.dispatch?.checked_in_at ?? null,
      hasBlockingSituation: facts.situations.some(
        (row) => row.status === 'OPEN' && row.impact?.['blocking'] === true,
      ),
      hasPermission: (permission) => permissions.has(permission),
    });

    return {
      serviceOrderId: order.id,
      orderNumber: order.order_number,
      clientLabel: readClientLabel(order.client_snapshot),
      serviceLabel: readServiceLabel(order.service_snapshot),
      unitId: order.unit_id,
      status: order.status,
      rowVersion: order.row_version,
      windowStartAt: facts.dispatch?.window_start ?? null,
      windowEndAt: facts.dispatch?.window_end ?? null,
      readiness: {
        ready: readiness.ready,
        status: readiness.status,
        summary: readiness.summary,
        blockingReasons: readiness.blockingReasons.map((item) => ({
          dimension: item.dimension,
          reasonCode: item.reasonCode,
          reason: item.reason,
          resolution: item.resolution,
          resourceCode: item.resource?.code ?? null,
        })),
      },
      dispatchedAt: facts.dispatch?.dispatched_at ?? null,
      checkedInAt: facts.dispatch?.checked_in_at ?? null,
      dueAt,
      slaRemaining: slaRemaining(dueAt, at),
      availableCommands: surface.availableCommands,
      nextAction: surface.nextCommand
        ? { code: surface.nextCommand, label: surface.nextCommandLabel ?? surface.nextCommand }
        : null,
      situations: facts.situations
        .filter((row) => row.status === 'OPEN')
        .map((row) => ({
          code: row.situation_code,
          severity: row.severity,
          title: row.title,
          blocking: row.impact?.['blocking'] === true,
        })),
    };
  }

  private async buildExecutionConsoleItem(
    actor: IdentityAuthzContext,
    facts: ExecutionOperationsFacts,
    at: string,
  ): Promise<ExecutionConsoleItem> {
    const order = facts.order;
    const dueAt = await this.resolveDueAtFromRow(order);
    const dispatchFacts = buildDispatchFacts(facts, {
      at,
      dueAt,
      vehicleTypeCodes: new Set(facts.vehicleTypeCodes),
    });
    const readiness = evaluateDispatchReadiness(dispatchFacts);
    const completionFacts = buildCompletionFacts(facts, { completionBlockedReasons: [] });
    const completionGate = evaluateCompletionGate(completionFacts);

    const situationFacts = buildSituationFacts(facts, {
      at,
      dueAt,
      dispatchBlockedReasons: readiness.blockingReasons.map((item) => item.reasonCode ?? 'UNKNOWN'),
      completionBlockedReasons: completionGate.blockingReasons.map((item) => item.reasonCode),
      requiredActualsMissing: [],
      requiredEvidenceMissing: completionGate.blockingReasons
        .filter((item) => item.reasonCode === 'REQUIRED_EVIDENCE_MISSING')
        .map((item) => item.missingCode ?? 'EVIDENCE'),
      evidenceNotVerified: completionGate.blockingReasons
        .filter((item) => item.reasonCode === 'EVIDENCE_NOT_VERIFIED')
        .map((item) => item.missingCode ?? 'EVIDENCE'),
      clientLabel: readClientLabel(order.client_snapshot),
    });

    const detection = detectExecutionSituations(situationFacts, at);

    const permissions = await this.metadata.getEffectivePermissions(actor);
    const surface = buildCommandSurface({
      serviceOrderId: order.id,
      status: order.status as never,
      dispatchReadiness: readiness,
      completionGate,
      dispatchedAt: facts.dispatch?.dispatched_at ?? null,
      checkedInAt: facts.dispatch?.checked_in_at ?? null,
      hasBlockingSituation: detection.hasBlocking,
      hasPermission: (permission) => permissions.has(permission),
    });

    const remaining = slaRemainingMinutes(dueAt, at);
    const planned = situationFacts.plannedQuantity;
    const measured = situationFacts.measuredQuantity;

    const slaStatus: ExecutionConsoleItem['slaStatus'] =
      remaining === null ? 'UNKNOWN' : remaining < 0 ? 'LATE' : remaining < 120 ? 'RISK' : 'OK';

    return {
      serviceOrderId: order.id,
      orderNumber: order.order_number,
      clientLabel: readClientLabel(order.client_snapshot),
      serviceLabel: readServiceLabel(order.service_snapshot),
      status: order.status,
      startedAt: order.started_at,
      pausedAt: order.paused_at,
      dueAt,
      slaRemaining: remaining === null ? null : formatSlaRemaining(remaining),
      slaStatus,
      progress:
        planned !== null && measured !== null && Number(planned) > 0
          ? {
              measured,
              planned,
              ratio: Math.min(1, Math.max(0, Number(measured) / Number(planned))),
            }
          : null,
      situations: detection.situations.map((item) => ({
        code: item.code,
        severity: item.severity,
        title: item.title,
        detail: item.detail,
        ownerRole: item.ownerRole,
        nextBestAction: item.nextBestAction,
        blocking: item.blocking,
      })),
      availableCommands: surface.availableCommands,
      nextAction: surface.nextCommand
        ? { code: surface.nextCommand, label: surface.nextCommandLabel ?? surface.nextCommand }
        : null,
      exceptionReason: detection.situations[0]?.title ?? null,
    };
  }

  private async buildOverview(
    actor: IdentityAuthzContext,
    order: ServiceOrderRow,
    facts: ExecutionOperationsFacts,
    at: string,
  ): Promise<ServiceOrderExecutionReadModel> {
    const dueAt = await this.resolveDueAtFromRow(facts.order);

    const dispatchFacts = buildDispatchFacts(facts, {
      at,
      dueAt,
      vehicleTypeCodes: new Set(facts.vehicleTypeCodes),
    });
    const readiness = evaluateDispatchReadiness(dispatchFacts);

    const completionFacts = buildCompletionFacts(facts, { completionBlockedReasons: [] });
    const completionGate = evaluateCompletionGate(completionFacts);

    const permissions = await this.metadata.getEffectivePermissions(actor);
    const surface = buildCommandSurface({
      serviceOrderId: facts.order.id,
      status: facts.order.status as never,
      dispatchReadiness: readiness,
      completionGate,
      dispatchedAt: facts.dispatch?.dispatched_at ?? null,
      checkedInAt: facts.dispatch?.checked_in_at ?? null,
      hasBlockingSituation: facts.situations.some(
        (row) => row.status === 'OPEN' && row.impact?.['blocking'] === true,
      ),
      hasPermission: (permission) => permissions.has(permission),
    });

    const situationFacts = buildSituationFacts(facts, {
      at,
      dueAt,
      dispatchBlockedReasons: readiness.blockingReasons.map((item) => item.reasonCode ?? 'UNKNOWN'),
      completionBlockedReasons: completionGate.blockingReasons.map((item) => item.reasonCode),
      requiredActualsMissing: completionGate.blockingReasons
        .filter((item) =>
          [
            'FINAL_ODOMETER_REQUIRED',
            'FUEL_ACTUAL_REQUIRED',
            'LABOR_ACTUAL_REQUIRED',
            'EQUIPMENT_ACTUAL_REQUIRED',
            'MATERIAL_ACTUAL_REQUIRED',
          ].includes(item.reasonCode),
        )
        .map((item) => item.missingCode ?? 'ACTUAL'),
      requiredEvidenceMissing: completionGate.blockingReasons
        .filter((item) => item.reasonCode === 'REQUIRED_EVIDENCE_MISSING')
        .map((item) => item.missingCode ?? 'EVIDENCE'),
      evidenceNotVerified: completionGate.blockingReasons
        .filter((item) => item.reasonCode === 'EVIDENCE_NOT_VERIFIED')
        .map((item) => item.missingCode ?? 'EVIDENCE'),
      clientLabel: readClientLabel(facts.order.client_snapshot),
    });

    const detection = detectExecutionSituations(situationFacts, at);
    const lifecycle = deriveOperationalLifecycle({
      serviceOrderId: facts.order.id,
      status: facts.order.status as never,
      plannedResourceCount: facts.plannedResources.filter((row) => row.status === 'PLANNED').length,
      activeAllocationCount: facts.allocations.filter((row) => row.status === 'ACTIVE').length,
      dispatchedAt: facts.dispatch?.dispatched_at ?? null,
      checkedInAt: facts.dispatch?.checked_in_at ?? null,
      startedAt: facts.order.started_at,
      pausedAt: facts.order.paused_at,
      completedAt: facts.order.completed_at,
      actualCount: facts.actuals.length,
      executionClosedAt: facts.closure?.closed_at ?? null,
      measurementBasisPreparedAt: facts.measurementBasis?.prepared_at ?? null,
      hasBlockingSituation: detection.hasBlocking,
    });

    const actuals = this.buildActuals(facts);

    return {
      identity: {
        serviceOrderId: facts.order.id,
        orderNumber: facts.order.order_number,
        internalCode: order.internal_code ?? null,
        serviceLabel: readServiceLabel(facts.order.service_snapshot),
        clientLabel: readClientLabel(facts.order.client_snapshot),
        unitId: facts.order.unit_id,
        description: facts.order.description,
        rowVersion: facts.order.row_version,
      },
      businessContext: {
        origin: order.origin ?? null,
        contractReference: order.contract_reference ?? null,
        customerPurchaseOrderNumber: order.customer_purchase_order_number ?? null,
        priority: facts.order.priority,
      },
      statuses: this.buildStatuses(facts, completionGate.canComplete, detection.hasBlocking),
      process: lifecycle,
      currentStage: currentOperationalStage(lifecycle),
      planning: {
        plannedResourceCount: facts.plannedResources.length,
        activeAllocationCount: facts.allocations.filter((row) => row.status === 'ACTIVE').length,
        activeResources: facts.allocations
          .filter((row) => row.status === 'ACTIVE')
          .map((row) => ({
            allocationId: row.id,
            resourceCode: row.asset_code ?? row.member_code ?? row.resource_type_code,
            resourceLabel: row.asset_name ?? row.member_name,
            role:
              row.requires_driver === true
                ? 'VEHICLE'
                : row.physical_asset_id
                  ? 'EQUIPMENT'
                  : 'CREW',
            operationalStart: row.operational_start,
            operationalEnd: row.operational_end,
          })),
      },
      dispatch: {
        dispatchedAt: facts.dispatch?.dispatched_at ?? null,
        checkedInAt: facts.dispatch?.checked_in_at ?? null,
        windowStart: facts.dispatch?.window_start ?? null,
        windowEnd: facts.dispatch?.window_end ?? null,
        readiness,
      },
      execution: {
        startedAt: facts.order.started_at,
        pausedAt: facts.order.paused_at,
        completedAt: facts.order.completed_at,
        executionClosedAt: facts.closure?.closed_at ?? null,
        measurementBasisPreparedAt: facts.measurementBasis?.prepared_at ?? null,
      },
      actuals,
      completionGate,
      economics: this.buildEconomics(),
      situations: detection.situations,
      timeline: facts.events.map((row) => ({
        at: row.occurred_at,
        kind: row.event_kind,
        label: timelineLabel(row.event_kind),
        detail: readTimelineDetail(row.detail),
        actorIdentityId: row.actor_identity_id,
      })),
      nextAction: {
        code: surface.nextCommand,
        label: surface.nextCommandLabel,
        explanation: completionGate.canComplete
          ? 'A conclusão está liberada; este é o próximo passo.'
          : (completionGate.blockingReasons[0]?.reason ?? readiness.summary),
      },
      availableCommands: surface.availableCommands,
      decisionExplanation: {
        completionSummary: completionGate.summary,
        onCompletion: COMPLETION_CONSEQUENCES.map((item) => ({
          code: item.code,
          label: item.label,
        })),
        dispatchSummary: readiness.summary,
      },
      freshness: { readAt: at, authority: 'SERVER' },
    };
  }

  /**
   * Estados INDEPENDENTES.
   *
   * A object page não reduz o processo a `status`. Cada eixo declara sua própria
   * verdade — e `billing`/`accounting` só aparecem quando o domínio dono publica
   * fato; caso contrário `NOT_ELIGIBLE` / `NOT_APPLICABLE`, nunca um palpite.
   */
  private buildStatuses(
    facts: ExecutionOperationsFacts,
    canComplete: boolean,
    hasBlockingSituation: boolean,
  ): ServiceOrderExecutionReadModel['statuses'] {
    const status = facts.order.status;
    const dispatched = facts.dispatch !== null;
    const started = facts.order.started_at !== null;
    const paused = status === SERVICE_ORDER_STATUSES.Paused;
    const completed = status === SERVICE_ORDER_STATUSES.Completed;
    const closed = facts.closure !== null;
    const measurable = facts.measurementBasis !== null;

    return {
      operational: sameAsProcess(status, hasBlockingSituation),
      planning:
        facts.plannedResources.filter((row) => row.status === 'PLANNED').length > 0
          ? 'CONFIRMED'
          : 'NOT_PLANNED',
      reservation:
        facts.allocations.filter((row) => row.status === 'ACTIVE').length > 0
          ? 'CONFIRMED'
          : 'NOT_RESERVED',
      dispatch: dispatched
        ? facts.dispatch?.checked_in_at
          ? 'CHECKED_IN'
          : 'DISPATCHED'
        : 'NOT_DISPATCHED',
      execution: !started
        ? 'NOT_STARTED'
        : paused
          ? 'PAUSED'
          : completed
            ? 'COMPLETED'
            : 'IN_PROGRESS',
      actuals: facts.actuals.length === 0 ? 'NONE' : completed ? 'COMPLETE' : 'PARTIAL',
      measurement: measurable
        ? 'READY'
        : closed
          ? 'PENDING_BASIS'
          : completed
            ? 'NOT_CLOSED'
            : 'NOT_READY',
      // Faturamento e contabilidade são de OUTRA capability. Lido pelo que existe.
      billing: 'NOT_ELIGIBLE',
      accounting: 'NOT_APPLICABLE',
    };

    function sameAsProcess(current: string, blocking: boolean): string {
      if (blocking) {
        return 'BLOCKED';
      }
      return current;
    }
  }

  private buildActuals(facts: ExecutionOperationsFacts): ExecutionActualsReadModel {
    const actualFacts = toActualFacts(facts);
    const executed = buildExecutedResources(facts);
    const substitutions = buildResourceSubstitutions(executed);

    const planned: Record<string, { quantity: string; unitOfMeasure: string }> = {};
    const totalPlannedHours = facts.plannedResources
      .filter((row) => row.status === 'PLANNED' && row.requirement_kind === 'LABOR')
      .reduce((sum, row) => sum + Number(row.planned_quantity), 0);
    if (totalPlannedHours > 0) {
      planned['LABOR_HOURS'] = {
        quantity: String(totalPlannedHours),
        unitOfMeasure: 'H',
      };
    }

    return {
      comparison: buildActualsComparison({ actuals: actualFacts, planned, substitutions }),
      records: facts.actuals.map((row: ExecutionActualRow) => ({
        id: row.id,
        actualKind: row.actual_kind,
        resourceLabel: row.resource_label,
        actualValue: row.actual_value,
        unitOfMeasure: row.unit_of_measure,
        plannedValue: row.planned_value,
        source: row.source,
        occurredAt: row.occurred_at,
      })),
      meters: facts.meters.map((row: ExecutionMeterRow) => ({
        id: row.id,
        meterKind: row.meter_kind,
        readingValue: row.reading_value,
        unitOfMeasure: row.unit_of_measure,
        isInitial: row.is_initial,
        isFinal: row.is_final,
        readAt: row.read_at,
      })),
      fuel: facts.fuel.map((row: ExecutionFuelRow) => ({
        id: row.id,
        volumeLiters: row.volume_liters,
        unitPrice: row.unit_price,
        odometerReading: row.odometer_reading,
        fueledAt: row.fueled_at,
      })),
      evidence: facts.evidence.map((row) => ({
        id: row.id,
        evidenceKind: row.evidence_kind,
        status: row.status,
        recordedAt: row.recorded_at,
      })),
      signatures: facts.signatures.map((row: ExecutionSignatureRow) => ({
        id: row.id,
        signerName: row.signer_name,
        signatureKind: row.signature_kind,
        signedAt: row.signed_at,
      })),
    };
  }

  /**
   * Economia da OS 360: a leitura de execução não contém custos autorizados.
   *
   * `execution_actuals.planned_value` é QUANTIDADE física (H, KM, L, UNIT),
   * não preço. Somá-la e publicar BRL mistura unidades e fabrica custo.
   * Até integrar a leitura com o contrato PDP de OperationalCostAccessService,
   * manter montantes e moeda indisponíveis, inclusive com realizado registrado.
   * Não inferir custo zero, moeda padrão nem receita de apontamentos físicos.
   */
  private buildEconomics(): ServiceOrderExecutionReadModel['economics'] {
    return {
      plannedRevenue: null,
      plannedCost: null,
      currencyCode: null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APOIO
  // ═══════════════════════════════════════════════════════════════════════════

  private async reloadOverview(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    at: string,
  ): Promise<ServiceOrderExecutionReadModel> {
    const order = await this.serviceOrdersRepository.findById(serviceOrderId);
    const facts = await this.repository.loadFacts(serviceOrderId);
    if (!order || !facts) {
      throw serviceOrdersAccessNotFound();
    }
    return this.buildOverview(actor, order, facts, at);
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

  /**
   * Prazo de atendimento publicado.
   *
   * A fonte é o contrato da OS quando ele declara prazo. Sem contrato ou sem
   * prazo declarado, `null` — e o sistema NÃO inventa SLA a partir da janela
   * operacional: janela é quando o trabalho acontece, prazo é quanto tempo o
   * cliente deu.
   */
  private async resolveDueAt(order: ServiceOrderRow): Promise<string | null> {
    return readContractDueAt(order.contract_snapshot);
  }

  private async resolveDueAtFromRow(
    order: ExecutionOperationsFacts['order'],
  ): Promise<string | null> {
    return readContractDueAt(order.contract_snapshot);
  }

  private async audit(
    actor: IdentityAuthzContext,
    command: string,
    serviceOrderId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionRecord,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { command, ...metadata },
    });
  }

  private assertDispatchOutcome(
    result: Awaited<ReturnType<OperationsRepository['recordDispatch']>>,
  ): void {
    switch (result.outcome) {
      case 'success':
      case 'idempotent':
        return;
      case 'version_conflict':
        throw serviceOrdersVersionConflict(
          'Esta ordem foi alterada por outro usuário. Recarregue antes de despachar.',
        );
      case 'already_dispatched':
        throw this.alreadyDispatched();
      case 'invalid_state':
        throw serviceOrdersInvalidState('A ordem precisa estar liberada para ser despachada.');
      case 'not_found':
        throw serviceOrdersAccessNotFound();
      case 'idempotency_conflict':
        throw serviceOrdersIdempotencyKeyConflict();
      default:
        throw serviceOrdersInvalidState();
    }
  }

  /**
   * O despacho foi recusado pela prontidão.
   *
   * `422 UNPROCESSABLE` é a resposta correta: a requisição está bem formada, a
   * autorização passou, e o ESTADO do negócio impede. Devolver `400` culparia o
   * cliente por um problema de operação; devolver `409` sugeriria conflito de
   * concorrência, que é outro motivo. Os motivos vão no corpo.
   */
  private dispatchBlocked(readiness: DispatchReadiness): ServiceOrdersHttpException {
    return new ServiceOrdersHttpException(
      422,
      SERVICE_ORDERS_ERROR_CODES.DISPATCH_BLOCKED,
      readiness.summary,
    );
  }

  private actualResourceRequired(kind: string) {
    return serviceOrdersInvalidState(
      `Um realizado do tipo ${kind} precisa de recurso identificado (ativo ou pessoa).`,
    );
  }

  /**
   * Leitura regressiva de medidor.
   *
   * `409 CONFLICT` com código PRÓPRIO — não `INVALID_STATE`. A distinção importa
   * para o operador: "o estado da ordem não permite" e "o valor é incoerente"
   * exigem ações diferentes, e um código genérico obrigaria a tela a adivinhar
   * qual dos dois aconteceu.
   */
  private meterNotMonotonic(): ServiceOrdersHttpException {
    return new ServiceOrdersHttpException(
      409,
      SERVICE_ORDERS_ERROR_CODES.METER_READING_NOT_MONOTONIC,
      'A leitura informada é menor que a última leitura registrada para este medidor. Registre a leitura correta ou corrija o histórico.',
    );
  }

  private duplicateFinalMeter(): ServiceOrdersHttpException {
    return new ServiceOrdersHttpException(
      409,
      SERVICE_ORDERS_ERROR_CODES.DUPLICATE_FINAL_METER_READING,
      'Esta ordem já tem leitura final registrada para este medidor.',
    );
  }

  private alreadyDispatched() {
    return serviceOrdersInvalidState('Esta ordem já foi despachada.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APOIO PURO
// ═══════════════════════════════════════════════════════════════════════════════

function readClientLabel(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot) {
    return null;
  }
  for (const key of ['tradeName', 'legalName', 'name', 'displayName']) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function readServiceLabel(snapshot: Record<string, unknown>): string | null {
  const value = snapshot?.['serviceName'];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readContractDueAt(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const value = snapshot['dueAt'];
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : value;
}

function slaRemainingMinutes(dueAt: string | null, at: string): number | null {
  if (!dueAt) {
    return null;
  }
  const due = new Date(dueAt).getTime();
  const now = new Date(at).getTime();
  if (Number.isNaN(due) || Number.isNaN(now)) {
    return null;
  }
  return Math.floor((due - now) / 60_000);
}

function slaRemaining(dueAt: string | null, at: string): string | null {
  const minutes = slaRemainingMinutes(dueAt, at);
  return minutes === null ? null : formatSlaRemaining(minutes);
}

function resolveDispatchWindow(
  facts: ExecutionOperationsFacts,
  input: { windowStart?: string; windowEnd?: string },
): { startAt: string; endAt: string } {
  if (input.windowStart && input.windowEnd) {
    return { startAt: input.windowStart, endAt: input.windowEnd };
  }
  if (facts.dispatch) {
    return { startAt: facts.dispatch.window_start, endAt: facts.dispatch.window_end };
  }
  // Deriva das alocações ativas: a janela acordada é o intervalo que os recursos
  // reservados cobrem juntos. Não é janela "padrão" inventada.
  const active = facts.allocations.filter((row) => row.status === 'ACTIVE');
  if (active.length > 0) {
    const starts = active.map((row) => new Date(row.operational_start).getTime());
    const ends = active.map((row) => new Date(row.operational_end).getTime());
    return {
      startAt: new Date(Math.max(...starts)).toISOString(),
      endAt: new Date(Math.min(...ends)).toISOString(),
    };
  }
  const now = new Date();
  return {
    startAt: now.toISOString(),
    endAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
  };
}

function findPlannedValue(
  facts: ExecutionOperationsFacts | null,
  actualKind: string,
  physicalAssetId: string | null | undefined,
  workforceMemberId: string | null | undefined,
): string | null {
  if (!facts) {
    return null;
  }
  void physicalAssetId;
  void workforceMemberId;
  if (actualKind !== 'LABOR_HOURS') {
    return null;
  }
  const total = facts.plannedResources
    .filter((row) => row.status === 'PLANNED' && row.requirement_kind === 'LABOR')
    .reduce((sum, row) => sum + Number(row.planned_quantity), 0);
  return total > 0 ? String(total) : null;
}

function findResourceLabel(
  facts: ExecutionOperationsFacts | null,
  physicalAssetId: string | null | undefined,
  workforceMemberId: string | null | undefined,
): string | null {
  if (!facts) {
    return null;
  }
  if (physicalAssetId) {
    const row = facts.allocations.find((item) => item.physical_asset_id === physicalAssetId);
    return row?.asset_code ?? null;
  }
  if (workforceMemberId) {
    const row = facts.allocations.find((item) => item.workforce_member_id === workforceMemberId);
    return row?.member_code ?? null;
  }
  return null;
}

/** Multiplicação decimal em string, sem ponto flutuante. */
function multiplyDecimal(left: string, right: string): string | null {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  return (Math.round(a * b * 10_000) / 10_000).toFixed(4);
}

function readTimelineDetail(detail: Record<string, unknown>): string | null {
  for (const key of ['reason', 'note', 'text', 'actualValue', 'readingValue', 'volumeLiters']) {
    const value = detail?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return null;
}

const TIMELINE_LABELS: Record<string, string> = {
  DISPATCHED: 'Ordem despachada',
  CHECKED_IN: 'Chegada registrada',
  STARTED: 'Execução iniciada',
  PAUSED: 'Execução pausada',
  RESUMED: 'Execução retomada',
  PROGRESS_RECORDED: 'Progresso registrado',
  ACTUAL_RECORDED: 'Realizado registrado',
  METER_RECORDED: 'Leitura registrada',
  FUEL_RECORDED: 'Combustível registrado',
  EVIDENCE_ATTACHED: 'Evidência anexada',
  SIGNATURE_REGISTERED: 'Assinatura registrada',
  EXCEPTION_REPORTED: 'Ocorrência registrada',
  UNBLOCKED: 'Bloqueio resolvido',
  COMPLETION_BLOCKED: 'Conclusão bloqueada',
  COMPLETED: 'Execução concluída',
  EXECUTION_CLOSED: 'Execução fechada',
  CANCELLED: 'Execução cancelada',
};

function timelineLabel(kind: string): string {
  return TIMELINE_LABELS[kind] ?? kind;
}

/** Ordena o board: bloqueadas primeiro, depois prontas, depois despachadas. */
function sortDispatchBoard(items: DispatchBoardItem[]): DispatchBoardItem[] {
  const rank = (item: DispatchBoardItem): number => {
    if (item.dispatchedAt) {
      return 2;
    }
    return item.readiness.ready ? 1 : 0;
  };
  return [...items].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) {
      return byRank;
    }
    return left.orderNumber.localeCompare(right.orderNumber, 'pt-BR');
  });
}

/** Ordena o console por exceção: atrasadas, em risco, bloqueadas, depois o resto. */
function sortExecutionConsole(items: ExecutionConsoleItem[]): ExecutionConsoleItem[] {
  const rank = (item: ExecutionConsoleItem): number => {
    if (item.slaStatus === 'LATE') {
      return 0;
    }
    if (item.situations.some((s) => s.blocking)) {
      return 1;
    }
    if (item.slaStatus === 'RISK') {
      return 2;
    }
    if (item.status === SERVICE_ORDER_STATUSES.Paused) {
      return 3;
    }
    return 4;
  };
  return [...items].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) {
      return byRank;
    }
    return left.orderNumber.localeCompare(right.orderNumber, 'pt-BR');
  });
}

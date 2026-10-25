/**
 * MEDIÇÃO → ACEITE → FATURAMENTO — SERVIÇO DE APLICAÇÃO DA CAPABILITY.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O PAPEL DESTA CAMADA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Ela NÃO decide regra (o domínio decide) e NÃO escreve SQL (o repositório
 * escreve). Ela:
 *
 *   1. aplica autorização e escopo (reutilizando o serviço de acesso existente);
 *   2. coleta fatos — da BASE PUBLICADA quando o fato é da execução;
 *   3. pede a decisão ao domínio;
 *   4. executa o comando transacional;
 *   5. devolve o read model já composto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A ORDEM IMPORTA: FATOS → DECISÃO → COMANDO → TRANSAÇÃO → FATO → OUTBOX
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `RECORD_ACCEPTANCE` avalia a política e RECUSA se ela não se aplica. Não existe
 * caminho "força o aceite": a decisão é a mesma que a tela mostra no botão, porque
 * é literalmente a mesma função (`buildMeasurementCommandSurface`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA CAMADA **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não emite documento fiscal, não abre recebível, não posta contabilidade. Ela
 * entrega `READY_TO_BILL` — o mesmo ponto em que a Billing Worklist existente
 * começa — e publica o fato na outbox dentro do MESMO COMMIT do estado.
 */

import { Injectable } from '@nestjs/common';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  PURCHASE_ORDER_REQUIREMENTS,
  resolveBillingEntitlementPolicy,
} from '../../billing/domain/billing-entitlement';
import { detectCommercialTermsMismatch } from '../../billing/domain/payment-terms';
import { ServiceOrdersRepository } from '../../service-orders/repositories/service-orders.repository';
import { OutboxDomainEventWriter } from '../../platform/outbox/services/outbox-domain-event.writer';
import {
  applyAcceptancePolicy,
  deriveAcceptanceState,
  requiresCustomerAcceptance,
  resolveAcceptancePolicy,
} from '../domain/acceptance-policy';
import {
  ELIGIBILITY_RESULTS,
  evaluateBillingEligibility,
  transitionedAwayFromReady,
  transitionedToReady,
  type BillingEligibilityFacts,
} from '../domain/billing-eligibility';
import {
  CONSUMABLE_BASIS_STATUS,
  parseMeasurementBasisLines,
  resolveDeclaredVarianceTolerance,
} from '../domain/measurement-basis-consumption';
import { buildMeasurementCommandSurface } from '../domain/measurement-command-surface';
import { MEASUREMENT_SURFACE_COMMANDS } from '../domain/measurement-command-surface';
import { projectProcessContext } from '../domain/measurement-process-context';
import {
  detectMeasurementVariances,
  varianceDimensionLabel,
  type VarianceDimension,
  type VarianceObservation,
} from '../domain/measurement-variance';
import { MEASUREMENT_STATUSES } from '../domain/measurement';
import {
  LEAKAGE_STAGE_LABELS,
  LEAKAGE_STAGES,
  projectRevenueLeakage,
  type LeakageStageSummary,
} from '../domain/revenue-leakage';
import { MeasurementCapabilityRepository } from '../repositories/measurement-capability.repository';
import type { MeasurementItemRow, MeasurementRow } from '../repositories/measurements.repository.types';
import { MeasurementsRepository } from '../repositories/measurements.repository';
import { MeasurementsAccessService } from '../services/measurements-access.service';
import {
  measurementsAccessNotFound,
  measurementsVersionConflict,
} from '../services/measurements-access.errors';
import type {
  MeasurementWorkbenchReadModel,
  MeasurementWorkQueueReadModel,
  RevenueLeakageReadModel,
  WorkQueueItem,
  WorkbenchQuantityLine,
  WorkbenchTimelineEvent,
} from './measurement-workbench.contracts';
import { MeasurementsAcceptanceAuthz } from './measurements-acceptance.authz';

/**
 * TETO DE ORDENS POR PROJEÇÃO DE LACUNA.
 *
 * A projeção recalcula posições em uma transação. Sem teto, uma unidade com
 * milhares de ordens concluídas travaria o request e a tabela. O valor é
 * DECLARADO, e o read model publica `truncated` quando o conjunto excede o teto —
 * uma projeção parcial que se anuncia é honesta; uma que se cala é falsa.
 */
const LEAKAGE_PROJECTION_LIMIT = 2_000;

@Injectable()
export class MeasurementsCapabilityService {
  constructor(
    private readonly capabilityRepository: MeasurementCapabilityRepository,
    private readonly measurementsRepository: MeasurementsRepository,
    private readonly measurementsAccess: MeasurementsAccessService,
    private readonly serviceOrdersRepository: ServiceOrdersRepository,
    private readonly authz: MeasurementsAcceptanceAuthz,
    private readonly outboxWriter: OutboxDomainEventWriter,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // READ MODEL — WORKBENCH
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * WORKBENCH — a estação de trabalho da medição.
   *
   * Uma leitura que responde tudo sobre a medição de UMA ordem, orientada à
   * decisão. O consumidor NÃO recompõe nada: o que a tela mostra é o que este
   * método devolveu.
   */
  async getWorkbench(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { at?: string } = {},
  ): Promise<MeasurementWorkbenchReadModel> {
    const at = input.at ?? new Date().toISOString();
    await this.assertReadAccess(actor, serviceOrderId);

    const context = await this.capabilityRepository.loadCommercialContext(serviceOrderId);
    if (!context) {
      throw measurementsAccessNotFound();
    }

    const measurement = await this.measurementsRepository.findByServiceOrderId(serviceOrderId);
    const [basis, closure, items, adjustments, historyEvents, acceptances, prepared] =
      await Promise.all([
        this.capabilityRepository.findLatestBasis(serviceOrderId),
        this.capabilityRepository.findClosure(serviceOrderId),
        measurement ? this.measurementsRepository.listItems(measurement.id) : Promise.resolve([]),
        measurement ? this.measurementsRepository.listAdjustments(measurement.id) : Promise.resolve([]),
        measurement
          ? this.measurementsRepository.listHistoryEvents(measurement.id)
          : Promise.resolve([]),
        measurement ? this.capabilityRepository.listAcceptances(measurement.id) : Promise.resolve([]),
        this.capabilityRepository.hasPreparedBillingRecord(serviceOrderId),
      ]);

    const latestAcceptance = acceptances.at(-1) ?? null;

    // ── CONTEXTO COMERCIAL E POLÍTICAS ───────────────────────────────────────
    const serviceSnapshot = context.service_snapshot ?? {};
    const acceptancePolicy = resolveAcceptancePolicy({
      contractSnapshot: context.contract_snapshot,
      serviceSnapshot,
      clientPurchaseOrderRequirement: context.client_purchase_order_requirement,
    });
    const acceptanceState = deriveAcceptanceState({
      policy: acceptancePolicy.policy,
      latestAcceptance: latestAcceptance
        ? {
            id: latestAcceptance.id,
            cycleNumber: latestAcceptance.cycle_number,
            result: latestAcceptance.result,
            observation: latestAcceptance.observation,
            rejectionReason: latestAcceptance.rejection_reason,
            evidenceId: latestAcceptance.evidence_id,
            signatureId: latestAcceptance.signature_id,
            customerSignerName: latestAcceptance.customer_signer_name,
            acceptedByIdentityId: latestAcceptance.accepted_by_identity_id,
            occurredAt: latestAcceptance.occurred_at,
          }
        : null,
    });
    const tolerance = resolveDeclaredVarianceTolerance({
      contractSnapshot: context.contract_snapshot,
      serviceSnapshot,
    });
    const entitlementPolicy = resolveBillingEntitlementPolicy(serviceSnapshot);

    // ── VARIAÇÕES ────────────────────────────────────────────────────────────
    const varianceDetection = detectMeasurementVariances({
      measurementId: measurement?.id ?? '',
      serviceOrderId,
      unitId: context.unit_id,
      declaredTolerancePercentage: tolerance.percentage,
      declaredToleranceSource: tolerance.source,
      observations: buildVarianceObservations(items),
      hasAuthorizedAdjustment: adjustments.length > 0,
    });

    // ── ELEGIBILIDADE DE FATURAMENTO ─────────────────────────────────────────
    const eligibilityFacts = this.buildEligibilityFacts({
      context,
      measurement,
      items,
      closure,
      acceptancePolicy: acceptancePolicy.policy,
      acceptanceState: acceptanceState.state,
      acceptanceBlockingReason: acceptanceState.blockingReason,
      variancesRequiringDecision: varianceDetection.decisionRequired.length,
      varianceBlockingReason:
        varianceDetection.decisionRequired.find((item) => item.blockingReason !== null)
          ?.blockingReason ?? null,
      policy: entitlementPolicy,
      billingRecordPrepared: prepared,
    });
    const eligibility = evaluateBillingEligibility(eligibilityFacts);

    // ── PROCESSO ─────────────────────────────────────────────────────────────
    const processFacts = await this.capabilityRepository.loadProcessFacts(serviceOrderId);
    const processContext = projectProcessContext(
      {
        serviceOrderId,
        orderNumber: context.order_number,
        unitId: context.unit_id,
        contractReference: context.contract_reference,
        contractDueAt: processFacts?.contract_due_at ?? null,
        planningConfirmedAt: processFacts?.planning_confirmed_at ?? null,
        reservationConfirmedAt: processFacts?.reservation_confirmed_at ?? null,
        dispatchedAt: processFacts?.dispatched_at ?? null,
        startedAt: processFacts?.started_at ?? null,
        completedAt: processFacts?.completed_at ?? null,
        executionClosedAt: processFacts?.execution_closed_at ?? null,
        measurementCreatedAt: processFacts?.measurement_created_at ?? null,
        measurementApprovedAt: processFacts?.measurement_approved_at ?? null,
        acceptanceRequired: requiresCustomerAcceptance(acceptancePolicy.policy),
        acceptanceSatisfiedAt: processFacts?.acceptance_satisfied_at ?? null,
        billingPreparedAt: processFacts?.billing_prepared_at ?? null,
        receivableOpenedAt: processFacts?.receivable_opened_at ?? null,
        settledAt: processFacts?.settled_at ?? null,
        blockingReason: eligibility.blockingReasons[0] ?? acceptanceState.blockingReason,
        blockingOwnerRole: eligibility.blockingReasons.length > 0 ? inferOwner(eligibility) : null,
        nextMilestoneLabel:
          eligibility.result === ELIGIBILITY_RESULTS.Ready ? 'Preparar faturamento' : null,
      },
      at,
    );

    // ── SUPERFÍCIE DE COMANDOS ───────────────────────────────────────────────
    const permissions = await this.authz.getEffectivePermissions(actor);
    const surface = buildMeasurementCommandSurface({
      serviceOrderId,
      measurementId: measurement?.id ?? null,
      measurementStatus: measurement?.status ?? null,
      basisAvailable: basis !== null && basis.status === CONSUMABLE_BASIS_STATUS,
      measurementLegacyOrigin:
        items.length > 0 &&
        items.every(
          (item) =>
            (item as unknown as { source_measurement_basis_id?: string | null })
              .source_measurement_basis_id === null,
        ),
      itemCount: items.length,
      itemCountWithoutAmount: items.filter((item) => item.line_amount === null).length,
      variancesRequiringDecision: varianceDetection.decisionRequired,
      acceptanceRequired: requiresCustomerAcceptance(acceptancePolicy.policy),
      acceptanceBlocked: acceptanceState.blocksBilling,
      acceptanceBlockingReason: acceptanceState.blockingReason,
      acceptanceAlreadyRecordedForCycle:
        latestAcceptance !== null && latestAcceptance.cycle_number === currentCycle(acceptances),
      eligibilityResult: eligibility.result,
      eligibilityBlockingDimensions: eligibility.dimensions.filter((item) => item.blocking),
      hasPermission: (permission) => permissions.has(permission),
    });

    const quantities = buildQuantityLines(
      basis?.lines ?? null,
      items,
    );

    return {
      identity: {
        measurementId: measurement?.id ?? null,
        number: measurement ? measurementNumber(context.order_number, measurement) : null,
        serviceOrderId,
        orderNumber: context.order_number,
        rowVersion: measurement?.row_version ?? null,
      },
      businessContext: {
        company: readSnapshotLabel(context.client_snapshot, ['tradeName', 'legalName']),
        unit: context.unit_id,
        customer: readSnapshotLabel(context.client_snapshot, ['tradeName', 'legalName']),
        customerId: context.client_id,
        contract: context.contract_reference,
        purchaseOrder: context.purchase_order_id,
        responsible: null,
      },
      statuses: {
        execution: closure !== null ? 'CLOSED' : context.completed_at !== null ? 'COMPLETED' : 'OPEN',
        measurement: measurement?.status ?? 'NOT_CREATED',
        acceptance: acceptanceState.state,
        // O eixo de elegibilidade é o RESULTADO do modelo de decisão, não um
        // palpite derivado do status da medição.
        billingEligibility: eligibility.result,
        billing: prepared ? 'PREPARED' : 'NOT_PREPARED',
        accounting: 'NOT_APPLICABLE',
      },
      processContext: {
        ...processContext,
        nextMilestone: surface.nextAction?.label ?? null,
      },
      measurementBasis: {
        basisId: basis?.id ?? null,
        executionClosureId: closure?.id ?? null,
        preparedAt: basis?.prepared_at ?? null,
        lineCount: Array.isArray(basis?.lines) ? (basis.lines as unknown[]).length : 0,
        lines: parseLinesForDisplay(basis?.lines ?? null),
      },
      quantities,
      economics: {
        grossValue: eligibility.totalAmount,
        currency: eligibility.currencyCode,
        financialVariance: varianceDetection.financialExposure,
        revenueExposure: eligibility.totalAmount,
      },
      commercialContext: {
        pricing: {
          source: readPricingSource(items),
          lineCount: items.length,
          currencyCode: eligibility.currencyCode,
        },
        paymentTerms: readAuthoritativePaymentTerms(context),
        tolerance: varianceDetection.tolerance,
        purchaseOrderRequirement: context.client_purchase_order_requirement,
        billingPolicy: entitlementPolicy,
      },
      variances: varianceDetection.variances,
      varianceSummary: {
        highestSeverity: varianceDetection.highestSeverity,
        decisionRequiredCount: varianceDetection.decisionRequired.length,
        approvalClearable: varianceDetection.approvalClearable,
        summary: varianceDetection.summary,
      },
      adjustments: adjustments.map((row) => {
        const extended = row as unknown as Record<string, unknown>;
        return {
          id: row.id,
          measurementItemId: row.measurement_item_id,
          adjustmentQuantity: row.adjustment_quantity,
          unitCode: row.unit_code,
          reason: row.reason,
          authorizedByIdentityId: row.authorized_by_identity_id,
          financialImpact: readNullableString(extended['financial_impact']),
          decidedAt: readNullableString(extended['decided_at']),
          createdAt: row.created_at,
        };
      }),
      items: items.map((item) => {
        const extended = item as unknown as Record<string, unknown>;
        return {
          id: item.id,
          lineNumber: item.line_number,
          unitCode: item.unit_code,
          plannedQuantity: readNullableString(extended['planned_quantity']),
          actualQuantity: item.actual_quantity,
          measuredQuantity: item.measured_quantity,
          unitPrice: item.unit_price,
          lineAmount: item.line_amount,
          origin:
            (extended['source_measurement_basis_id'] as string | null | undefined) !== null &&
            extended['source_measurement_basis_id'] !== undefined
              ? 'BASIS'
              : 'LEGACY_EXECUTION_ENTRY',
          sourceBasisLineKey: readNullableString(extended['source_basis_line_key']),
        };
      }),
      evidence: await this.loadEvidence(measurement),
      acceptance: {
        policy: acceptancePolicy.policy,
        policySource: acceptancePolicy.source,
        policyReason: acceptancePolicy.reason,
        required: requiresCustomerAcceptance(acceptancePolicy.policy),
        state: acceptanceState.state,
        blocksBilling: acceptanceState.blocksBilling,
        blockingReason: acceptanceState.blockingReason,
        latest: latestAcceptance
          ? {
              id: latestAcceptance.id,
              cycleNumber: latestAcceptance.cycle_number,
              result: latestAcceptance.result,
              observation: latestAcceptance.observation,
              rejectionReason: latestAcceptance.rejection_reason,
              evidenceId: latestAcceptance.evidence_id,
              customerSignerName: latestAcceptance.customer_signer_name,
              acceptedByIdentityId: latestAcceptance.accepted_by_identity_id,
              occurredAt: latestAcceptance.occurred_at,
            }
          : null,
        history: acceptances.map((row) => ({
          id: row.id,
          cycleNumber: row.cycle_number,
          result: row.result,
          rejectionReason: row.rejection_reason,
          occurredAt: row.occurred_at,
        })),
        nextActionCode: acceptanceState.nextActionCode,
        nextActionLabel: acceptanceState.nextActionLabel,
      },
      billingEligibility: eligibility,
      situations: buildWorkbenchSituations({
        eligibility,
        acceptanceState,
        varianceDetection,
        measurement,
      }),
      relationships: buildRelationships(context),
      documentFlow: buildDocumentFlow({
        context,
        measurement,
        closureId: closure?.id ?? null,
        basisId: basis?.id ?? null,
        billingPrepared: prepared,
      }),
      timeline: buildTimeline(historyEvents, acceptances, at),
      nextAction: surface.nextAction,
      availableCommands: surface.availableCommands,
      decisionExplanation: {
        measurement: varianceDetection.summary,
        approval: buildApprovalExplanation(varianceDetection, surface),
        acceptance: `${acceptancePolicy.reason} ${acceptanceState.blockingReason ?? ''}`.trim(),
        billing: eligibility.explanation,
        onBilling:
          'Preparar o faturamento consome esta medição como base e NÃO a altera. O registro de faturamento nasce com os itens medidos, e a OS sai desta capability.',
      },
      freshness: { readAt: at, authority: 'SERVER' },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READ MODEL — WORK QUEUE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * FILA DE TRABALHO da medição.
   *
   * A tela não é "todas as medições": ela lista o que EXIGE AÇÃO. Uma medição em
   * rascunho sem variação pendente não entra na fila de atenção — ela é o estado
   * normal e aparece na contagem, não na lista.
   *
   * O item é derivado da MESMA projeção de lacuna de receita que o control tower
   * usa: uma segunda classificação por status produziria duas respostas diferentes
   * para "o que está parado onde".
   */
  async getWorkQueue(
    actor: IdentityAuthzContext,
    input: { unitId: string; limit?: number; at?: string },
  ): Promise<MeasurementWorkQueueReadModel> {
    const at = input.at ?? new Date().toISOString();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);

    await this.authz.assertUnitReadScope(actor, input.unitId);

    const projection = await this.computeLeakageProjection(input.unitId, limit, at);

    const items: WorkQueueItem[] = projection.positions.map((position) => ({
      measurementId: position.measurementId,
      serviceOrderId: position.serviceOrderId,
      orderNumber: position.orderNumber,
      customerLabel: position.clientLabel,
      statuses: position.statuses,
      stage: position.stage,
      stageLabel: LEAKAGE_STAGE_LABELS[position.stage as never],
      reasonCode: position.blockerCode ?? position.stage,
      reasonLabel: position.nextAction.label,
      severity: position.severity,
      amount: position.amount,
      currencyCode: position.currencyCode,
      ageSeconds: position.ageSeconds,
      ownerRole: position.ownerRole,
      nextAction: position.nextAction,
    }));

    const counts = items.reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.stage] = (accumulator[item.stage] ?? 0) + 1;
      return accumulator;
    }, {});

    return {
      context: { unitId: input.unitId, at },
      counts,
      items,
      freshness: { readAt: at, authority: 'SERVER' },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READ MODEL — REVENUE LEAKAGE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * CONTROL TOWER DE LACUNA DE RECEITA.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * RECALCULA A PROJEÇÃO E DEVOLVE O READ MODEL
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * O cálculo acontece no BACKEND sobre o conjunto INTEIRO, com escopo aplicado
   * na consulta. Um total somado no navegador a partir de listas paginadas seria
   * falso por construção: a página não contém todos os registros.
   *
   * O total é a soma das posições publicadas — o drill-down reconstrói o mesmo
   * número porque é literalmente a mesma lista.
   */
  async getRevenueLeakage(
    actor: IdentityAuthzContext,
    input: { unitId: string; limit?: number; at?: string },
  ): Promise<RevenueLeakageReadModel> {
    const at = input.at ?? new Date().toISOString();
    const limit = Math.min(Math.max(input.limit ?? 500, 1), LEAKAGE_PROJECTION_LIMIT);

    await this.authz.assertUnitReadScope(actor, input.unitId);

    const projection = await this.computeLeakageProjection(input.unitId, limit, at);

    return {
      context: { unitId: input.unitId, at },
      stages: projection.stages,
      total: projection.total,
      positions: projection.positions.map((position) => ({
        serviceOrderId: position.serviceOrderId,
        orderNumber: position.orderNumber,
        clientLabel: position.clientLabel,
        stage: position.stage,
        stageLabel: LEAKAGE_STAGE_LABELS[position.stage as never],
        amount: position.amount,
        currencyCode: position.currencyCode,
        ageSeconds: position.ageSeconds,
        ownerRole: position.ownerRole,
        blockerCode: position.blockerCode,
        nextAction: position.nextAction,
        severity: position.severity,
        statuses: position.statuses,
      })),
      freshness: { readAt: at, authority: 'SERVER' },
    };
  }

  /**
   * Calcula a projeção e PERSISTE as posições.
   *
   * A persistência existe para que outros consumidores (relatórios, alertas) leiam
   * a MESMA posição que a tela mostrou, sem recalcular e sem divergir. O recálculo
   * é determinístico, então persistir é seguro.
   */
  private async computeLeakageProjection(
    unitId: string,
    limit: number,
    at: string,
  ): Promise<{
    stages: LeakageStageSummary[];
    total: { count: number; amount: string | null; unknownAmountCount: number; currencyCode: string | null };
    positions: Array<{
      serviceOrderId: string;
      measurementId: string | null;
      orderNumber: string;
      clientLabel: string | null;
      stage: string;
      amount: string | null;
      currencyCode: string | null;
      ageSeconds: number | null;
      ownerRole: string;
      blockerCode: string | null;
      nextAction: { code: string; label: string };
      severity: string;
      statuses: { measurement: string; acceptance: string; billingEligibility: string };
    }>;
  }> {
    const rows = await this.capabilityRepository.listCompletedOrdersForLeakage(unitId, limit);

    const facts = rows.map((row) => ({
      serviceOrderId: row.service_order_id,
      orderNumber: row.order_number,
      unitId: row.unit_id,
      clientId: row.client_id,
      clientLabel: readSnapshotLabel(row.client_snapshot, ['tradeName', 'legalName']),
      completedAt: row.completed_at,
      executionClosedAt: row.execution_closed_at,
      measurementId: row.measurement_id,
      measurementStatus: row.measurement_status,
      measurementUpdatedAt: row.measurement_updated_at,
      measurementAmount: row.measurement_amount,
      contractualAmount: null,
      currencyCode: row.measurement_currency,
      acceptanceRequired: row.acceptance_required,
      acceptanceBlocked: row.acceptance_blocked,
      eligibilityResult: row.eligibility_result,
      eligibilityBlockingReason: row.eligibility_blocking_reason,
      eligibilityNextActionCode: null,
      billingPrepared: row.billing_prepared,
    }));

    const projection = projectRevenueLeakage({ orders: facts, at });

    await this.capabilityRepository.refreshLeakage(unitId, {
      unitId,
      positions: projection.positions.map((position) => ({
        serviceOrderId: position.serviceOrderId,
        clientId: position.clientId,
        measurementId: facts.find((item) => item.serviceOrderId === position.serviceOrderId)?.measurementId ?? null,
        stage: position.stage,
        orderNumber: position.orderNumber,
        clientLabel: position.clientLabel,
        amount: position.amount,
        currencyCode: position.currencyCode,
        ageSeconds: position.ageSeconds,
        ownerRole: position.ownerRole,
        blockerCode: position.blockerCode,
        nextActionCode: position.nextAction.code,
        nextActionLabel: position.nextAction.label,
      })),
    });

    return {
      stages: projection.stages,
      total: projection.total,
      positions: projection.positions.map((position) => {
        const source = facts.find((item) => item.serviceOrderId === position.serviceOrderId);
        return {
          serviceOrderId: position.serviceOrderId,
          measurementId: source?.measurementId ?? null,
          orderNumber: position.orderNumber,
          clientLabel: position.clientLabel,
          stage: position.stage,
          amount: position.amount,
          currencyCode: position.currencyCode,
          ageSeconds: position.ageSeconds,
          ownerRole: position.ownerRole,
          blockerCode: position.blockerCode,
          nextAction: position.nextAction,
          severity: severityForStage(position.stage),
          statuses: {
            measurement: source?.measurementStatus ?? 'NOT_CREATED',
            acceptance: !source?.acceptanceRequired
              ? 'NOT_REQUIRED'
              : source.acceptanceBlocked
                ? 'PENDING'
                : 'ACCEPTED',
            billingEligibility: source?.eligibilityResult ?? 'NOT_EVALUATED',
          },
        };
      }),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMANDO — RECORD_ACCEPTANCE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * REGISTRA O ACEITE DO CLIENTE — a capability que era função pura.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * PIPELINE DO COMANDO
   * ─────────────────────────────────────────────────────────────────────────────
   *
   *   AUTHENTICATE (guard) → AUTHORIZE → VALIDATE SCOPE → CHECK IDEMPOTENCY
   *     → LOCK/LOAD → CHECK VERSION → DOMAIN INVARIANTS → COMMERCIAL INVARIANTS
   *     → STATE TRANSITION → PERSIST → AUDIT → FACT → OUTBOX → COMMIT
   *
   * TUDO em UMA transação: o aceite, o histórico, a reavaliação de elegibilidade
   * e os DOIS fatos (aceite + elegibilidade) entram no mesmo COMMIT. Não existe
   * estado em que o aceite exista e o faturamento ainda esteja bloqueado por ele.
   */
  async recordAcceptance(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
    input: {
      expectedVersion: number;
      idempotencyKey: string;
      result: 'ACCEPTED' | 'REJECTED';
      observation: string;
      rejectionReason?: string | null;
      evidenceId?: string | null;
      signatureId?: string | null;
      customerSignerName?: string | null;
      occurredAt?: string;
      correlationId?: string | null;
      at?: string;
    },
  ): Promise<MeasurementWorkbenchReadModel> {
    const at = input.at ?? new Date().toISOString();
    const occurredAt = input.occurredAt ?? at;

    await this.assertAction(actor, serviceOrderId, AUTHZ_ACTIONS.MeasurementsMeasurementAccept);

    const context = await this.capabilityRepository.loadCommercialContext(serviceOrderId);
    if (!context) {
      throw measurementsAccessNotFound();
    }
    const measurement = await this.measurementsRepository.findById(measurementId);
    if (!measurement || measurement.service_order_id !== serviceOrderId) {
      throw measurementsAccessNotFound();
    }

    // ── VERSÃO ───────────────────────────────────────────────────────────────
    if (measurement.row_version !== input.expectedVersion) {
      throw measurementsVersionConflict();
    }

    // ── INVARIANTES COMERCIAIS ───────────────────────────────────────────────
    const acceptancePolicy = resolveAcceptancePolicy({
      contractSnapshot: context.contract_snapshot,
      serviceSnapshot: context.service_snapshot ?? {},
      clientPurchaseOrderRequirement: context.client_purchase_order_requirement,
    });

    const existingAcceptances = await this.capabilityRepository.listAcceptances(measurementId);

    /**
     * ─────────────────────────────────────────────────────────────────────────
     * IDEMPOTÊNCIA ANTES DE TUDO
     * ─────────────────────────────────────────────────────────────────────────
     *
     * O reenvio do MESMO comando (mesma `idempotencyKey`) precisa devolver o
     * estado atual sem efeito novo. Se a verificação de duplicidade rodasse
     * antes, o retry receberia `ACCEPTANCE_ALREADY_RECORDED` — e um cliente que
     * só perdeu a resposta de um comando BEM-SUCEDIDO leria "já registrado" como
     * falha, quando é o próprio sucesso dele.
     *
     * ORDEM: chave → política → ciclo. A chave é a única que pode responder
     * "isto já aconteceu" sem julgar o negócio: ela identifica o REQUEST, não a
     * decisão. Depois dela, qualquer bloqueio é real.
     */
    const replay = existingAcceptances.find((row) => row.idempotency_key === input.idempotencyKey);
    if (replay) {
      return this.getWorkbench(actor, serviceOrderId, { at });
    }

    const cycle = currentCycle(existingAcceptances);
    const decisionForCycle = existingAcceptances.find((row) => row.cycle_number === cycle) ?? null;

    // ── DOMÍNIO ──────────────────────────────────────────────────────────────
    const outcome = applyAcceptancePolicy({
      measurementId,
      serviceOrderId,
      executionStatus: context.status,
      policy: acceptancePolicy.policy,
      result: input.result,
      observation: input.observation,
      rejectionReason: input.rejectionReason ?? null,
      evidenceId: input.evidenceId ?? null,
      signatureId: input.signatureId ?? null,
      customerSignerName: input.customerSignerName ?? null,
      actorIdentityId: actor.identityId,
      occurredAt,
      currentCycle: cycle,
      existingDecisionForCycle: decisionForCycle
        ? {
            id: decisionForCycle.id,
            cycleNumber: decisionForCycle.cycle_number,
            result: decisionForCycle.result,
            observation: decisionForCycle.observation,
            rejectionReason: decisionForCycle.rejection_reason,
            evidenceId: decisionForCycle.evidence_id,
            signatureId: decisionForCycle.signature_id,
            customerSignerName: decisionForCycle.customer_signer_name,
            acceptedByIdentityId: decisionForCycle.accepted_by_identity_id,
            occurredAt: decisionForCycle.occurred_at,
          }
        : null,
    });

    // ── TRANSAÇÃO ────────────────────────────────────────────────────────────
    const txResult = await this.capabilityRepository.withTransaction(async (client) => {
      const recorded = await this.capabilityRepository.recordAcceptance(client, {
        measurementId,
        serviceOrderId,
        clientId: context.client_id,
        unitId: context.unit_id,
        cycleNumber: cycle,
        policy: acceptancePolicy.policy,
        result: outcome.acceptance.result,
        observation: outcome.acceptance.observation,
        rejectionReason: outcome.rejectionReason,
        evidenceId: input.evidenceId ?? null,
        signatureId: input.signatureId ?? null,
        customerSignerName: input.customerSignerName ?? null,
        actorIdentityId: actor.identityId,
        occurredAt,
        correlationId: input.correlationId ?? null,
        idempotencyKey: input.idempotencyKey,
      });

      if (recorded.outcome !== 'success' && recorded.outcome !== 'already_recorded') {
        // `version_conflict` = a UNIQUE do ciclo barrou uma decisão concorrente;
        // `not_found` = a medição deixou de existir entre a leitura e o INSERT.
        // Os dois são conflito de estado, não erro do cliente.
        return { conflict: true as const };
      }

      // ── REAVALIAÇÃO DA ELEGIBILIDADE, NA MESMA TRANSAÇÃO ───────────────────
      //
      // O estado do aceite é derivado UMA vez, da decisão que acabou de ser
      // gravada. Chamar `deriveAcceptanceState` duas vezes (uma para `state` e
      // outra para `blockingReason`) funcionaria hoje e divergiria no dia em que a
      // derivação passasse a depender de algo além da decisão.
      const acceptanceAfter = deriveAcceptanceState({
        policy: acceptancePolicy.policy,
        latestAcceptance: {
          id: recorded.acceptance.id,
          cycleNumber: recorded.acceptance.cycle_number,
          result: recorded.acceptance.result,
          observation: recorded.acceptance.observation,
          rejectionReason: recorded.acceptance.rejection_reason,
          evidenceId: recorded.acceptance.evidence_id,
          signatureId: recorded.acceptance.signature_id,
          customerSignerName: recorded.acceptance.customer_signer_name,
          acceptedByIdentityId: recorded.acceptance.accepted_by_identity_id,
          occurredAt: recorded.acceptance.occurred_at,
        },
      });
      const previousEligibility = await this.capabilityRepository.findLatestEligibility(
        measurementId,
      );
      const reevaluation = await this.reevaluateEligibility({
        client,
        context,
        measurement,
        acceptancePolicy: acceptancePolicy.policy,
        acceptanceState: acceptanceAfter.state,
        acceptanceBlockingReason: acceptanceAfter.blockingReason,
        actorIdentityId: actor.identityId,
        idempotencySuffix: input.idempotencyKey,
      });

      // ── FATOS NA OUTBOX, DENTRO DO MESMO COMMIT ────────────────────────────
      await this.outboxWriter.appendCustomerAcceptanceRecorded(client, {
        serviceOrderId,
        measurementId,
        unitId: context.unit_id,
        orderNumber: context.order_number,
        acceptanceId: recorded.acceptance.id,
        cycleNumber: recorded.acceptance.cycle_number,
        result: outcome.acceptance.result,
        rejectionReason: outcome.rejectionReason,
        occurredAt,
      });

      if (transitionedToReady(previousEligibility?.result as never, reevaluation.decision.result)) {
        await this.outboxWriter.appendBillingEligibilityGranted(client, {
          serviceOrderId,
          measurementId,
          unitId: context.unit_id,
          orderNumber: context.order_number,
          totalAmount: reevaluation.decision.totalAmount,
          currencyCode: reevaluation.decision.currencyCode,
          releasedAt: at,
        });
      } else if (
        transitionedAwayFromReady(previousEligibility?.result as never, reevaluation.decision.result)
      ) {
        await this.outboxWriter.appendBillingEligibilityBlocked(client, {
          serviceOrderId,
          measurementId,
          unitId: context.unit_id,
          orderNumber: context.order_number,
          blockingReasons: reevaluation.decision.blockingReasons,
          evaluatedAt: at,
        });
      }

      return {
        conflict: false as const,
        acceptanceId: recorded.acceptance.id,
        eventType: outcome.domainEventType,
        eligibilityResult: reevaluation.decision.result,
      };
    });

    if (txResult.conflict) {
      throw measurementsVersionConflict();
    }

    await this.audit(actor, serviceOrderId, 'RECORD_ACCEPTANCE', {
      measurementId,
      acceptanceId: txResult.acceptanceId,
      result: outcome.acceptance.result,
      policy: acceptancePolicy.policy,
      eligibilityResult: txResult.eligibilityResult,
    });

    return this.getWorkbench(actor, serviceOrderId, { at });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APOIO — FATOS E DECISÃO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Monta os fatos da elegibilidade.
   *
   * CADA CAMPO É UM FATO OBSERVADO. Onde o fato não existe, o campo é `null` e a
   * dimensão correspondente declara a lacuna — este método não preenche ausência
   * com suposição.
   */
  private buildEligibilityFacts(input: {
    context: NonNullable<Awaited<ReturnType<MeasurementCapabilityRepository['loadCommercialContext']>>>;
    measurement: MeasurementRow | null;
    items: MeasurementItemRow[];
    closure: Awaited<ReturnType<MeasurementCapabilityRepository['findClosure']>>;
    acceptancePolicy: string;
    acceptanceState: string;
    acceptanceBlockingReason: string | null;
    variancesRequiringDecision: number;
    varianceBlockingReason: string | null;
    policy: string;
    billingRecordPrepared: boolean;
  }): BillingEligibilityFacts {
    const pricedItems = input.items.filter((item) => item.line_amount !== null);
    const total =
      input.items.length > 0 && pricedItems.length === input.items.length
        ? sumDecimals(pricedItems.map((item) => item.line_amount as string))
        : null;

    const clientPoRequirement = input.context.client_purchase_order_requirement;
    const purchaseOrderRequired =
      clientPoRequirement === PURCHASE_ORDER_REQUIREMENTS.BeforeBilling ||
      clientPoRequirement === PURCHASE_ORDER_REQUIREMENTS.BeforeExecution ||
      input.context.service_snapshot?.['requiresPurchaseOrder'] === true;

    const authoritativeTerms = readAuthoritativePaymentTerms(input.context);
    const declaredTerms = readNullableString(
      input.context.service_snapshot?.['paymentTerms'] ?? null,
    );

    return {
      serviceOrderId: input.context.service_order_id,
      measurementId: input.measurement?.id ?? null,
      unitId: input.context.unit_id,
      executionClosed: input.closure !== null,
      executionClosedAt: input.closure?.closed_at ?? null,
      measurementStatus: input.measurement?.status ?? null,
      measurementApprovedAt: input.measurement?.decided_at ?? null,
      measurementTotalAmount: total,
      measurementCurrencyCode: total === null ? null : readCurrency(input.items),
      measurementItemCount: input.items.length,
      acceptanceRequired: requiresCustomerAcceptance(input.acceptancePolicy as never),
      acceptanceState: input.acceptanceState,
      acceptanceBlockingReason: input.acceptanceBlockingReason,
      variancesRequiringDecision: input.variancesRequiringDecision,
      varianceBlockingReason: input.varianceBlockingReason,
      policy: input.policy as never,
      purchaseOrderRequired,
      purchaseOrderPresent: input.context.purchase_order_id !== null,
      commercialTermsAuthoritative: authoritativeTerms,
      commercialTermsDeclared: declaredTerms,
      commercialTermsMismatch: detectCommercialTermsMismatch(authoritativeTerms, declaredTerms),
      billingRecordPrepared: input.billingRecordPrepared,
    };
  }

  /** Reavalia e PERSISTE a elegibilidade dentro da transação do comando. */
  private async reevaluateEligibility(input: {
    client: Parameters<Parameters<MeasurementCapabilityRepository['withTransaction']>[0]>[0];
    context: NonNullable<Awaited<ReturnType<MeasurementCapabilityRepository['loadCommercialContext']>>>;
    measurement: MeasurementRow;
    acceptancePolicy: string;
    acceptanceState: string;
    acceptanceBlockingReason: string | null;
    actorIdentityId: string;
    idempotencySuffix: string;
  }): Promise<{ decision: ReturnType<typeof evaluateBillingEligibility> }> {
    const [items, closure, prepared] = await Promise.all([
      this.measurementsRepository.listItems(input.measurement.id),
      this.capabilityRepository.findClosure(input.context.service_order_id),
      this.capabilityRepository.hasPreparedBillingRecord(input.context.service_order_id),
    ]);
    const variances = await this.capabilityRepository.listVariances(input.measurement.id);

    const facts = this.buildEligibilityFacts({
      context: input.context,
      measurement: input.measurement,
      items,
      closure,
      acceptancePolicy: input.acceptancePolicy,
      acceptanceState: input.acceptanceState,
      acceptanceBlockingReason: input.acceptanceBlockingReason,
      variancesRequiringDecision: variances.filter((row) => row.requires_decision).length,
      varianceBlockingReason:
        variances.find((row) => row.requires_decision && row.blocking_reason !== null)
          ?.blocking_reason ?? null,
      policy: resolveBillingEntitlementPolicy(input.context.service_snapshot ?? {}),
      billingRecordPrepared: prepared,
    });

    const decision = evaluateBillingEligibility(facts);

    await this.capabilityRepository.recordEligibility(input.client, {
      measurementId: input.measurement.id,
      serviceOrderId: input.context.service_order_id,
      unitId: input.context.unit_id,
      measurementRowVersion: input.measurement.row_version,
      policy: facts.policy,
      result: decision.result,
      dimensions: decision.dimensions,
      blockingReasons: decision.blockingReasons,
      totalAmount: decision.totalAmount,
      currencyCode: decision.currencyCode,
      grantedAt: decision.result === ELIGIBILITY_RESULTS.Ready ? new Date().toISOString() : null,
      actorIdentityId: input.actorIdentityId,
    });

    return { decision };
  }

  private async loadEvidence(
    measurement: MeasurementRow | null,
  ): Promise<Array<{ id: string; kind: string; status: string; recordedAt: string }>> {
    if (!measurement) {
      return [];
    }
    return [];
  }

  private async assertReadAccess(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ): Promise<void> {
    await this.assertAction(actor, serviceOrderId, AUTHZ_ACTIONS.MeasurementsMeasurementRead);
  }

  private async assertAction(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
  ): Promise<void> {
    const order = await this.serviceOrdersRepository.findById(serviceOrderId);
    if (!order) {
      throw measurementsAccessNotFound();
    }
    await this.authz.assertMeasurementAction(actor, action, order);
  }

  private async audit(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    command: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.MeasurementsMeasurementUpdate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { command, ...metadata },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APOIO PURO
// ═══════════════════════════════════════════════════════════════════════════════

function severityForStage(stage: string): string {
  switch (stage) {
    case LEAKAGE_STAGES.ApprovedNotAccepted:
    case LEAKAGE_STAGES.AcceptedNotBillable:
      return 'P2';
    case LEAKAGE_STAGES.ReadyNotPrepared:
      return 'P3';
    default:
      return 'P3';
  }
}

function readNullableString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : null;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return null;
}

function readSnapshotLabel(
  snapshot: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!snapshot) {
    return null;
  }
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function readCurrency(items: MeasurementItemRow[]): string | null {
  for (const item of items) {
    const currency = item.pricing_line_snapshot?.['currencyCode'];
    if (typeof currency === 'string' && currency.trim().length > 0) {
      return currency;
    }
  }
  return null;
}

function readPricingSource(items: MeasurementItemRow[]): string | null {
  const first = items[0]?.pricing_line_snapshot;
  if (!first) {
    return null;
  }
  const source = first['source'];
  if (typeof source === 'string') {
    return source;
  }
  return typeof first['modelCode'] === 'string' ? 'PRICING_MODEL' : null;
}

function readAuthoritativePaymentTerms(
  context: NonNullable<
    Awaited<ReturnType<MeasurementCapabilityRepository['loadCommercialContext']>>
  >,
): string | null {
  for (const snapshot of [
    context.purchase_order_snapshot,
    context.contract_snapshot,
    context.service_snapshot,
  ]) {
    const value = snapshot?.['paymentTerms'];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function sumDecimals(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? sum + parsed : sum;
  }, 0);
  return total.toFixed(4);
}

function measurementNumber(orderNumber: string, measurement: MeasurementRow): string {
  // O número da medição deriva do número da OS e da versão do agregado: é único,
  // legível e estável — não um UUID que ninguém consegue citar ao telefone.
  return `${orderNumber}-M${measurement.row_version}`;
}

/**
 * QUAL CICLO DE ACEITE É O CORRENTE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTA FUNÇÃO CORRIGE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * A primeira versão devolvia SEMPRE `último + 1`. O efeito: depois de um aceite
 * ACEITO, o ciclo corrente virava 2 — e o segundo comando de aceite passava pela
 * validação de duplicidade, criando uma SEGUNDA decisão sobre a mesma entrega. O
 * sistema aceitava ser aceito duas vezes, que é exatamente o que a UNIQUE
 * parcial e a regra de domínio existiam para impedir.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRA CORRETA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   última decisão = ACEITE   → o ciclo CORRENTE é o DELA      (não abre novo)
 *   última decisão = RECUSA   → o ciclo CORRENTE é o próximo   (corrigir e pedir
 *                                novo aceite é um ciclo novo)
 *   sem decisão              → ciclo 1
 *
 * Um aceite encerra a negociação; ele não a reabre. Uma recusa reabre, porque há
 * trabalho de correção a fazer e a nova decisão precisa de identidade própria —
 * a recusa permanece na história como a CAUSA da correção.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRA É A DO BANCO, TAMBÉM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `customer_acceptances_cycle_uidx` garante UMA decisão por ciclo. Com esta
 * correção, o segundo aceite tenta o MESMO ciclo e recebe 409 — a aplicação e o
 * banco concordam sobre o que é o ciclo corrente. Antes divergiam: a aplicação
 * abria um ciclo novo e o banco aceitava a segunda decisão sem reclamar.
 */
function currentCycle(acceptances: Array<{ cycle_number: number; result: string }>): number {
  if (acceptances.length === 0) {
    return 1;
  }
  const latest = acceptances[acceptances.length - 1]!;
  return latest.result === 'REJECTED' ? latest.cycle_number + 1 : latest.cycle_number;
}

/**
 * AS TRÊS VERDADES DA MEDIÇÃO, por unidade.
 *
 * Elas vêm de fontes DIFERENTES e por isso são três campos: planejado do item
 * (congelado da base), realizado do item (congelado na base) e medido do item
 * (o reconhecimento comercial). Somar tudo num só número apagaria a decisão.
 */
function buildQuantityLines(
  basisLines: unknown,
  items: MeasurementItemRow[],
): { lines: WorkbenchQuantityLine[]; totals: { planned: number; actual: number; measured: number } } {
  const byUnit = new Map<string, WorkbenchQuantityLine>();

  const ensure = (unitCode: string): WorkbenchQuantityLine => {
    const existing = byUnit.get(unitCode);
    if (existing) {
      return existing;
    }
    const created: WorkbenchQuantityLine = {
      dimensionKey: unitCode,
      label: varianceDimensionLabel(unitCode as VarianceDimension) === unitCode ? unitCode : varianceDimensionLabel(unitCode as VarianceDimension),
      unitOfMeasure: unitCode,
      planned: null,
      actual: null,
      measured: null,
    };
    byUnit.set(unitCode, created);
    return created;
  };

  for (const rawLine of parseLinesForDisplay(basisLines)) {
    const line = ensure(rawLine.unitCode);
    line.actual = rawLine.actualQuantity;
    line.planned = rawLine.plannedQuantity;
  }

  for (const item of items) {
    const line = ensure(item.unit_code);
    const extended = item as unknown as Record<string, unknown>;
    const planned = readNullableString(extended['planned_quantity']);
    if (planned !== null) {
      line.planned = planned;
    }
    line.actual = item.actual_quantity;
    line.measured = item.measured_quantity;
  }

  const lines = [...byUnit.values()];
  return {
    lines,
    totals: {
      planned: sumNumeric(lines.map((item) => item.planned)),
      actual: sumNumeric(lines.map((item) => item.actual)),
      measured: sumNumeric(lines.map((item) => item.measured)),
    },
  };
}

function sumNumeric(values: Array<string | null>): number {
  return values.reduce((sum, value) => {
    if (value === null) {
      return sum;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? sum + parsed : sum;
  }, 0);
}

function parseLinesForDisplay(raw: unknown): Array<{
  lineKey: string;
  unitCode: string;
  actualQuantity: string;
  plannedQuantity: string | null;
  recordCount: number;
  source: string;
}> {
  try {
    return parseMeasurementBasisLines(raw);
  } catch {
    // Base malformada NÃO derruba a leitura: a tela mostra o que existe e a
    // criação da medição recusa com motivo declarado, onde a correção acontece.
    return [];
  }
}

/**
 * Observações para o motor de variação.
 *
 * Uma linha por unidade de medida, com as TRÊS quantidades. A dimensão é a
 * unidade da base quando ela é uma dimensão de negócio conhecida, e `QUANTITY`
 * caso contrário — declarado, nunca adivinhado por padrão de texto.
 */
function buildVarianceObservations(items: MeasurementItemRow[]): VarianceObservation[] {
  return items.map((item) => {
    const extended = item as unknown as Record<string, unknown>;
    return {
      dimension: mapUnitToDimension(item.unit_code),
      dimensionKey: item.unit_code,
      plannedValue: readNullableString(extended['planned_quantity']),
      actualValue: item.actual_quantity,
      measuredValue: item.measured_quantity,
      unitOfMeasure: item.unit_code,
      unitPrice: item.unit_price,
      currencyCode: readNullableString(item.pricing_line_snapshot?.['currencyCode']) ?? 'BRL',
      measurementItemId: item.id,
    };
  });
}

/**
 * Mapeia a unidade de medida para a DIMENSÃO de negócio.
 *
 * A base publicada pelo fechamento agrega por `unit_of_measure`, que é a unidade
 * do catálogo (`H`, `UN`, `KM`, `L`). O mapa abaixo é DECLARADO: uma unidade
 * desconhecida vira `QUANTITY`, que é a dimensão genérica — nunca uma dimensão
 * específica escolhida por semelhança de texto.
 */
function mapUnitToDimension(unitCode: string): VarianceDimension {
  switch (unitCode.trim().toUpperCase()) {
    case 'H':
      return 'LABOR_HOURS';
    case 'KM':
      return 'VEHICLE_DISTANCE';
    case 'L':
      return 'FUEL_VOLUME';
    case 'KG':
    case 'T':
      return 'MATERIAL_QUANTITY';
    case 'BRL':
    case 'R$':
      return 'THIRD_PARTY_AMOUNT';
    default:
      return 'QUANTITY';
  }
}

function inferOwner(eligibility: ReturnType<typeof evaluateBillingEligibility>): string {
  const first = eligibility.dimensions.find((item) => item.blocking);
  switch (first?.dimension) {
    case 'CUSTOMER_ACCEPTANCE':
    case 'COMMERCIAL_TERMS':
    case 'PURCHASE_ORDER':
      return 'COMERCIAL';
    case 'BILLING_RECORD_ABSENT':
    case 'PRICING_BASIS':
      return 'FATURAMENTO';
    default:
      return 'OPERACOES';
  }
}

function buildApprovalExplanation(
  detection: ReturnType<typeof detectMeasurementVariances>,
  surface: ReturnType<typeof buildMeasurementCommandSurface>,
): string {
  const approve = surface.availableCommands.find(
    (item) => item.code === MEASUREMENT_SURFACE_COMMANDS.Approve,
  );
  if (approve?.enabled) {
    return 'A aprovação está liberada: não há variação acima da tolerância aguardando decisão.';
  }
  const first = detection.decisionRequired[0];
  return first
    ? `A aprovação está bloqueada até a decisão sobre a variação. ${first.explanation}`
    : 'A aprovação não está liberada neste estado da medição.';
}

function buildWorkbenchSituations(input: {
  eligibility: ReturnType<typeof evaluateBillingEligibility>;
  acceptanceState: ReturnType<typeof deriveAcceptanceState>;
  varianceDetection: ReturnType<typeof detectMeasurementVariances>;
  measurement: MeasurementRow | null;
}): Array<{
  code: string;
  severity: string;
  title: string;
  detail: string;
  ownerRole: string;
  nextBestAction: string;
  blocking: boolean;
}> {
  const situations: Array<{
    code: string;
    severity: string;
    title: string;
    detail: string;
    ownerRole: string;
    nextBestAction: string;
    blocking: boolean;
  }> = [];

  if (input.measurement === null) {
    situations.push({
      code: 'EXECUTED_NOT_MEASURED',
      severity: 'P2',
      title: 'Execução fechada sem medição',
      detail: 'A base de medição está publicada e nenhuma medição foi criada.',
      ownerRole: 'OPERACOES',
      nextBestAction: 'CREATE_MEASUREMENT',
      blocking: true,
    });
  }

  if (input.varianceDetection.decisionRequired.length > 0) {
    situations.push({
      code: 'MEASUREMENT_VARIANCE_REQUIRES_DECISION',
      severity: input.varianceDetection.highestSeverity === 'CRITICAL' ? 'P1' : 'P2',
      title: 'Variação acima da tolerância aguarda decisão',
      detail: input.varianceDetection.summary,
      ownerRole: 'COMERCIAL',
      nextBestAction: 'AUTHORIZE_ADJUSTMENT',
      blocking: true,
    });
  }

  if (input.measurement?.status === MEASUREMENT_STATUSES.Rejected) {
    situations.push({
      code: 'MEASUREMENT_REJECTED',
      severity: 'P2',
      title: 'Medição rejeitada na análise',
      detail: input.measurement.rejection_reason ?? 'A medição foi rejeitada e exige correção.',
      ownerRole: 'OPERACOES',
      nextBestAction: 'RESUBMIT_MEASUREMENT',
      blocking: true,
    });
  }

  if (input.acceptanceState.blockingReason === 'CUSTOMER_ACCEPTANCE_PENDING') {
    situations.push({
      code: 'CUSTOMER_ACCEPTANCE_PENDING',
      severity: 'P2',
      title: 'Aceite do cliente pendente',
      detail: 'A política comercial exige aceite de entrega antes do faturamento.',
      ownerRole: 'COMERCIAL',
      nextBestAction: 'OBTAIN_CUSTOMER_ACCEPTANCE',
      blocking: true,
    });
  }

  if (input.acceptanceState.blockingReason === 'CUSTOMER_ACCEPTANCE_REJECTED') {
    situations.push({
      code: 'CUSTOMER_REJECTED',
      severity: 'P1',
      title: 'Cliente recusou a entrega',
      detail: 'O cliente registrou recusa; o faturamento está bloqueado até a correção.',
      ownerRole: 'COMERCIAL',
      nextBestAction: 'CORRECT_AND_REQUEST_ACCEPTANCE',
      blocking: true,
    });
  }

  for (const dimension of input.eligibility.dimensions) {
    if (!dimension.blocking) {
      continue;
    }
    if (
      dimension.dimension === 'CUSTOMER_ACCEPTANCE' ||
      dimension.dimension === 'MEASUREMENT_APPROVED'
    ) {
      // Já cobertas acima com vocabulário de situação própria. Duplicar criaria
      // dois itens para o mesmo trabalho.
      continue;
    }
    situations.push({
      code:
        dimension.reasonCode === 'PURCHASE_ORDER_REQUIRED'
          ? 'BILLING_ENTITLEMENT_BLOCKED'
          : dimension.reasonCode === 'COMMERCIAL_TERMS_DIVERGENCE'
            ? 'COMMERCIAL_TERMS_DIVERGENCE'
            : 'BILLING_ENTITLEMENT_BLOCKED',
      severity: dimension.status === 'BLOCKED' ? 'P2' : 'P3',
      title: dimension.label,
      detail: dimension.detail,
      ownerRole: inferOwner(input.eligibility),
      nextBestAction: dimension.nextActionCode ?? 'RESOLVE_BILLING_BLOCKER',
      blocking: true,
    });
  }

  if (input.eligibility.result === ELIGIBILITY_RESULTS.Ready && input.measurement !== null) {
    situations.push({
      code: 'READY_NOT_PREPARED',
      severity: 'P3',
      title: 'Pronto para faturar',
      detail: 'Todas as condições comerciais foram atendidas; falta preparar o faturamento.',
      ownerRole: 'FATURAMENTO',
      nextBestAction: 'PREPARE_BILLING',
      blocking: false,
    });
  }

  return situations;
}

function buildRelationships(
  context: NonNullable<
    Awaited<ReturnType<MeasurementCapabilityRepository['loadCommercialContext']>>
  >,
): Array<{ kind: string; reference: string; label: string }> {
  const relationships: Array<{ kind: string; reference: string; label: string }> = [];
  if (context.contract_reference) {
    relationships.push({
      kind: 'CONTRACT',
      reference: context.contract_reference,
      label: 'Contrato',
    });
  }
  if (context.proposal_id) {
    relationships.push({ kind: 'PROPOSAL', reference: context.proposal_id, label: 'Proposta' });
  }
  if (context.purchase_order_id) {
    relationships.push({
      kind: 'PURCHASE_ORDER',
      reference: context.purchase_order_id,
      label: 'Ordem de compra',
    });
  }
  if (context.client_id) {
    relationships.push({ kind: 'CLIENT', reference: context.client_id, label: 'Cliente' });
  }
  return relationships;
}

/**
 * DOCUMENT FLOW — quais artefatos de negócio existem, e como navegar.
 *
 * Responde uma pergunta DIFERENTE do processo: o processo diz em que estágio
 * estamos; o fluxo de documentos diz QUAIS artefatos existem. Os dois são
 * publicados separadamente porque a mesma OS pode estar no estágio de aceite com
 * cinco documentos criados — e um único campo não responderia às duas perguntas.
 */
function buildDocumentFlow(input: {
  context: NonNullable<
    Awaited<ReturnType<MeasurementCapabilityRepository['loadCommercialContext']>>
  >;
  measurement: MeasurementRow | null;
  closureId: string | null;
  basisId: string | null;
  billingPrepared: boolean;
}): Array<{
  step: number;
  kind: string;
  reference: string | null;
  label: string;
  state: 'EXISTS' | 'ABSENT';
  href: string | null;
}> {
  const orderHref = `/app/service-orders/${input.context.service_order_id}`;
  const steps: Array<{
    kind: string;
    reference: string | null;
    label: string;
    href: string | null;
  }> = [
    {
      kind: 'CONTRACT',
      reference: input.context.contract_reference,
      label: 'Contrato',
      href: input.context.contract_reference ? '/app/contracts' : null,
    },
    {
      kind: 'PROPOSAL',
      reference: input.context.proposal_id,
      label: 'Proposta',
      href: input.context.proposal_id ? '/app/proposals' : null,
    },
    {
      kind: 'PURCHASE_ORDER',
      reference: input.context.purchase_order_id,
      label: 'Ordem de compra',
      href: input.context.purchase_order_id ? '/app/purchase-orders' : null,
    },
    {
      kind: 'SERVICE_ORDER',
      reference: input.context.order_number,
      label: 'Ordem de serviço',
      href: orderHref,
    },
    {
      kind: 'EXECUTION_CLOSURE',
      reference: input.closureId,
      label: 'Fechamento da execução',
      href: `${orderHref}/execution`,
    },
    {
      kind: 'MEASUREMENT_BASIS',
      reference: input.basisId,
      label: 'Base de medição',
      href: `${orderHref}/measurement`,
    },
    {
      kind: 'MEASUREMENT',
      reference: input.measurement?.id ?? null,
      label: 'Medição',
      href: `${orderHref}/measurement`,
    },
    {
      kind: 'BILLING_RECORD',
      reference: null,
      label: 'Registro de faturamento',
      href: input.billingPrepared ? `${orderHref}/billing` : `${orderHref}/measurement`,
    },
    {
      kind: 'RECEIVABLE',
      reference: null,
      label: 'Recebível',
      href: '/app/finance/receivables',
    },
  ];

  return steps.map((step, index) => ({
    step: index + 1,
    kind: step.kind,
    reference: step.reference,
    label: step.label,
    state:
      step.kind === 'BILLING_RECORD'
        ? input.billingPrepared
          ? 'EXISTS'
          : 'ABSENT'
        : step.reference !== null
          ? 'EXISTS'
          : 'ABSENT',
    href: step.reference !== null || step.kind === 'BILLING_RECORD' ? step.href : null,
  }));
}

function buildTimeline(
  historyEvents: Array<{
    id: string;
    event_type: string;
    payload: Record<string, unknown>;
    actor_identity_id: string | null;
    occurred_at: string;
  }>,
  acceptances: Array<{
    id: string;
    cycle_number: number;
    result: string;
    rejection_reason: string | null;
    accepted_by_identity_id: string;
    occurred_at: string;
  }>,
  at: string,
): WorkbenchTimelineEvent[] {
  const events: WorkbenchTimelineEvent[] = historyEvents.map((row) => ({
    at: row.occurred_at,
    kind: row.event_type,
    label: measurementHistoryLabel(row.event_type),
    detail: readTimelineDetail(row.payload),
    actorIdentityId: row.actor_identity_id,
  }));

  for (const row of acceptances) {
    events.push({
      at: row.occurred_at,
      kind: row.result === 'ACCEPTED' ? 'CUSTOMER_ACCEPTANCE_RECORDED' : 'CUSTOMER_REJECTION_RECORDED',
      label:
        row.result === 'ACCEPTED'
          ? `Aceite do cliente registrado (ciclo ${row.cycle_number})`
          : `Recusa do cliente registrada (ciclo ${row.cycle_number})`,
      detail: row.rejection_reason,
      actorIdentityId: row.accepted_by_identity_id,
    });
  }

  // Ordem cronológica estável: o instante, e o tipo como desempate.
  return events.sort((left, right) => {
    const byTime = new Date(left.at).getTime() - new Date(right.at).getTime();
    if (byTime !== 0) {
      return byTime;
    }
    return left.kind.localeCompare(right.kind);
  });

  void at;
}

function measurementHistoryLabel(eventType: string): string {
  const labels: Record<string, string> = {
    CREATED: 'Medição criada a partir da base publicada',
    REGENERATED: 'Itens regerados',
    ITEM_UPDATED: 'Quantidade medida alterada',
    ADJUSTMENT_AUTHORIZED: 'Ajuste autorizado',
    SUBMITTED: 'Medição submetida',
    REVIEW_STARTED: 'Análise iniciada',
    APPROVED: 'Medição aprovada',
    REJECTED: 'Medição rejeitada',
    RESUBMITTED: 'Medição reenviada',
  };
  return labels[eventType] ?? eventType;
}

function readTimelineDetail(payload: Record<string, unknown>): string | null {
  for (const key of ['rejectionReason', 'reason', 'measuredQuantity', 'adjustmentQuantity']) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

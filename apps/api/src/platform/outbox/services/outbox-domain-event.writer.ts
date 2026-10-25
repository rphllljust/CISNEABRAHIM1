import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  AGGREGATE_TYPES,
  DOMAIN_EVENT_TYPES,
} from '../../../events/domain/domain-event-type';
import {
  ECONOMIC_EVENT_KINDS,
  type EconomicEventKind,
  type EconomicEventPayloadV1,
  economicEventIdempotencyKey,
} from '../../bounded-contexts/economic-event-contract';
import {
  assertAuthorizationIndependentPayload,
  buildBillingEligibilityBlockedPayloadV1,
  buildBillingEligibilityGrantedPayloadV1,
  buildBillingReadyPayloadV1,
  buildCustomerAcceptanceRecordedPayloadV1,
  buildExecutionCompletedPayloadV1,
  buildExecutionExceptionReportedPayloadV1,
  buildMeasurementAdjustmentAuthorizedPayloadV1,
  buildMeasurementApprovedPayloadV1,
  buildMeasurementBasisReadyPayloadV1,
  buildMeasurementCreatedPayloadV1,
  buildMeasurementSubmittedPayloadV1,
  buildResourceUsageRecordedPayloadV1,
  buildServiceExecutionPausedPayloadV1,
  buildServiceExecutionResumedPayloadV1,
  buildServiceExecutionStartedPayloadV1,
  buildServiceOrderAssignedPayloadV1,
  buildServiceOrderCompletedPayloadV1,
  buildServiceOrderDispatchedPayloadV1,
  buildServiceOrderReleasedPayloadV1,
  buildServiceProgressRecordedPayloadV1,
  buildServiceRequestSubmittedPayloadV1,
} from '../../../events/domain/event-payloads.v1';
import { OutboxRepository } from '../repositories/outbox.repository';

@Injectable()
export class OutboxDomainEventWriter {
  constructor(private readonly outboxRepository: OutboxRepository) {}

  async appendServiceRequestSubmitted(
    client: PoolClient,
    input: {
      serviceRequestId: string;
      unitId: string;
      clientId: string | null;
      submittedAt: string;
    },
  ): Promise<void> {
    const payload = buildServiceRequestSubmittedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ServiceRequestSubmitted,
      aggregateType: AGGREGATE_TYPES.ServiceRequest,
      aggregateId: input.serviceRequestId,
      payload,
      occurredAt: input.submittedAt,
      idempotencyKey: `service-request:${input.serviceRequestId}:submitted`,
    });
  }

  async appendServiceOrderReleased(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      clientId: string | null;
      orderNumber: string;
      releasedAt: string;
    },
  ): Promise<void> {
    const payload = buildServiceOrderReleasedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ServiceOrderReleased,
      aggregateType: AGGREGATE_TYPES.ServiceOrder,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.releasedAt,
      idempotencyKey: `service-order:${input.serviceOrderId}:released`,
    });
  }

  async appendServiceOrderAssigned(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      allocationId: string;
      physicalAssetId: string | null;
      workforceMemberId?: string | null;
      resourceTypeCode: string;
      assignedAt: string;
    },
  ): Promise<void> {
    const payload = buildServiceOrderAssignedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ServiceOrderAssigned,
      aggregateType: AGGREGATE_TYPES.ServiceOrder,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.assignedAt,
      idempotencyKey: `service-order:${input.serviceOrderId}:allocation:${input.allocationId}`,
    });
  }

  async appendServiceOrderCompleted(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      clientId: string | null;
      orderNumber: string;
      completedAt: string;
    },
  ): Promise<void> {
    const payload = buildServiceOrderCompletedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ServiceOrderCompleted,
      aggregateType: AGGREGATE_TYPES.ServiceOrder,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.completedAt,
      idempotencyKey: `service-order:${input.serviceOrderId}:completed`,
    });
  }

  async appendMeasurementSubmitted(
    client: PoolClient,
    input: {
      measurementId: string;
      serviceOrderId: string;
      unitId: string;
      submittedAt: string;
    },
  ): Promise<void> {
    const payload = buildMeasurementSubmittedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.MeasurementSubmitted,
      aggregateType: AGGREGATE_TYPES.Measurement,
      aggregateId: input.measurementId,
      payload,
      occurredAt: input.submittedAt,
      idempotencyKey: `measurement:${input.measurementId}:submitted`,
    });
  }

  async appendMeasurementApproved(
    client: PoolClient,
    input: {
      measurementId: string;
      serviceOrderId: string;
      unitId: string;
      approvedAt: string;
    },
  ): Promise<void> {
    const payload = buildMeasurementApprovedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.MeasurementApproved,
      aggregateType: AGGREGATE_TYPES.Measurement,
      aggregateId: input.measurementId,
      payload,
      occurredAt: input.approvedAt,
      idempotencyKey: `measurement:${input.measurementId}:approved`,
    });
  }

  async appendBillingReady(
    client: PoolClient,
    input: {
      billingRecordId: string;
      serviceOrderId: string;
      measurementId: string | null;
      unitId: string;
      totalAmount: string;
      preparedAt: string;
    },
  ): Promise<void> {
    const payload = buildBillingReadyPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.BillingReady,
      aggregateType: AGGREGATE_TYPES.BillingRecord,
      aggregateId: input.billingRecordId,
      payload,
      occurredAt: input.preparedAt,
      idempotencyKey: `billing-record:${input.billingRecordId}:ready`,
    });
  }

  /**
   * F1.1 — FATO ECONÔMICO.
   *
   * Publica o evento que ACCOUNTING consome para decidir posting. Chamado SEMPRE
   * dentro da transação do comando financeiro (`PoolClient` recebido do chamador),
   * de modo que `COMMIT` do estado econômico e `INSERT` do evento são atômicos: ou
   * ambos existem, ou nenhum.
   *
   * Devolve o `outboxEventId` para que o chamador grave em `fin.economic_events` a
   * trilha `fato → transporte`, sem segunda chamada de rede.
   */
  async appendEconomicEvent(
    client: PoolClient,
    input: {
      aggregateType: string;
      aggregateId: string;
      occurredAt: string;
      payload: EconomicEventPayloadV1;
    },
  ): Promise<string> {
    const eventType = domainEventTypeForEconomicEvent(input.payload.eventKind);
    return this.outboxRepository.append(
      {
        eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload,
        occurredAt: input.occurredAt,
        idempotencyKey: economicEventIdempotencyKey({
          eventKind: input.payload.eventKind,
          sourceId: input.payload.sourceId,
          reversesSourceId: input.payload.reversesSourceId,
        }),
      },
      client,
    );
  }

  private async append(
    client: PoolClient,
    input: {
      eventType: (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES];
      aggregateType: string;
      aggregateId: string;
      payload: Record<string, unknown>;
      occurredAt: string;
      idempotencyKey: string;
    },
  ): Promise<void> {
    assertAuthorizationIndependentPayload(input.payload);
    await this.outboxRepository.append(input, client);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // DISPATCH + EXECUTION + ACTUALS
  // ═════════════════════════════════════════════════════════════════════════════
  //
  // Todos recebem o `PoolClient` do comando: o evento nasce na MESMA transação do
  // estado. Se o COMMIT falha, o evento não existe — nunca há fato órfão nem
  // evento publicado para estado que não mudou.
  //
  // A `idempotencyKey` de cada um deriva do FATO (id do registro + natureza), não
  // do request: reenviar o comando com outra chave não duplica o evento.

  async appendServiceOrderDispatched(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      clientId: string | null;
      orderNumber: string;
      dispatchId: string;
      windowStart: string;
      windowEnd: string;
      confirmedResourceCount: number;
      dispatchedAt: string;
    },
  ): Promise<void> {
    const payload = buildServiceOrderDispatchedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ServiceOrderDispatched,
      aggregateType: AGGREGATE_TYPES.ServiceExecution,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.dispatchedAt,
      idempotencyKey: `service-execution:${input.serviceOrderId}:dispatched`,
    });
  }

  async appendServiceExecutionStarted(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      clientId: string | null;
      orderNumber: string;
      startedAt: string;
    },
  ): Promise<void> {
    const payload = buildServiceExecutionStartedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ServiceExecutionStarted,
      aggregateType: AGGREGATE_TYPES.ServiceExecution,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.startedAt,
      idempotencyKey: `service-execution:${input.serviceOrderId}:started`,
    });
  }

  async appendServiceExecutionPaused(
    client: PoolClient,
    input: { serviceOrderId: string; unitId: string; pausedAt: string },
  ): Promise<void> {
    const payload = buildServiceExecutionPausedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ServiceExecutionPaused,
      aggregateType: AGGREGATE_TYPES.ServiceExecution,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.pausedAt,
      // Pausar pode acontecer várias vezes numa ordem: a chave carrega o instante.
      idempotencyKey: `service-execution:${input.serviceOrderId}:paused:${input.pausedAt}`,
    });
  }

  async appendServiceExecutionResumed(
    client: PoolClient,
    input: { serviceOrderId: string; unitId: string; resumedAt: string },
  ): Promise<void> {
    const payload = buildServiceExecutionResumedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ServiceExecutionResumed,
      aggregateType: AGGREGATE_TYPES.ServiceExecution,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.resumedAt,
      idempotencyKey: `service-execution:${input.serviceOrderId}:resumed:${input.resumedAt}`,
    });
  }

  async appendServiceProgressRecorded(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      entryId: string;
      progressKind: string;
      quantityValue: string | null;
      unitCode: string | null;
      recordedAt: string;
    },
  ): Promise<void> {
    const payload = buildServiceProgressRecordedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ServiceProgressRecorded,
      aggregateType: AGGREGATE_TYPES.ServiceExecution,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.recordedAt,
      idempotencyKey: `service-execution:${input.serviceOrderId}:progress:${input.entryId}`,
    });
  }

  async appendResourceUsageRecorded(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      actualId: string;
      actualKind: string;
      actualValue: string;
      unitOfMeasure: string;
      physicalAssetId: string | null;
      workforceMemberId: string | null;
      occurredAt: string;
    },
  ): Promise<void> {
    const payload = buildResourceUsageRecordedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ResourceUsageRecorded,
      aggregateType: AGGREGATE_TYPES.ServiceExecution,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.occurredAt,
      idempotencyKey: `service-execution:${input.serviceOrderId}:actual:${input.actualId}`,
    });
  }

  async appendExecutionExceptionReported(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      occurrenceId: string;
      occurrenceCode: string;
      reportedAt: string;
    },
  ): Promise<void> {
    const payload = buildExecutionExceptionReportedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ExecutionExceptionReported,
      aggregateType: AGGREGATE_TYPES.ServiceExecution,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.reportedAt,
      idempotencyKey: `service-execution:${input.serviceOrderId}:exception:${input.occurrenceId}`,
    });
  }

  async appendExecutionCompleted(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      clientId: string | null;
      orderNumber: string;
      executionClosureId: string;
      actualCount: number;
      completedAt: string;
    },
  ): Promise<void> {
    const payload = buildExecutionCompletedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.ExecutionCompleted,
      aggregateType: AGGREGATE_TYPES.ServiceExecution,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.completedAt,
      idempotencyKey: `service-execution:${input.serviceOrderId}:closed:${input.executionClosureId}`,
    });
  }

  async appendMeasurementBasisReady(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      clientId: string | null;
      orderNumber: string;
      measurementBasisId: string;
      executionClosureId: string;
      lineCount: number;
      preparedAt: string;
    },
  ): Promise<void> {
    const payload = buildMeasurementBasisReadyPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.MeasurementBasisReady,
      aggregateType: AGGREGATE_TYPES.ServiceExecution,
      aggregateId: input.serviceOrderId,
      payload,
      occurredAt: input.preparedAt,
      idempotencyKey: `measurement-basis:${input.measurementBasisId}:ready`,
    });
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // MEASUREMENT → ACCEPTANCE → BILLING READINESS
  // ═════════════════════════════════════════════════════════════════════════════
  //
  // Todos recebem o `PoolClient` do comando: o evento nasce na MESMA transação do
  // estado. Se o COMMIT falha, o evento não existe — nunca há fato órfão nem
  // evento publicado para estado que não mudou.
  //
  // A `idempotencyKey` deriva do FATO (id do registro + natureza), não do
  // request: reenviar o comando com outra chave não duplica o evento.

  async appendMeasurementCreated(
    client: PoolClient,
    input: {
      measurementId: string;
      serviceOrderId: string;
      unitId: string;
      orderNumber: string;
      measurementBasisId: string;
      executionClosureId: string;
      itemCount: number;
      createdAt: string;
    },
  ): Promise<void> {
    const payload = buildMeasurementCreatedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.MeasurementCreated,
      aggregateType: AGGREGATE_TYPES.Measurement,
      aggregateId: input.measurementId,
      payload,
      occurredAt: input.createdAt,
      idempotencyKey: `measurement:${input.measurementId}:created`,
    });
  }

  async appendMeasurementAdjustmentAuthorized(
    client: PoolClient,
    input: {
      measurementId: string;
      serviceOrderId: string;
      unitId: string;
      orderNumber: string;
      adjustmentId: string;
      measurementItemId: string;
      adjustmentQuantity: string;
      unitCode: string;
      financialImpact: string | null;
      currencyCode: string | null;
      reason: string;
      decidedAt: string;
    },
  ): Promise<void> {
    const payload = buildMeasurementAdjustmentAuthorizedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.MeasurementAdjustmentAuthorized,
      aggregateType: AGGREGATE_TYPES.Measurement,
      aggregateId: input.measurementId,
      payload,
      occurredAt: input.decidedAt,
      idempotencyKey: `measurement-adjustment:${input.adjustmentId}:authorized`,
    });
  }

  /**
   * O FATO do aceite do cliente.
   *
   * Aceite e recusa são TIPOS DISTINTOS, não um tipo com campo de resultado: um
   * consumidor que reage a `CUSTOMER_ACCEPTANCE_RECORDED` não precisa inspecionar
   * payload para saber se deve liberar faturamento. A decisão fica no VOCABULÁRIO
   * do evento, que é onde ela pode ser filtrada.
   */
  async appendCustomerAcceptanceRecorded(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      measurementId: string;
      unitId: string;
      orderNumber: string;
      acceptanceId: string;
      cycleNumber: number;
      result: string;
      rejectionReason: string | null;
      occurredAt: string;
    },
  ): Promise<void> {
    const payload = buildCustomerAcceptanceRecordedPayloadV1(input);
    const accepted = input.result === 'ACCEPTED';
    await this.append(client, {
      eventType: accepted
        ? DOMAIN_EVENT_TYPES.CustomerAcceptanceRecorded
        : DOMAIN_EVENT_TYPES.CustomerRejectionRecorded,
      aggregateType: AGGREGATE_TYPES.Measurement,
      aggregateId: input.measurementId,
      payload,
      occurredAt: input.occurredAt,
      idempotencyKey: `customer-acceptance:${input.acceptanceId}:${accepted ? 'accepted' : 'rejected'}`,
    });
  }

  async appendBillingEligibilityGranted(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      measurementId: string;
      unitId: string;
      orderNumber: string;
      totalAmount: string | null;
      currencyCode: string | null;
      releasedAt: string;
    },
  ): Promise<void> {
    const payload = buildBillingEligibilityGrantedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.BillingEligibilityGranted,
      aggregateType: AGGREGATE_TYPES.Measurement,
      aggregateId: input.measurementId,
      payload,
      occurredAt: input.releasedAt,
      // A chave inclui o instante: a MESMA medição pode ser liberada, bloqueada e
      // liberada de novo. Sem o instante, a segunda liberação seria descartada
      // como duplicata e o consumidor nunca sabería que voltou a estar pronta.
      idempotencyKey: `billing-eligibility:${input.measurementId}:granted:${input.releasedAt}`,
    });
  }

  async appendBillingEligibilityBlocked(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      measurementId: string;
      unitId: string;
      orderNumber: string;
      blockingReasons: string[];
      evaluatedAt: string;
    },
  ): Promise<void> {
    const payload = buildBillingEligibilityBlockedPayloadV1(input);
    await this.append(client, {
      eventType: DOMAIN_EVENT_TYPES.BillingEligibilityBlocked,
      aggregateType: AGGREGATE_TYPES.Measurement,
      aggregateId: input.measurementId,
      payload,
      occurredAt: input.evaluatedAt,
      idempotencyKey: `billing-eligibility:${input.measurementId}:blocked:${input.evaluatedAt}`,
    });
  }
}

/** Mapa evento econômico → `evt.domain_event_type`. Exaustivo. */
export function domainEventTypeForEconomicEvent(
  eventKind: EconomicEventKind,
): (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES] {
  switch (eventKind) {
    case ECONOMIC_EVENT_KINDS.SettlementConfirmed:
      return DOMAIN_EVENT_TYPES.SettlementConfirmed;
    case ECONOMIC_EVENT_KINDS.SettlementReversed:
      return DOMAIN_EVENT_TYPES.SettlementReversed;
    case ECONOMIC_EVENT_KINDS.PaymentConfirmed:
      return DOMAIN_EVENT_TYPES.PaymentConfirmed;
    case ECONOMIC_EVENT_KINDS.PaymentReversed:
      return DOMAIN_EVENT_TYPES.PaymentReversed;
    // ── F1.2 ──────────────────────────────────────────────────────────────────
    case ECONOMIC_EVENT_KINDS.FiscalDocumentAuthorized:
      return DOMAIN_EVENT_TYPES.FiscalDocumentAuthorized;
    case ECONOMIC_EVENT_KINDS.FiscalDocumentCancelled:
      return DOMAIN_EVENT_TYPES.FiscalDocumentCancelled;
    case ECONOMIC_EVENT_KINDS.TaxCalculationConfirmed:
      return DOMAIN_EVENT_TYPES.TaxCalculationConfirmed;
    case ECONOMIC_EVENT_KINDS.InventoryMovementPosted:
      return DOMAIN_EVENT_TYPES.InventoryMovementPosted;
    case ECONOMIC_EVENT_KINDS.PayrollClosed:
      return DOMAIN_EVENT_TYPES.PayrollClosed;
    case ECONOMIC_EVENT_KINDS.PayrollReopened:
      return DOMAIN_EVENT_TYPES.PayrollReopened;
    case ECONOMIC_EVENT_KINDS.ReceivableRecognized:
    case ECONOMIC_EVENT_KINDS.PayableRecognized:
      // Reconhecimento é derivado do BILLING_READY: não há tipo de transporte
      // próprio, e criar um sem consumidor seria inventar vocabulário.
      throw new Error(`UNSUPPORTED_ECONOMIC_EVENT_KIND:${eventKind}`);
    case ECONOMIC_EVENT_KINDS.FixedAssetAcquired:
    case ECONOMIC_EVENT_KINDS.FixedAssetDisposed:
    case ECONOMIC_EVENT_KINDS.FixedAssetTransferred:
    case ECONOMIC_EVENT_KINDS.FixedAssetDepreciated:
      // O imobilizado posta DENTRO da própria transação contábil: o fato contábil e o
      // journal são o MESMO comando, e não há atravessia de fronteira a fazer.
      throw new Error(`UNSUPPORTED_ECONOMIC_EVENT_KIND:${eventKind}`);
    default: {
      const exhaustive: never = eventKind;
      throw new Error(`UNSUPPORTED_ECONOMIC_EVENT_KIND:${String(exhaustive)}`);
    }
  }
}

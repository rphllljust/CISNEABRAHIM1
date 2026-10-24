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
  buildBillingReadyPayloadV1,
  buildMeasurementApprovedPayloadV1,
  buildMeasurementSubmittedPayloadV1,
  buildServiceOrderAssignedPayloadV1,
  buildServiceOrderCompletedPayloadV1,
  buildServiceOrderReleasedPayloadV1,
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

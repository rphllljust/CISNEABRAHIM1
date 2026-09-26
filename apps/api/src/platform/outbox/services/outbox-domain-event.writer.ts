import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  AGGREGATE_TYPES,
  DOMAIN_EVENT_TYPES,
} from '../../../events/domain/domain-event-type';
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

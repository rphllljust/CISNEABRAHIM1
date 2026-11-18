import { describe, expect, it } from 'vitest';
import { SERVICE_ORDER_STATUSES } from './service-order';
import { buildControlCenter } from './operations-control-center';

const base = {
  createdAt: '2026-11-16T00:00:00.000Z',
  preparedAt: null,
  releasedAt: null,
  startedAt: '2026-11-16T01:00:00.000Z',
  pausedAt: null,
  completedAt: '2026-11-16T02:00:00.000Z',
  reopenedAt: null,
  serviceRequestId: null,
  availableTransitions: [],
  readinessBlockers: [],
  facts: {
    planned_resource_count: 0,
    active_allocation_count: 0,
    execution_entry_count: 1,
    execution_occurrence_count: 0,
    execution_evidence_count: 0,
    executed_quantity_total: '1.0000',
    measurement_count: 1,
    measurement_status: 'APPROVED',
    measurement_created_at: '2026-11-16T03:00:00.000Z',
    billing_count: 1,
    billing_status: 'PREPARED',
    billing_created_at: '2026-11-16T04:00:00.000Z',
    billing_total_amount: '123.45',
    billing_currency_code: 'BRL',
  },
};

describe('Operations Control Center — downstream progression', () => {
  it('does not publish MEASURE after measurement and billing are complete', () => {
    const result = buildControlCenter({
      ...base,
      status: SERVICE_ORDER_STATUSES.Completed,
    });

    expect(result.nextAction.step).toBe('CLOSED');
    expect(result.nextAction.transition).toBeNull();
  });

  it('keeps MEASURE when a completed order has no measurement yet', () => {
    const result = buildControlCenter({
      ...base,
      status: SERVICE_ORDER_STATUSES.Completed,
      facts: {
        ...base.facts,
        measurement_count: 0,
        measurement_status: null,
        measurement_created_at: null,
        billing_count: 0,
        billing_status: null,
        billing_created_at: null,
      },
    });

    expect(result.nextAction.step).toBe('MEASURE');
  });
});

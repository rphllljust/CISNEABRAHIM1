import { describe, expect, it } from 'vitest';
import { buildAgingSnapshot } from '../serializers/aging-response.serializer';
import { DEFAULT_AGING_BUCKET_POLICY } from '../domain/aging-bucket.policy';

describe('buildAgingSnapshot', () => {
  it('hides financial amounts when billing visibility is false', () => {
    const snapshot = buildAgingSnapshot({
      generatedAt: '2026-01-01T00:00:00.000Z',
      businessTimezone: 'America/Porto_Velho',
      approachingDueThresholdDays: 7,
      bucketPolicy: DEFAULT_AGING_BUCKET_POLICY,
      visibility: {
        serviceRequests: true,
        serviceOrders: true,
        measurements: false,
        billing: false,
      },
      counts: {
        pendingServiceRequests: { count: 2, maxAgeDays: 5 },
        overdueServiceOrders: { count: 1, maxAgeDays: 3 },
        approachingDueServiceOrders: { count: 4, maxAgeDays: null },
        serviceOrdersInDraft: { count: 0, maxAgeDays: null },
        serviceOrdersAwaitingRelease: { count: 0, maxAgeDays: null },
        serviceOrdersAwaitingStart: { count: 0, maxAgeDays: null },
        serviceOrdersInExecution: { count: 0, maxAgeDays: null },
        serviceOrdersPaused: { count: 0, maxAgeDays: null },
        agingMeasurements: { count: 0, maxAgeDays: null },
        awaitingBilling: { count: 0, maxAgeDays: null },
        awaitingPreparation: {
          count: 99,
          totalAmount: '999.99',
          maxAgeDays: 10,
          maxDaysUntilDue: null,
          maxDaysOverdue: null,
        },
        prepared: {
          count: 99,
          totalAmount: '999.99',
          maxAgeDays: 10,
          maxDaysUntilDue: null,
          maxDaysOverdue: null,
        },
        awaitingPayment: {
          count: 99,
          totalAmount: '999.99',
          maxAgeDays: 10,
          maxDaysUntilDue: 5,
          maxDaysOverdue: null,
        },
        overdueReceivables: {
          count: 99,
          totalAmount: '999.99',
          maxAgeDays: 10,
          maxDaysUntilDue: null,
          maxDaysOverdue: 3,
        },
      },
    });

    expect(snapshot.operational.overdueServiceOrders.count).toBe(1);
    expect(snapshot.financial.prepared.count).toBe(0);
    expect(snapshot.financial.prepared.totalAmount).toBeNull(); // NO_DATA
  });
});

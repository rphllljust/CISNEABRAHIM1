import type { AgingBucketPolicy } from '../domain/aging-bucket.policy';
import type { AgingSnapshot, AgingVisibility } from '../domain/aging-snapshot';
import { buildSnapshotEnvelope } from '../../platform/analytics/snapshot-semantics';
import type { AgingReadModelCounts } from '../repositories/aging-read-model.repository';

export function buildAgingSnapshot(input: {
  snapshotId?: string;
  generatedAt: string;
  dataAsOf?: string;
  partial?: boolean;
  partialReasons?: string[];
  consistency?: 'SINGLE_WINDOW' | 'MIXED';
  businessTimezone: string;
  approachingDueThresholdDays: number;
  bucketPolicy: AgingBucketPolicy;
  visibility: AgingVisibility;
  counts: AgingReadModelCounts;
}): AgingSnapshot {
  return {
    ...buildSnapshotEnvelope({
      windowKey: input.businessTimezone,
      dataAsOf: input.dataAsOf ?? input.generatedAt,
      generatedAt: input.generatedAt,
      partial: input.partial ?? false,
      partialReasons: input.partialReasons,
      consistency: input.consistency ?? 'SINGLE_WINDOW',
    }),
    businessTimezone: input.businessTimezone,
    approachingDueThresholdDays: input.approachingDueThresholdDays,
    bucketPolicy: input.bucketPolicy,
    visibility: input.visibility,
    operational: {
      pendingServiceRequests: toCountMetric(input.counts.pendingServiceRequests),
      overdueServiceOrders: toCountMetric(input.counts.overdueServiceOrders),
      approachingDueServiceOrders: toCountMetric(input.counts.approachingDueServiceOrders),
      serviceOrdersInDraft: toCountMetric(input.counts.serviceOrdersInDraft),
      serviceOrdersAwaitingRelease: toCountMetric(input.counts.serviceOrdersAwaitingRelease),
      serviceOrdersAwaitingStart: toCountMetric(input.counts.serviceOrdersAwaitingStart),
      serviceOrdersInExecution: toCountMetric(input.counts.serviceOrdersInExecution),
      serviceOrdersPaused: toCountMetric(input.counts.serviceOrdersPaused),
      agingMeasurements: toCountMetric(input.counts.agingMeasurements),
      awaitingBilling: toCountMetric(input.counts.awaitingBilling),
    },
    financial: input.visibility.billing
      ? {
          awaitingPreparation: toAmountMetric(input.counts.awaitingPreparation),
          prepared: toAmountMetric(input.counts.prepared),
          awaitingPayment: toAmountMetric(input.counts.awaitingPayment),
          overdueReceivables: toAmountMetric(input.counts.overdueReceivables),
        }
      : {
          awaitingPreparation: hiddenAmountMetric(),
          prepared: hiddenAmountMetric(),
          awaitingPayment: hiddenAmountMetric(),
          overdueReceivables: hiddenAmountMetric(),
        },
  };
}

function toCountMetric(row: { count: number; maxAgeDays: number | null }) {
  return { count: row.count, maxAgeDays: row.maxAgeDays };
}

function toAmountMetric(row: {
  count: number;
  totalAmount: string | null;
  maxAgeDays: number | null;
  maxDaysUntilDue: number | null;
  maxDaysOverdue: number | null;
}) {
  return {
    count: row.count,
    totalAmount: row.totalAmount,
    maxAgeDays: row.maxAgeDays,
    maxDaysUntilDue: row.maxDaysUntilDue,
    maxDaysOverdue: row.maxDaysOverdue,
  };
}

function hiddenAmountMetric() {
  return {
    count: 0,
    totalAmount: null,
    maxAgeDays: null,
    maxDaysUntilDue: null,
    maxDaysOverdue: null,
  };
}

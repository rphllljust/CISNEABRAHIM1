import type { AgingBucketPolicy } from './aging-bucket.policy';

export type AgingVisibility = {
  serviceRequests: boolean;
  serviceOrders: boolean;
  measurements: boolean;
  billing: boolean;
};

export type AgingCountMetric = {
  count: number;
  maxAgeDays: number | null;
};

export type AgingAmountMetric = {
  count: number;
  totalAmount: string | null;
  maxAgeDays: number | null;
  maxDaysUntilDue: number | null;
  maxDaysOverdue: number | null;
};

export type AgingSnapshot = {
  snapshotId: string;
  generatedAt: string;
  dataAsOf: string;
  partial: boolean;
  partialReasons?: string[];
  consistency: 'SINGLE_WINDOW' | 'MIXED';
  businessTimezone: string;
  approachingDueThresholdDays: number;
  bucketPolicy: AgingBucketPolicy;
  visibility: AgingVisibility;
  operational: {
    pendingServiceRequests: AgingCountMetric;
    overdueServiceOrders: AgingCountMetric;
    approachingDueServiceOrders: AgingCountMetric;
    serviceOrdersInDraft: AgingCountMetric;
    serviceOrdersAwaitingRelease: AgingCountMetric;
    serviceOrdersAwaitingStart: AgingCountMetric;
    serviceOrdersInExecution: AgingCountMetric;
    serviceOrdersPaused: AgingCountMetric;
    agingMeasurements: AgingCountMetric;
    awaitingBilling: AgingCountMetric;
  };
  financial: {
    awaitingPreparation: AgingAmountMetric;
    prepared: AgingAmountMetric;
    awaitingPayment: AgingAmountMetric;
    overdueReceivables: AgingAmountMetric;
  };
};

export function resolveApproachingDueThresholdDays(): number {
  const raw = process.env['AGING_APPROACHING_DUE_DAYS'];
  const parsed = raw ? Number.parseInt(raw, 10) : 7;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 7;
}

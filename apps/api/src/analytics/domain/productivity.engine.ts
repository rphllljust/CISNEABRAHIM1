import { computeAverageHours, computeRate, type DurationMetric, type RateMetric } from './productivity-rate';
import { type ProductivityRawAggregates, type ProductivitySummary } from './productivity-summary';

export function buildProductivitySummary(raw: ProductivityRawAggregates): ProductivitySummary {
  const onTimeRate = computeRate(raw.onTimeNumerator, raw.onTimeDenominator);
  const averageCycleTime = computeAverageFromTotals(raw.cycleTimeTotalHours, raw.cycleTimeSampleSize);

  const reworkAvailable = raw.reworkDenominator > 0;
  const reworkRate: RateMetric & { concept: string | null } = {
    ...computeRate(raw.reworkNumerator, raw.reworkDenominator),
    concept: reworkAvailable ? 'measurement_rejection_rate' : null,
  };

  const utilizationAvailable = raw.utilizationDenominatorSeconds > 0;
  const utilization: RateMetric & { concept: string | null } = {
    ...computeRate(raw.utilizationNumeratorSeconds, raw.utilizationDenominatorSeconds),
    concept: utilizationAvailable ? 'allocated_window_over_planned_window' : null,
  };

  const evidenceCompleteness = computeRate(raw.evidenceNumerator, raw.evidenceDenominator);
  const measurementAcceptance = computeRate(raw.measurementApproved, raw.measurementDecided);

  return {
    completed: raw.completed,
    onTimeRate,
    averageCycleTime,
    reworkRate,
    utilization,
    evidenceCompleteness,
    measurementAcceptance,
  };
}

function computeAverageFromTotals(
  totalHours: number | null,
  sampleSize: number,
): DurationMetric {
  if (sampleSize < 1 || totalHours === null) {
    return { valueHours: null, sampleSize, available: false };
  }
  return computeAverageHours(totalHours, sampleSize);
}


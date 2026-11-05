import type { ServiceOrderServiceSnapshot } from './service-order-snapshot';

export const RENTAL_SERVICE_ARCHETYPE = 'RENTAL';

export const RENTAL_MEASUREMENT_MODES = {
  ByPeriod: 'BY_PERIOD',
} as const;

export function isRentalServiceOrder(snapshot: Pick<ServiceOrderServiceSnapshot, 'archetype'>): boolean {
  return snapshot.archetype === RENTAL_SERVICE_ARCHETYPE;
}

export function resolveRentalCommercialUnitCode(
  snapshot: Pick<ServiceOrderServiceSnapshot, 'measurementModel'>,
): string {
  return snapshot.measurementModel.defaultUnitCode ?? 'DAY';
}

export function assertRentalContractedPeriodPresent(
  planned: { operationalStart?: string | null; operationalEnd?: string | null },
): void {
  const start = Date.parse(planned.operationalStart ?? '');
  const end = Date.parse(planned.operationalEnd ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('RENTAL_CONTRACTED_PERIOD_REQUIRED');
  }
}

export function assertRentalAllocationWithinContractedPeriod(
  allocationStart: Date,
  allocationEnd: Date,
  contractedStart: Date,
  contractedEnd: Date,
): void {
  const [start, end, windowStart, windowEnd] = [
    allocationStart.getTime(), allocationEnd.getTime(),
    contractedStart.getTime(), contractedEnd.getTime(),
  ];
  if (![start, end, windowStart, windowEnd].every(Number.isFinite) ||
      start >= end || windowStart >= windowEnd ||
      start < windowStart || end > windowEnd) {
    throw new Error('ALLOCATION_OUTSIDE_PLANNED_WINDOW');
  }
}

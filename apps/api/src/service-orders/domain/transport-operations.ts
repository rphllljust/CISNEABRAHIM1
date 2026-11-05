import type { ServiceOrderServiceSnapshot } from './service-order-snapshot';

export const TRANSPORT_SERVICE_ARCHETYPE = 'TRANSPORT';

export type TransportRouteLocation = {
  origin?: string;
  destination?: string;
};

export function isTransportServiceOrder(snapshot: Pick<ServiceOrderServiceSnapshot, 'archetype'>): boolean {
  return snapshot.archetype === TRANSPORT_SERVICE_ARCHETYPE;
}

export function resolveTransportCommercialUnitCode(
  snapshot: Pick<ServiceOrderServiceSnapshot, 'measurementModel'>,
): string {
  return snapshot.measurementModel.defaultUnitCode ?? 'TRIP';
}

export function parseTransportRoute(location: Record<string, unknown> | null | undefined): TransportRouteLocation {
  if (!location) {
    return {};
  }
  const origin = typeof location['origin'] === 'string' ? location['origin'].trim() : undefined;
  const destination = typeof location['destination'] === 'string' ? location['destination'].trim() : undefined;
  return {
    origin: origin || undefined,
    destination: destination || undefined,
  };
}

export function assertTransportRoutePresent(location: Record<string, unknown> | null | undefined): void {
  const route = parseTransportRoute(location);
  if (!route.origin || !route.destination) {
    throw new Error('TRANSPORT_ROUTE_REQUIRED');
  }
}

export function assertTransportScheduledWindowPresent(
  planned: { operationalStart?: string | null; operationalEnd?: string | null },
): void {
  const start = Date.parse(planned.operationalStart ?? '');
  const end = Date.parse(planned.operationalEnd ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('TRANSPORT_SCHEDULED_WINDOW_REQUIRED');
  }
}

export function assertTransportAllocationWithinScheduledWindow(
  allocationStart: Date,
  allocationEnd: Date,
  scheduledStart: Date,
  scheduledEnd: Date,
): void {
  const [start, end, windowStart, windowEnd] = [
    allocationStart.getTime(), allocationEnd.getTime(),
    scheduledStart.getTime(), scheduledEnd.getTime(),
  ];
  if (![start, end, windowStart, windowEnd].every(Number.isFinite) ||
      start >= end || windowStart >= windowEnd ||
      start < windowStart || end > windowEnd) {
    throw new Error('ALLOCATION_OUTSIDE_PLANNED_WINDOW');
  }
}

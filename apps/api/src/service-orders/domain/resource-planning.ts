export const PLANNED_RESOURCE_KINDS = {
  PhysicalResource: 'PHYSICAL_RESOURCE',
  Labor: 'LABOR',
} as const;

export type PlannedResourceKind =
  (typeof PLANNED_RESOURCE_KINDS)[keyof typeof PLANNED_RESOURCE_KINDS];

export const PLANNED_RESOURCE_STATUSES = {
  Planned: 'PLANNED',
  Removed: 'REMOVED',
} as const;

export type PlannedResourceStatus =
  (typeof PLANNED_RESOURCE_STATUSES)[keyof typeof PLANNED_RESOURCE_STATUSES];

export const RESOURCE_ALLOCATION_STATUSES = {
  Active: 'ACTIVE',
  Reallocated: 'REALLOCATED',
  Removed: 'REMOVED',
} as const;

export type ResourceAllocationStatus =
  (typeof RESOURCE_ALLOCATION_STATUSES)[keyof typeof RESOURCE_ALLOCATION_STATUSES];

export const PLANNING_HISTORY_EVENTS = {
  PlanResource: 'PLAN_RESOURCE',
  RemovePlannedResource: 'REMOVE_PLANNED_RESOURCE',
} as const;

export const ALLOCATION_HISTORY_EVENTS = {
  AllocateResource: 'ALLOCATE_RESOURCE',
  ReallocateResource: 'REALLOCATE_RESOURCE',
  RemoveAllocation: 'REMOVE_ALLOCATION',
} as const;

export type AllocationHistorySnapshot = {
  serviceOrderId: string;
  physicalAssetId?: string | null;
  workforceMemberId?: string | null;
  resourceTypeCode: string;
  operationalStart: string;
  operationalEnd: string;
  plannedResourceId?: string | null;
};

export function buildAllocationHistoryPayload(
  snapshot: AllocationHistorySnapshot,
  change: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    serviceOrderId: snapshot.serviceOrderId,
    ...(snapshot.physicalAssetId ? { physicalAssetId: snapshot.physicalAssetId } : {}),
    ...(snapshot.workforceMemberId ? { workforceMemberId: snapshot.workforceMemberId } : {}),
    resourceTypeCode: snapshot.resourceTypeCode,
    operationalStart: snapshot.operationalStart,
    operationalEnd: snapshot.operationalEnd,
    ...(snapshot.plannedResourceId ? { plannedResourceId: snapshot.plannedResourceId } : {}),
    ...change,
  };
}

export const SERVICE_ORDER_PLANNING_ALLOWED_STATUSES = new Set([
  'RELEASED',
  'IN_EXECUTION',
]);

export function isHalfOpenIntervalValid(start: Date, end: Date): boolean {
  return start.getTime() < end.getTime();
}

/**
 * Half-open [start, end): adjacent intervals do not overlap.
 * 08:00–10:00 and 10:00–12:00 are compatible.
 */
export function intervalsOverlapHalfOpen(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function assertIntervalWithinParent(
  childStart: Date,
  childEnd: Date,
  parentStart: Date | null,
  parentEnd: Date | null,
): void {
  if (!parentStart || !parentEnd) {
    return;
  }
  if (childStart < parentStart || childEnd > parentEnd) {
    throw new Error('ALLOCATION_OUTSIDE_PLANNED_WINDOW');
  }
}

export function resolvePlannedOperationalWindow(
  current: { operational_start: string | null; operational_end: string | null },
  update: { operationalStart?: string | null; operationalEnd?: string | null },
): { start: Date | null; end: Date | null } {
  const startRaw =
    update.operationalStart !== undefined ? update.operationalStart : current.operational_start;
  const endRaw = update.operationalEnd !== undefined ? update.operationalEnd : current.operational_end;
  return {
    start: startRaw ? new Date(startRaw) : null,
    end: endRaw ? new Date(endRaw) : null,
  };
}

export function assertPlannedOperationalWindow(start: Date | null, end: Date | null): void {
  if ((start && !end) || (!start && end)) {
    throw new Error('PLANNED_WINDOW_INCOMPLETE');
  }
  if (start && end && !isHalfOpenIntervalValid(start, end)) {
    throw new Error('PLANNED_WINDOW_INVALID');
  }
}

export function assertAllocationsWithinPlannedWindow(
  allocations: Array<{ operational_start: string | Date; operational_end: string | Date }>,
  plannedStart: Date | null,
  plannedEnd: Date | null,
): void {
  if (!plannedStart || !plannedEnd) {
    return;
  }
  for (const allocation of allocations) {
    const allocStart =
      allocation.operational_start instanceof Date
        ? allocation.operational_start
        : new Date(allocation.operational_start);
    const allocEnd =
      allocation.operational_end instanceof Date
        ? allocation.operational_end
        : new Date(allocation.operational_end);
    assertIntervalWithinParent(allocStart, allocEnd, plannedStart, plannedEnd);
  }
}

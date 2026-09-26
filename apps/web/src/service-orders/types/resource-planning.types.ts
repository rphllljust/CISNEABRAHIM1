export const PLANNED_RESOURCE_KINDS = {
  PhysicalResource: 'PHYSICAL_RESOURCE',
  Labor: 'LABOR',
} as const;

export type PlannedResourceKind =
  (typeof PLANNED_RESOURCE_KINDS)[keyof typeof PLANNED_RESOURCE_KINDS];

export type PlannedResource = {
  id: string;
  serviceOrderId: string;
  requirementKind: PlannedResourceKind;
  resourceTypeCode: string | null;
  laborTypeCode: string | null;
  plannedQuantity: string;
  operationalStart: string | null;
  operationalEnd: string | null;
  notes: string | null;
  status: string;
  rowVersion: number;
};

export type ResourceAllocation = {
  id: string;
  serviceOrderId: string;
  plannedResourceId: string | null;
  physicalAssetId: string | null;
  workforceMemberId: string | null;
  resourceTypeCode: string;
  operationalStart: string;
  operationalEnd: string;
  status: string;
  rowVersion: number;
  allocatedAt: string;
  removedAt: string | null;
};

export type ResourceAllocationHistoryEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  actorIdentityId: string | null;
  occurredAt: string;
};

export type ResourceAllocationDetail = ResourceAllocation & {
  historyEvents: ResourceAllocationHistoryEvent[];
};

export type PlanResourcePayload = {
  requirementKind: PlannedResourceKind;
  resourceTypeCode?: string;
  laborTypeCode?: string;
  plannedQuantity: string;
  operationalStart?: string;
  operationalEnd?: string;
  notes?: string;
};

export type AllocateResourcePayload = {
  plannedResourceId: string;
  physicalAssetId?: string;
  workforceMemberId?: string;
  operationalStart: string;
  operationalEnd: string;
};

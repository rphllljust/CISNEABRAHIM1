export type PlannedResourceRow = {
  id: string;
  service_order_id: string;
  requirement_kind: string;
  resource_type_code: string | null;
  labor_type_code: string | null;
  planned_quantity: string;
  operational_start: string | null;
  operational_end: string | null;
  notes: string | null;
  status: string;
  row_version: number;
  created_at: string;
  updated_at: string;
  created_by_identity_id: string;
  updated_by_identity_id: string;
};

export type ResourceAllocationRow = {
  id: string;
  service_order_id: string;
  planned_resource_id: string | null;
  physical_asset_id: string | null;
  workforce_member_id: string | null;
  resource_type_code: string;
  operational_start: string;
  operational_end: string;
  status: string;
  row_version: number;
  allocated_at: string;
  allocated_by_identity_id: string;
  removed_at: string | null;
  removed_by_identity_id: string | null;
  reallocated_to_allocation_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ResourceAllocationHistoryEventRow = {
  id: string;
  resource_allocation_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor_identity_id: string | null;
  occurred_at: string;
};

export type PhysicalAssetAllocationContext = {
  id: string;
  asset_code: string;
  resource_type_code: string;
  lifecycle_status: string;
  unit_id: string;
};

export type WorkforceMemberAllocationContext = {
  id: string;
  member_code: string;
  default_labor_type_code: string | null;
  identity_id: string | null;
  status: string;
};

export type CreatePlannedResourcePersistenceInput = {
  serviceOrderId: string;
  requirementKind: string;
  resourceTypeCode?: string | null;
  laborTypeCode?: string | null;
  plannedQuantity: string;
  operationalStart?: string | null;
  operationalEnd?: string | null;
  notes?: string | null;
  actorIdentityId: string;
};

export type UpdatePlannedResourcePersistenceInput = {
  plannedResourceId: string;
  serviceOrderId: string;
  rowVersion: number;
  plannedQuantity?: string;
  operationalStart?: string | null;
  operationalEnd?: string | null;
  notes?: string | null;
  actorIdentityId: string;
};

export type AllocateResourcePersistenceInput = {
  serviceOrderId: string;
  plannedResourceId: string;
  physicalAssetId?: string | null;
  workforceMemberId?: string | null;
  resourceTypeCode: string;
  operationalStart: string;
  operationalEnd: string;
  actorIdentityId: string;
};

export type ReallocateResourcePersistenceInput = {
  serviceOrderId: string;
  allocationId: string;
  rowVersion: number;
  newPhysicalAssetId: string;
  resourceTypeCode: string;
  operationalStart: string;
  operationalEnd: string;
  actorIdentityId: string;
};

export type RemoveAllocationPersistenceInput = {
  serviceOrderId: string;
  allocationId: string;
  rowVersion: number;
  actorIdentityId: string;
};

export type RemovePlannedResourcePersistenceInput = {
  serviceOrderId: string;
  plannedResourceId: string;
  rowVersion: number;
  actorIdentityId: string;
};

export type AllocateResourcePersistenceResult =
  | { outcome: 'allocated'; allocation: ResourceAllocationRow }
  | { outcome: 'version_conflict' }
  | { outcome: 'invalid_state' }
  | { outcome: 'asset_not_found' }
  | { outcome: 'asset_inactive' }
  | { outcome: 'allocation_conflict' }
  | { outcome: 'planned_not_found' };

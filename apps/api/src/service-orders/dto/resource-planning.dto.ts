import { assertUuid } from '../../catalog/domain/service-catalog.validation';

function parseOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export type PlanResourceInput = {
  requirementKind: 'PHYSICAL_RESOURCE' | 'LABOR';
  resourceTypeCode?: string;
  laborTypeCode?: string;
  plannedQuantity: string;
  operationalStart?: string;
  operationalEnd?: string;
  notes?: string;
};

export type UpdatePlannedResourceInput = {
  rowVersion: number;
  plannedQuantity?: string;
  operationalStart?: string | null;
  operationalEnd?: string | null;
  notes?: string | null;
};

export type AllocateResourceInput = {
  plannedResourceId: string;
  physicalAssetId?: string;
  workforceMemberId?: string;
  operationalStart: string;
  operationalEnd: string;
};

export type ReallocateResourceInput = {
  rowVersion: number;
  physicalAssetId: string;
  operationalStart: string;
  operationalEnd: string;
};

export type RemoveAllocationInput = {
  rowVersion: number;
};

export type RemovePlannedResourceInput = {
  rowVersion: number;
};

export function parsePlanResourceInput(body: unknown): PlanResourceInput {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const record = body as Record<string, unknown>;
  const requirementKind = record['requirementKind'];
  if (requirementKind !== 'PHYSICAL_RESOURCE' && requirementKind !== 'LABOR') {
    throw new Error('INVALID_REQUIREMENT_KIND');
  }
  const plannedQuantity = parseOptionalString(record, 'plannedQuantity');
  if (!plannedQuantity || Number(plannedQuantity) <= 0) {
    throw new Error('INVALID_PLANNED_QUANTITY');
  }
  return {
    requirementKind,
    resourceTypeCode: parseOptionalString(record, 'resourceTypeCode'),
    laborTypeCode: parseOptionalString(record, 'laborTypeCode'),
    plannedQuantity,
    operationalStart: parseOptionalString(record, 'operationalStart'),
    operationalEnd: parseOptionalString(record, 'operationalEnd'),
    notes: parseOptionalString(record, 'notes'),
  };
}

export function parseUpdatePlannedResourceInput(body: unknown): UpdatePlannedResourceInput {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const record = body as Record<string, unknown>;
  const rowVersion = Number(record['rowVersion']);
  if (!Number.isInteger(rowVersion) || rowVersion < 1) {
    throw new Error('INVALID_ROW_VERSION');
  }
  return {
    rowVersion,
    plannedQuantity: parseOptionalString(record, 'plannedQuantity'),
    operationalStart:
      record['operationalStart'] === null
        ? null
        : parseOptionalString(record, 'operationalStart'),
    operationalEnd:
      record['operationalEnd'] === null ? null : parseOptionalString(record, 'operationalEnd'),
    notes: record['notes'] === null ? null : parseOptionalString(record, 'notes'),
  };
}

export function parseAllocateResourceInput(body: unknown): AllocateResourceInput {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const record = body as Record<string, unknown>;
  const plannedResourceId = parseOptionalString(record, 'plannedResourceId');
  const physicalAssetId = parseOptionalString(record, 'physicalAssetId');
  const workforceMemberId = parseOptionalString(record, 'workforceMemberId');
  const operationalStart = parseOptionalString(record, 'operationalStart');
  const operationalEnd = parseOptionalString(record, 'operationalEnd');
  if (
    !plannedResourceId ||
    (!physicalAssetId && !workforceMemberId) ||
    (physicalAssetId && workforceMemberId) ||
    !operationalStart ||
    !operationalEnd
  ) {
    throw new Error('INVALID_BODY');
  }
  assertUuid(plannedResourceId, 'plannedResourceId');
  if (physicalAssetId) {
    assertUuid(physicalAssetId, 'physicalAssetId');
  }
  if (workforceMemberId) {
    assertUuid(workforceMemberId, 'workforceMemberId');
  }
  return { plannedResourceId, physicalAssetId, workforceMemberId, operationalStart, operationalEnd };
}

export function parseReallocateResourceInput(body: unknown): ReallocateResourceInput {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const record = body as Record<string, unknown>;
  const rowVersion = Number(record['rowVersion']);
  const physicalAssetId = parseOptionalString(record, 'physicalAssetId');
  const operationalStart = parseOptionalString(record, 'operationalStart');
  const operationalEnd = parseOptionalString(record, 'operationalEnd');
  if (!Number.isInteger(rowVersion) || rowVersion < 1 || !physicalAssetId || !operationalStart || !operationalEnd) {
    throw new Error('INVALID_BODY');
  }
  assertUuid(physicalAssetId, 'physicalAssetId');
  return { rowVersion, physicalAssetId, operationalStart, operationalEnd };
}

export function parseRemoveAllocationInput(body: unknown): RemoveAllocationInput {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const rowVersion = Number((body as Record<string, unknown>)['rowVersion']);
  if (!Number.isInteger(rowVersion) || rowVersion < 1) {
    throw new Error('INVALID_ROW_VERSION');
  }
  return { rowVersion };
}

export function parseRemovePlannedResourceInput(body: unknown): RemovePlannedResourceInput {
  return parseRemoveAllocationInput(body);
}

import { describe, expect, it } from 'vitest';
import { buildRequirementCoverage } from './planning-aggregates';
import type { PlannedResource, ResourceAllocation } from '../types/resource-planning.types';
import type { ServiceOrderServiceSnapshot } from '../types/service-order.types';

const snapshot: ServiceOrderServiceSnapshot = {
  serviceCode: 'SVC',
  serviceName: 'Demo',
  requirements: {
    resources: [
      {
        physicalResourceTypeCode: 'TRUCK',
        requirementLevel: 'REQUIRED',
        minQuantity: '2',
        sortOrder: 1,
      },
    ],
    labor: [
      {
        laborTypeCode: 'OPERATOR',
        requirementLevel: 'REQUIRED',
        minQuantity: '1',
        sortOrder: 1,
      },
    ],
    execution: [],
  },
};

describe('buildRequirementCoverage', () => {
  it('computes required, planned, allocated and pending for physical resources', () => {
    const planned: PlannedResource[] = [
      {
        id: 'p1',
        serviceOrderId: 'so1',
        requirementKind: 'PHYSICAL_RESOURCE',
        resourceTypeCode: 'TRUCK',
        laborTypeCode: null,
        plannedQuantity: '2',
        operationalStart: null,
        operationalEnd: null,
        notes: null,
        status: 'ACTIVE',
        rowVersion: 1,
      },
    ];
    const allocations: ResourceAllocation[] = [
      {
        id: 'a1',
        serviceOrderId: 'so1',
        plannedResourceId: 'p1',
        physicalAssetId: 'asset-1',
        workforceMemberId: null,
        resourceTypeCode: 'TRUCK',
        operationalStart: '2026-01-01T08:00:00.000Z',
        operationalEnd: '2026-01-01T10:00:00.000Z',
        status: 'ACTIVE',
        rowVersion: 1,
        allocatedAt: '2026-01-01T07:00:00.000Z',
        removedAt: null,
      },
    ];

    const rows = buildRequirementCoverage(snapshot, planned, allocations);
    const truck = rows.find((row) => row.label === 'TRUCK');

    expect(truck).toMatchObject({
      required: 2,
      planned: 2,
      allocated: 1,
      pending: 1,
      status: 'partial',
    });
  });

  it('marks labor rows without allocated count', () => {
    const rows = buildRequirementCoverage(snapshot, [], []);
    const labor = rows.find((row) => row.label === 'OPERATOR');

    expect(labor).toMatchObject({
      required: 1,
      planned: 0,
      allocated: 0,
      pending: 1,
      status: 'missing',
      kind: 'LABOR',
    });
  });

  it('ignores removed allocations', () => {
    const allocations: ResourceAllocation[] = [
      {
        id: 'a1',
        serviceOrderId: 'so1',
        plannedResourceId: null,
        physicalAssetId: 'asset-1',
        workforceMemberId: null,
        resourceTypeCode: 'TRUCK',
        operationalStart: '2026-01-01T08:00:00.000Z',
        operationalEnd: '2026-01-01T10:00:00.000Z',
        status: 'REMOVED',
        rowVersion: 2,
        allocatedAt: '2026-01-01T07:00:00.000Z',
        removedAt: '2026-01-01T11:00:00.000Z',
      },
    ];

    const rows = buildRequirementCoverage(snapshot, [], allocations);
    expect(rows.find((row) => row.label === 'TRUCK')?.allocated).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  assertAllocationsWithinPlannedWindow,
  assertIntervalWithinParent,
  assertPlannedOperationalWindow,
  buildAllocationHistoryPayload,
  buildPlannedResourceHistoryPayload,
  collectChangedPlannedResourceFields,
  intervalsOverlapHalfOpen,
  isHalfOpenIntervalValid,
  resolvePlannedOperationalWindow,
} from './resource-planning';

describe('resource-planning intervals', () => {
  it('uses half-open semantics so adjacent intervals do not overlap', () => {
    const aStart = new Date('2026-01-01T08:00:00.000Z');
    const aEnd = new Date('2026-01-01T10:00:00.000Z');
    const bStart = new Date('2026-01-01T10:00:00.000Z');
    const bEnd = new Date('2026-01-01T12:00:00.000Z');
    expect(intervalsOverlapHalfOpen(aStart, aEnd, bStart, bEnd)).toBe(false);
  });

  it('detects overlapping intervals', () => {
    const aStart = new Date('2026-01-01T08:00:00.000Z');
    const aEnd = new Date('2026-01-01T10:30:00.000Z');
    const bStart = new Date('2026-01-01T10:00:00.000Z');
    const bEnd = new Date('2026-01-01T12:00:00.000Z');
    expect(intervalsOverlapHalfOpen(aStart, aEnd, bStart, bEnd)).toBe(true);
  });

  it('rejects invalid intervals', () => {
    const start = new Date('2026-01-01T10:00:00.000Z');
    const end = new Date('2026-01-01T08:00:00.000Z');
    expect(isHalfOpenIntervalValid(start, end)).toBe(false);
  });

  it('rejects allocations outside the planned operational window', () => {
    const plannedStart = new Date('2026-06-01T08:00:00.000Z');
    const plannedEnd = new Date('2026-06-01T12:00:00.000Z');
    expect(() =>
      assertAllocationsWithinPlannedWindow(
        [
          {
            operational_start: '2026-06-01T08:00:00.000Z',
            operational_end: '2026-06-01T10:00:00.000Z',
          },
        ],
        plannedStart,
        plannedEnd,
      ),
    ).not.toThrow();
    expect(() =>
      assertAllocationsWithinPlannedWindow(
        [
          {
            operational_start: '2026-06-01T11:00:00.000Z',
            operational_end: '2026-06-01T13:00:00.000Z',
          },
        ],
        plannedStart,
        plannedEnd,
      ),
    ).toThrow('ALLOCATION_OUTSIDE_PLANNED_WINDOW');
  });

  it('resolves planned window updates from partial input', () => {
    const resolved = resolvePlannedOperationalWindow(
      {
        operational_start: '2026-06-01T08:00:00.000Z',
        operational_end: '2026-06-01T12:00:00.000Z',
      },
      { operationalEnd: '2026-06-01T14:00:00.000Z' },
    );
    expect(resolved.start?.toISOString()).toBe('2026-06-01T08:00:00.000Z');
    expect(resolved.end?.toISOString()).toBe('2026-06-01T14:00:00.000Z');
    expect(() => assertPlannedOperationalWindow(resolved.start, resolved.end)).not.toThrow();
  });

  it('rejects incomplete planned windows', () => {
    expect(() =>
      assertPlannedOperationalWindow(new Date('2026-06-01T08:00:00.000Z'), null),
    ).toThrow('PLANNED_WINDOW_INCOMPLETE');
    expect(() =>
      assertIntervalWithinParent(
        new Date('2026-06-01T08:00:00.000Z'),
        new Date('2026-06-01T10:00:00.000Z'),
        new Date('2026-06-01T09:00:00.000Z'),
        new Date('2026-06-01T12:00:00.000Z'),
      ),
    ).toThrow('ALLOCATION_OUTSIDE_PLANNED_WINDOW');
  });
});

describe('allocation history payload', () => {
  it('captures resource, service order, period and change metadata', () => {
    const payload = buildAllocationHistoryPayload(
      {
        serviceOrderId: 'so-1',
        plannedResourceId: 'planned-1',
        physicalAssetId: 'asset-1',
        resourceTypeCode: 'WATER_TRUCK',
        operationalStart: '2026-06-01T08:00:00.000Z',
        operationalEnd: '2026-06-01T10:00:00.000Z',
      },
      { fromAllocationId: 'alloc-old' },
    );

    expect(payload).toEqual({
      serviceOrderId: 'so-1',
      plannedResourceId: 'planned-1',
      physicalAssetId: 'asset-1',
      resourceTypeCode: 'WATER_TRUCK',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
      fromAllocationId: 'alloc-old',
    });
  });
});

describe('planned resource traceability payload', () => {
  it('describes the planned side without carrying realized facts', () => {
    const payload = buildPlannedResourceHistoryPayload(
      {
        serviceOrderId: 'so-1',
        requirementKind: 'PHYSICAL_RESOURCE',
        resourceTypeCode: 'WATER_TRUCK',
        laborTypeCode: null,
        plannedQuantity: '2',
        operationalStart: '2026-06-01T08:00:00.000Z',
        operationalEnd: '2026-06-01T10:00:00.000Z',
      },
      { plannedResourceId: 'planned-1' },
    );

    expect(payload).toEqual({
      serviceOrderId: 'so-1',
      requirementKind: 'PHYSICAL_RESOURCE',
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '2',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
      plannedResourceId: 'planned-1',
    });
    expect(payload).not.toHaveProperty('actualQuantity');
  });

  it('omits absent nullable fields instead of inventing them', () => {
    const payload = buildPlannedResourceHistoryPayload({
      serviceOrderId: 'so-1',
      requirementKind: 'LABOR',
      laborTypeCode: 'DRIVER',
      plannedQuantity: '1',
    });

    expect(payload).toEqual({
      serviceOrderId: 'so-1',
      requirementKind: 'LABOR',
      laborTypeCode: 'DRIVER',
      plannedQuantity: '1',
    });
  });

  it('detects only the fields actually changed on update', () => {
    const current = {
      planned_quantity: '2',
      operational_start: '2026-06-01T08:00:00.000Z',
      operational_end: '2026-06-01T10:00:00.000Z',
      notes: null,
    };

    expect(collectChangedPlannedResourceFields(current, { plannedQuantity: '3' })).toEqual([
      'plannedQuantity',
    ]);
    expect(
      collectChangedPlannedResourceFields(current, {
        operationalEnd: '2026-06-01T12:00:00.000Z',
        notes: 'replanejado',
      }),
    ).toEqual(['operationalEnd', 'notes']);
    expect(collectChangedPlannedResourceFields(current, { plannedQuantity: '2' })).toEqual([]);
    expect(collectChangedPlannedResourceFields(current, {})).toEqual([]);
  });

  it('treats numeric formatting from the database as the same quantity', () => {
    const current = {
      planned_quantity: '1.0000',
      operational_start: null,
      operational_end: null,
      notes: null,
    };

    expect(collectChangedPlannedResourceFields(current, { plannedQuantity: '1' })).toEqual([]);
    expect(collectChangedPlannedResourceFields(current, { plannedQuantity: '1.0001' })).toEqual([
      'plannedQuantity',
    ]);
  });
});

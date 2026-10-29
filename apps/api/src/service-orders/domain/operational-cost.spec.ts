import { describe, expect, it } from 'vitest';
import {
  OPERATIONAL_COST_CATEGORIES,
  OPERATIONAL_COST_KINDS,
  OPERATIONAL_COST_ORIGINS,
  OperationalCostError,
  assertOperationalCostOriginConsistency,
  assertOperationalCostRecordableState,
} from './operational-cost';
import { SERVICE_ORDER_STATUSES } from './service-order';
import { buildOperationalMarginSummary } from './operational-margin';

describe('operational-cost domain', () => {
  it('requires execution entry for EXECUTION origin', () => {
    expect(() =>
      assertOperationalCostOriginConsistency(OPERATIONAL_COST_ORIGINS.Execution, null),
    ).toThrowError(OperationalCostError);
  });

  it('rejects execution entry for SERVICE_ORDER origin', () => {
    expect(() =>
      assertOperationalCostOriginConsistency(OPERATIONAL_COST_ORIGINS.ServiceOrder, 'entry-id'),
    ).toThrowError(OperationalCostError);
  });

  it('allows estimated costs when service order is released', () => {
    expect(() =>
      assertOperationalCostRecordableState(
        SERVICE_ORDER_STATUSES.Released,
        OPERATIONAL_COST_KINDS.Estimated,
      ),
    ).not.toThrow();
  });

  it('rejects actual costs before execution starts', () => {
    expect(() =>
      assertOperationalCostRecordableState(
        SERVICE_ORDER_STATUSES.Released,
        OPERATIONAL_COST_KINDS.Actual,
      ),
    ).toThrowError(OperationalCostError);
  });

  it('does not total or calculate a margin from incompatible cost currencies', () => {
    const summary = buildOperationalMarginSummary({
      revenue: '7000.0000',
      currencyCode: 'BRL',
      lines: [
        {
          id: 'brl', category: OPERATIONAL_COST_CATEGORIES.Fuel,
          costKind: OPERATIONAL_COST_KINDS.Actual,
          origin: OPERATIONAL_COST_ORIGINS.Execution,
          amount: '3000.0000', currencyCode: 'BRL', sourceExecutionEntryId: 'entry-1',
        },
        {
          id: 'usd', category: OPERATIONAL_COST_CATEGORIES.Material,
          costKind: OPERATIONAL_COST_KINDS.Actual,
          origin: OPERATIONAL_COST_ORIGINS.Execution,
          amount: '100.0000', currencyCode: 'USD', sourceExecutionEntryId: 'entry-2',
        },
      ],
    });
    expect(summary.totalActualCost).toBeNull();
    expect(summary.actualMargin).toBeNull();
    expect(summary.blockingReasons).toContain('COST_CURRENCY_MISMATCH');
    expect(summary.lines).toHaveLength(2); // Preserve each auditable source.
  });

  it('distinguishes no cost evidence from a real zero cost', () => {
    const summary = buildOperationalMarginSummary({
      revenue: '7000.0000', currencyCode: 'BRL', lines: [],
    });
    expect(summary.totalActualCost).toBeNull();
    expect(summary.actualMargin).toBeNull();
    expect(summary.blockingReasons).toContain('ACTUAL_COST_EVIDENCE_MISSING');
  });
});

describe('operational-margin domain', () => {
  it('separates estimated and actual totals and computes indicative margin', () => {
    const summary = buildOperationalMarginSummary({
      revenue: '1000.0000',
      currencyCode: 'BRL',
      lines: [
        {
          id: '1',
          category: OPERATIONAL_COST_CATEGORIES.Fuel,
          costKind: OPERATIONAL_COST_KINDS.Estimated,
          origin: OPERATIONAL_COST_ORIGINS.ServiceOrder,
          amount: '200.0000',
          currencyCode: 'BRL',
          sourceExecutionEntryId: null,
        },
        {
          id: '2',
          category: OPERATIONAL_COST_CATEGORIES.Fuel,
          costKind: OPERATIONAL_COST_KINDS.Actual,
          origin: OPERATIONAL_COST_ORIGINS.Execution,
          amount: '250.0000',
          currencyCode: 'BRL',
          sourceExecutionEntryId: 'entry-1',
        },
      ],
    });

    expect(summary.totalEstimatedCost).toBe('200');
    expect(summary.totalActualCost).toBe('250');
    expect(summary.estimatedMargin).toBe('800');
    expect(summary.actualMargin).toBe('750');
    expect(summary.estimatedToActualVariance).toBe('50');
    expect(summary.estimatedToActualVariancePercent).toBe('25');
    expect(summary.blockingReasons).toEqual([]);
    expect(summary.disclaimer).toContain('not official accounting');
  });
});

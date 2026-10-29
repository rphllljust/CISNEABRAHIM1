import { describe, expect, it } from 'vitest';
import {
  OPERATIONAL_PROFITABILITY_FORMULA,
  aggregateOperationalProfitability,
  computeOperationalMargin,
  computeCostVariancePercent,
  subtractMoney,
} from './operational-financials';

describe('operational-financials', () => {
  it('computes margin as revenue minus realized cost', () => {
    expect(computeOperationalMargin('1000.0000', '250.5000')).toBe('749.5');
    expect(subtractMoney('1000.0000', '250.5000')).toBe('749.5');
  });

  it('computes exact cost variance percentages and rejects unknown denominators', () => {
    expect(computeCostVariancePercent('3000.0000', '2800.0000')).toBe('7.1429');
    expect(computeCostVariancePercent('250.0000', '200.0000')).toBe('25');
    expect(computeCostVariancePercent('180.0000', '200.0000')).toBe('-10');
    expect(computeCostVariancePercent('0', '0')).toBeNull();
    expect(computeCostVariancePercent('10', null)).toBeNull();
  });

  it('returns null margin when revenue or cost is missing', () => {
    expect(computeOperationalMargin(null, '100.0000')).toBeNull();
    expect(computeOperationalMargin('100.0000', null)).toBeNull();
  });

  it('aggregates profitability rows without copying ledger data', () => {
    const totals = aggregateOperationalProfitability([
      { operationalRevenue: '1000.0000', realizedCost: '200.0000' },
      { operationalRevenue: '500.0000', realizedCost: null },
      { operationalRevenue: null, realizedCost: '50.0000' },
    ]);

    expect(totals.operationalRevenue).toBe('1500');
    expect(totals.realizedCost).toBe('250');
    expect(totals.operationalMargin).toBeNull(); // Incomplete coverage is NOT a valid consolidated margin.
    expect(totals.revenueSupportedCount).toBe(2);
    expect(totals.costSupportedCount).toBe(2);
    expect(totals.marginComputableCount).toBe(1);
    expect(OPERATIONAL_PROFITABILITY_FORMULA).toContain('operational_margin');
  });

  it('computes a consolidated margin only for fully supported nonempty populations', () => {
    const complete = aggregateOperationalProfitability([
      { operationalRevenue: '7000.0000', realizedCost: '3000.0000' },
      { operationalRevenue: '2000.0000', realizedCost: '500.0000' },
    ]);
    expect(complete.operationalMargin).toBe('5500');
    expect(complete.marginComputableCount).toBe(2);
    expect(aggregateOperationalProfitability([]).operationalMargin).toBeNull();
  });
});

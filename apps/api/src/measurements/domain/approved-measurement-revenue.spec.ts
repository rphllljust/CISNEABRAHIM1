import { describe, expect, it } from 'vitest';
import { resolveApprovedMeasurementRevenueEvidence } from './approved-measurement-revenue';

describe('approved measurement revenue evidence for Cost-to-Serve', () => {
  it('uses one verified currency and the authoritative monetary aggregate', () => {
    expect(resolveApprovedMeasurementRevenueEvidence([
      { currency_code: 'BRL', total_revenue: '7000.0000', missing_amount_count: 0 },
    ])).toEqual({ amount: '7000.0000', currencyCode: 'BRL', issue: 'NONE' });
  });

  it('never adds amounts in different currencies', () => {
    expect(resolveApprovedMeasurementRevenueEvidence([
      { currency_code: 'BRL', total_revenue: '7000', missing_amount_count: 0 },
      { currency_code: 'USD', total_revenue: '100', missing_amount_count: 0 },
    ])).toEqual({ amount: null, currencyCode: null, issue: 'UNVERIFIED_CURRENCY' });
  });

  it('treats absent currency and incomplete amounts as non-billable economic evidence', () => {
    expect(resolveApprovedMeasurementRevenueEvidence([
      { currency_code: null, total_revenue: '7000', missing_amount_count: 0 },
    ]).issue).toBe('UNVERIFIED_CURRENCY');
    expect(resolveApprovedMeasurementRevenueEvidence([
      { currency_code: 'BRL', total_revenue: '7000', missing_amount_count: 1 },
    ])).toEqual({ amount: null, currencyCode: 'BRL', issue: 'MISSING_AMOUNT' });
  });

  it('distinguishes absence from a real zero-valued approved measurement', () => {
    expect(resolveApprovedMeasurementRevenueEvidence([]).issue).toBe('NOT_AVAILABLE');
    expect(resolveApprovedMeasurementRevenueEvidence([
      { currency_code: 'BRL', total_revenue: '0', missing_amount_count: 0 },
    ])).toEqual({ amount: '0', currencyCode: 'BRL', issue: 'NONE' });
  });
});

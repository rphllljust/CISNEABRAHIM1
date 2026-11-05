import { describe, expect, it } from 'vitest';
import { isFinancialPositionEmpty } from './financial-position-completeness';

describe('Finance portfolio completeness', () => {
  it('requires authoritative zero counts from every participating domain', () => {
    expect(isFinancialPositionEmpty({
      receivableTotal: 0,
      payableTotal: 0,
      accountCount: 0,
      agingBucketCounts: [0, 0, 0],
    })).toBe(true);
  });

  it('never treats an unavailable payable/receivable count as zero', () => {
    expect(isFinancialPositionEmpty({
      receivableTotal: undefined,
      payableTotal: 0,
      accountCount: 0,
      agingBucketCounts: [0],
    })).toBe(false);
    expect(isFinancialPositionEmpty({
      receivableTotal: 0,
      payableTotal: null,
      accountCount: 0,
      agingBucketCounts: [0],
    })).toBe(false);
  });

  it('retains an active account or an aging exception even with empty titles', () => {
    expect(isFinancialPositionEmpty({
      receivableTotal: 0,
      payableTotal: 0,
      accountCount: 1,
      agingBucketCounts: [0],
    })).toBe(false);
    expect(isFinancialPositionEmpty({
      receivableTotal: 0,
      payableTotal: 0,
      accountCount: 0,
      agingBucketCounts: [0, 1],
    })).toBe(false);
  });
});

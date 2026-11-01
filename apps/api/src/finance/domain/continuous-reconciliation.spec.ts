import { describe, expect, it } from 'vitest';
import {
  runContinuousReconciliation,
  type EconomicFact,
  type ReconciliationFindingKind,
} from './continuous-reconciliation';

const BRL = 'BRL';

function rootBilling(id: string, amount: string): EconomicFact {
  return { id, ledger: 'billing', amount, currencyCode: BRL, sourceReference: 'BILL-REF' };
}

function linked(
  id: string,
  ledger: EconomicFact['ledger'],
  amount: string,
  source: EconomicFact['source'],
): EconomicFact {
  return { id, ledger, amount, currencyCode: BRL, sourceReference: `REF-${id}`, source };
}

function posted(
  id: string,
  sourceContext: string,
  sourceId: string,
  amount: string,
  balanced = true,
): EconomicFact {
  return {
    id,
    ledger: 'journal_entry',
    amount,
    currencyCode: BRL,
    postingSource: { sourceContext, sourceId },
    debits: [{ amount }],
    credits: balanced ? [{ amount }] : [{ amount: '0.0100' }],
  };
}

function kinds(report: ReturnType<typeof runContinuousReconciliation>): ReconciliationFindingKind[] {
  return report.findings.map((finding) => finding.kind).sort();
}

describe('continuous financial reconciliation engine', () => {
  it('passes a fully reconciled economic chain (receivable -> settlement -> treasury -> posting)', () => {
    const billing = rootBilling('b-1', '1000.0000');
    const receivable = linked('r-1', 'receivable', '1000.0000', { ledger: 'billing', id: 'b-1' });
    const settlement: EconomicFact = {
      ...linked('s-1', 'settlement', '1000.0000', { ledger: 'receivable', id: 'r-1' }),
      expectedPostingSourceContext: 'SETTLEMENT',
    };
    const treasury = linked('t-1', 'treasury', '1000.0000', { ledger: 'settlement', id: 's-1' });
    const journalSettlement = posted('j-s', 'SETTLEMENT', 's-1', '1000.0000');
    const report = runContinuousReconciliation([billing, receivable, settlement, treasury, journalSettlement]);
    expect(report.status).toBe('PASS');
    expect(report.findings).toEqual([]);
  });

  it('detects a missing posting for a settlement', () => {
    const settlement: EconomicFact = {
      ...linked('s-1', 'settlement', '500.0000', { ledger: 'receivable', id: 'r-1' }),
      expectedPostingSourceContext: 'SETTLEMENT',
    };
    const report = runContinuousReconciliation([settlement]);
    expect(report.status).toBe('FAIL');
    expect(kinds(report)).toContain('MISSING_POSTING');
  });

  it('detects duplicate postings of the same economic source', () => {
    const receivable = linked('r-1', 'receivable', '500.0000', null);
    const journalA = posted('j-1', 'receivable', 'r-1', '500.0000');
    const journalB = posted('j-2', 'receivable', 'r-1', '500.0000');
    const report = runContinuousReconciliation([receivable, journalA, journalB]);
    expect(report.duplicateEconomicEffects).toBe(2);
    expect(kinds(report)).toContain('DUPLICATE_POSTING');
  });

  it('accepts a legitimate partial settlement and payment without false amount divergence', () => {
    const billing = rootBilling('b-1', '1000.0000');
    const receivable = linked('r-1', 'receivable', '1000.0000', { ledger: 'billing', id: 'b-1' });
    const settlement = linked('s-1', 'settlement', '400.0000', { ledger: 'receivable', id: 'r-1' });
    const treasury = linked('t-1', 'treasury', '400.0000', { ledger: 'settlement', id: 's-1' });
    const payable = linked('p-1', 'payable', '200.0000', null);
    const payment = linked('pay-1', 'payment', '50.0000', { ledger: 'payable', id: 'p-1' });
    const report = runContinuousReconciliation([billing, receivable, settlement, treasury, payable, payment]);
    expect(report.status).toBe('PASS');
    expect(report.findings).toEqual([]);
  });

  it('accepts multiple partial settlements and payments within principal, including exact total', () => {
    const billing = rootBilling('b-1', '100.0000');
    const receivable = linked('r-1', 'receivable', '100.0000', { ledger: 'billing', id: 'b-1' });
    const settlements = [
      linked('s-1', 'settlement', '40.0000', { ledger: 'receivable', id: 'r-1' }),
      linked('s-2', 'settlement', '60.0000', { ledger: 'receivable', id: 'r-1' }),
    ];
    const payable = linked('p-1', 'payable', '100.0000', null);
    const payments = [
      linked('pay-1', 'payment', '40.0000', { ledger: 'payable', id: 'p-1' }),
      linked('pay-2', 'payment', '59.9900', { ledger: 'payable', id: 'p-1' }),
    ];
    const report = runContinuousReconciliation([billing, receivable, ...settlements, payable, ...payments]);
    expect(report.status).toBe('PASS');
    expect(report.findings).toEqual([]);
  });

  it('flags aggregate overpayment of a receivable and payable, without rounding', () => {
    const billing = rootBilling('b-1', '100.0000');
    const receivable = linked('r-1', 'receivable', '100.0000', { ledger: 'billing', id: 'b-1' });
    const payable = linked('p-1', 'payable', '100.0000', null);
    const report = runContinuousReconciliation([
      billing, receivable, payable,
      linked('s-1', 'settlement', '60.0000', { ledger: 'receivable', id: 'r-1' }),
      linked('s-2', 'settlement', '40.0001', { ledger: 'receivable', id: 'r-1' }),
      linked('pay-1', 'payment', '60.0000', { ledger: 'payable', id: 'p-1' }),
      linked('pay-2', 'payment', '40.0001', { ledger: 'payable', id: 'p-1' }),
    ]);
    expect(report.status).toBe('FAIL');
    expect(report.findings.filter((finding) => finding.kind === 'AMOUNT_DIVERGENT')).toHaveLength(2);
    expect(report.findings.some((finding) => finding.detail.includes('100.0001'))).toBe(true);
  });

  it('retains strict equality for treasury movements linked to a partial settlement', () => {
    const billing = rootBilling('b-1', '100.0000');
    const receivable = linked('r-1', 'receivable', '100.0000', { ledger: 'billing', id: 'b-1' });
    const settlement = linked('s-1', 'settlement', '40.0000', { ledger: 'receivable', id: 'r-1' });
    const treasury = linked('t-1', 'treasury', '39.9900', { ledger: 'settlement', id: 's-1' });
    const report = runContinuousReconciliation([billing, receivable, settlement, treasury]);
    expect(report.status).toBe('FAIL');
    expect(report.findings).toEqual([
      expect.objectContaining({ kind: 'AMOUNT_DIVERGENT', ledger: 'treasury', factId: 't-1' }),
    ]);
  });

  it('fails closed on currency changes in otherwise valid partial settlements', () => {
    const billing = rootBilling('b-1', '100.0000');
    const receivable = linked('r-1', 'receivable', '100.0000', { ledger: 'billing', id: 'b-1' });
    const settlement = {
      ...linked('s-1', 'settlement', '40.0000', { ledger: 'receivable', id: 'r-1' }),
      currencyCode: 'USD',
    };
    const report = runContinuousReconciliation([billing, receivable, settlement]);
    expect(report.status).toBe('FAIL');
    expect(kinds(report)).toContain('CURRENCY_DIVERGENT');
    expect(kinds(report)).not.toContain('AMOUNT_DIVERGENT');
  });

  it('detects a nonexistent economic origin and a missing sourceReference', () => {
    const dangling = linked('s-1', 'settlement', '10.0000', { ledger: 'receivable', id: 'r-ghost' });
    const missingRef: EconomicFact = {
      id: 's-2',
      ledger: 'settlement',
      amount: '10.0000',
      currencyCode: BRL,
      source: null,
      sourceReference: undefined,
    };
    const report = runContinuousReconciliation([dangling, missingRef]);
    expect(report.findings.filter((finding) => finding.kind === 'SOURCE_NOT_FOUND')).toHaveLength(2);
  });

  it('detects an unbalanced posting (debits != credits)', () => {
    const receivable = linked('r-1', 'receivable', '50.0000', null);
    const unbalanced = posted('j-1', 'receivable', 'r-1', '50.0000', false);
    const report = runContinuousReconciliation([receivable, unbalanced]);
    expect(report.unbalancedPostings).toBe(1);
    expect(kinds(report)).toContain('UNBALANCED_POSTING');
  });
  it('accepts a fully consistent USD chain without converting nominal amounts', () => {
    const billing = { ...rootBilling('b-usd', '100.0000'), currencyCode: 'USD' };
    const receivable = {
      ...linked('r-usd', 'receivable', '100.0000', { ledger: 'billing', id: 'b-usd' }),
      currencyCode: 'USD',
    };
    const settlement: EconomicFact = {
      ...linked('s-usd', 'settlement', '100.0000', { ledger: 'receivable', id: 'r-usd' }),
      currencyCode: 'USD',
      expectedPostingSourceContext: 'SETTLEMENT',
    };
    const treasury = {
      ...linked('t-usd', 'treasury', '100.0000', { ledger: 'settlement', id: 's-usd' }),
      currencyCode: 'USD',
    };
    const journal = { ...posted('j-usd', 'SETTLEMENT', 's-usd', '100.0000'), currencyCode: 'USD' };

    const report = runContinuousReconciliation([billing, receivable, settlement, treasury, journal]);
    expect(report.status).toBe('PASS');
    expect(report.findings).toEqual([]);
  });

  it('fails closed when a downstream economic fact changes currency despite equal nominal amount', () => {
    const billing = rootBilling('b-brl', '100.0000');
    const receivable = {
      ...linked('r-usd', 'receivable', '100.0000', { ledger: 'billing', id: 'b-brl' }),
      currencyCode: 'USD',
    };

    const report = runContinuousReconciliation([billing, receivable]);
    expect(report.status).toBe('FAIL');
    expect(report.findings).toEqual([
      expect.objectContaining({
        kind: 'CURRENCY_DIVERGENT',
        factId: 'r-usd',
        ledger: 'receivable',
      }),
    ]);
    expect(kinds(report)).not.toContain('AMOUNT_DIVERGENT');
  });

  it('rejects a balanced journal in a different currency from its settled source', () => {
    const settlement: EconomicFact = {
      ...linked('s-brl', 'settlement', '50.0000', null),
      expectedPostingSourceContext: 'SETTLEMENT',
    };
    const journal = {
      ...posted('j-usd', 'SETTLEMENT', 's-brl', '50.0000'),
      currencyCode: 'USD',
    };

    const report = runContinuousReconciliation([settlement, journal]);
    expect(report.status).toBe('FAIL');
    expect(report.findings).toEqual([
      expect.objectContaining({
        kind: 'CURRENCY_DIVERGENT',
        factId: 'j-usd',
        ledger: 'journal_entry',
      }),
    ]);
    expect(report.unbalancedPostings).toBe(0);
    expect(kinds(report)).not.toContain('MISSING_POSTING');
  });

});

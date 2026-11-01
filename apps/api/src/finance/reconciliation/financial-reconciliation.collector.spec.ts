import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { collectEconomicFacts, runFinancialReconciliation } from './financial-reconciliation.collector';

/**
 * MASTER 001-04: the collector uses the published rpt accounting read contract,
 * never assumes BRL, and performs no writes. No production database is contacted.
 */
function economicPool(journalCurrencyCode: string, settlementAmount = '100.0000'): Pool {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM rpt.read_billing_documents')) {
      return {
        rows: [{
          id: 'b-usd',
          amount: '100.0000',
          currency_code: 'USD',
          document_number: 'BILL-USD-1',
        }],
      };
    }
    if (sql.includes('FROM fin.receivables')) {
      return {
        rows: [{
          id: 'r-usd',
          amount: '100.0000',
          currency_code: 'USD',
          external_reference: 'BILL-USD-1',
          origin_billing_document_id: 'b-usd',
        }],
      };
    }
    if (sql.includes('FROM fin.settlements')) {
      return {
        rows: [{
          id: 's-usd',
          amount: settlementAmount,
          currency_code: 'USD',
          receivable_id: 'r-usd',
        }],
      };
    }
    if (sql.includes('FROM fin.financial_transactions')) {
      return {
        rows: [{
          id: 't-usd',
          amount: settlementAmount,
          currency_code: 'USD',
          origin_kind: 'RECEIVABLE_SETTLEMENT',
          origin_id: 's-usd',
          origin_reference: 'SETTLE-s-usd',
        }],
      };
    }
    if (sql.includes('FROM fin.payables') || sql.includes('FROM fin.payments')) {
      return { rows: [] };
    }
    if (sql.includes('FROM rpt.read_journal_entries')) {
      // The published view retains the actual journal currency_code (migration 0110).
      expect(sql).toContain('je.currency_code');
      return {
        rows: [
          {
            id: 'j-usd',
            source_kind: 'SETTLEMENT',
            source_id: 's-usd',
            source_reference: 'SETTLE-s-usd',
            currency_code: journalCurrencyCode,
            direction: 'DEBIT',
            amount: settlementAmount,
          },
          {
            id: 'j-usd',
            source_kind: 'SETTLEMENT',
            source_id: 's-usd',
            source_reference: 'SETTLE-s-usd',
            currency_code: journalCurrencyCode,
            direction: 'CREDIT',
            amount: settlementAmount,
          },
        ],
      };
    }
    throw new Error(`Unexpected reconciliation query: ${sql}`);
  });
  return { query } as unknown as Pool;
}

describe('MASTER 001-04 — published accounting currency provenance', () => {
  it('preserves the persisted USD currency through journal grouping and reconciles the complete chain', async () => {
    const pool = economicPool('USD');
    const facts = await collectEconomicFacts(pool);
    expect(facts.find((fact) => fact.ledger === 'journal_entry')).toMatchObject({
      id: 'j-usd',
      currencyCode: 'USD',
      debits: [{ amount: '100.0000' }],
      credits: [{ amount: '100.0000' }],
    });

    const result = await runFinancialReconciliation(pool);
    expect(result.status).toBe('PASS');
    expect(result.findings).toEqual([]);
  });

  it('accepts a partially settled USD receivable through real collector and balanced journal', async () => {
    const result = await runFinancialReconciliation(economicPool('USD', '40.0000'));
    expect(result.status).toBe('PASS');
    expect(result.findings).toEqual([]);
  });

  it('exposes a balanced journal posted in BRL against a USD settlement as a critical discrepancy', async () => {
    const result = await runFinancialReconciliation(economicPool('BRL'));
    expect(result.status).toBe('FAIL');
    expect(result.unbalancedPostings).toBe(0);
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'CURRENCY_DIVERGENT',
        ledger: 'journal_entry',
        factId: 'j-usd',
      }),
    ]);
  });
});

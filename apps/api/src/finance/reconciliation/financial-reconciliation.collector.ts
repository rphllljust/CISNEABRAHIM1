import type { Pool } from 'pg';
import {
  runContinuousReconciliation,
  type ContinuousReconciliationReport,
  type EconomicFact,
  type EconomicLedger,
} from '../domain/continuous-reconciliation';

/**
 * Read-side collector: materializes normalized economic facts for the
 * reconciliation engine. Cross-context billing and accounting data is read
 * only through published rpt.* contracts (DR-008); fin.* is owned by FINANCE.
 */

type Row = Record<string, unknown>;

function toText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return null;
}

function text(row: Row, key: string): string {
  return toText(row[key]) ?? '';
}

function optionalText(row: Row, key: string): string | undefined {
  return toText(row[key]) ?? undefined;
}

function id(row: Row): string {
  return text(row, 'id');
}

/** Maps a treasury origin kind / payable origin kind to an economic ledger. */
function ledgerFromOriginKind(originKind: string): EconomicLedger | null {
  const normalized = originKind.toLowerCase();
  if (normalized.includes('settlement') || normalized.includes('receivable')) return 'settlement';
  if (normalized.includes('payable') || normalized.includes('expense')) return 'payable';
  if (normalized.includes('fiscal') || normalized.includes('tax')) return 'payable';
  return null;
}

async function rows(pool: Pool, sql: string): Promise<Row[]> {
  const result = await pool.query<Row>(sql);
  return result.rows;
}

export async function collectEconomicFacts(pool: Pool): Promise<EconomicFact[]> {
  const facts: EconomicFact[] = [];

  const billing = await rows(
    pool,
    `SELECT id, total_amount AS amount, currency_code, document_number
       FROM rpt.read_billing_documents
      WHERE total_amount > 0`,
  );
  for (const row of billing) {
    facts.push({
      id: id(row),
      ledger: 'billing',
      amount: text(row, 'amount'),
      currencyCode: text(row, 'currency_code'),
      sourceReference: optionalText(row, 'document_number'),
    });
  }

  const receivables = await rows(
    pool,
    `SELECT id, principal AS amount, currency_code, external_reference, origin_billing_document_id
       FROM fin.receivables
      WHERE lifecycle = 'ACTIVE'`,
  );
  for (const row of receivables) {
    facts.push({
      id: id(row),
      ledger: 'receivable',
      amount: text(row, 'amount'),
      currencyCode: text(row, 'currency_code'),
      sourceReference: optionalText(row, 'external_reference') ?? `BILL:${text(row, 'origin_billing_document_id')}`,
      source: { ledger: 'billing', id: text(row, 'origin_billing_document_id') },
    });
  }

  const settlements = await rows(
    pool,
    `SELECT id, amount, currency_code, receivable_id
       FROM fin.settlements
      WHERE status = 'POSTED'`,
  );
  for (const row of settlements) {
    facts.push({
      id: id(row),
      ledger: 'settlement',
      amount: text(row, 'amount'),
      currencyCode: text(row, 'currency_code'),
      sourceReference: `RECEIVABLE:${text(row, 'receivable_id')}`,
      source: { ledger: 'receivable', id: text(row, 'receivable_id') },
      expectedPostingSourceContext: 'SETTLEMENT',
    });
  }

  const treasury = await rows(
    pool,
    `SELECT id, amount, currency_code, origin_kind, origin_id, origin_reference
       FROM fin.financial_transactions
      WHERE status = 'POSTED' AND origin_kind <> 'REVERSAL'`,
  );
  for (const row of treasury) {
    const sourceLedger = ledgerFromOriginKind(text(row, 'origin_kind'));
    facts.push({
      id: id(row),
      ledger: 'treasury',
      amount: text(row, 'amount'),
      currencyCode: text(row, 'currency_code'),
      sourceReference: optionalText(row, 'origin_reference'),
      source: sourceLedger ? { ledger: sourceLedger, id: text(row, 'origin_id') } : null,
    });
  }

  const payables = await rows(
    pool,
    `SELECT id, principal AS amount, currency_code, origin_kind, origin_id, origin_reference
       FROM fin.payables
      WHERE lifecycle = 'ACTIVE'`,
  );
  for (const row of payables) {
    facts.push({
      id: id(row),
      ledger: 'payable',
      amount: text(row, 'amount'),
      currencyCode: text(row, 'currency_code'),
      sourceReference: optionalText(row, 'origin_reference'),
      source: null, // payable origins (fiscal/expense) live outside the economic ledgers
    });
  }

  const payments = await rows(
    pool,
    `SELECT id, amount, currency_code, payable_id, payment_reference
       FROM fin.payments
      WHERE kind = 'PAYMENT'`,
  );
  for (const row of payments) {
    facts.push({
      id: id(row),
      ledger: 'payment',
      amount: text(row, 'amount'),
      currencyCode: text(row, 'currency_code'),
      sourceReference: optionalText(row, 'payment_reference'),
      source: { ledger: 'payable', id: text(row, 'payable_id') },
      expectedPostingSourceContext: 'PAYMENT',
    });
  }

  const journalLines = await rows(
    pool,
    `SELECT je.id, je.source_kind, je.source_id, je.source_reference,
            je.currency_code, l.direction, l.amount
       FROM rpt.read_journal_entries je
       JOIN rpt.read_journal_entry_lines l ON l.journal_entry_id = je.id
      WHERE je.status = 'POSTED'`,
  );
  const journals = new Map<string, EconomicFact>();
  for (const line of journalLines) {
    const entryId = id(line);
    let journal = journals.get(entryId);
    if (!journal) {
      journal = {
        id: entryId,
        ledger: 'journal_entry',
        amount: '0.0000',
        currencyCode: text(line, 'currency_code'),
        sourceReference: optionalText(line, 'source_reference'),
        postingSource: {
          sourceContext: text(line, 'source_kind').toUpperCase(),
          sourceId: text(line, 'source_id'),
        },
        debits: [],
        credits: [],
      };
      journals.set(entryId, journal);
    }
    const amount = text(line, 'amount');
    if (text(line, 'direction').toUpperCase() === 'DEBIT') {
      journal.debits!.push({ amount });
    } else {
      journal.credits!.push({ amount });
    }
  }
  facts.push(...journals.values());

  return facts;
}

export async function runFinancialReconciliation(pool: Pool): Promise<ContinuousReconciliationReport> {
  const facts = await collectEconomicFacts(pool);
  return runContinuousReconciliation(facts);
}

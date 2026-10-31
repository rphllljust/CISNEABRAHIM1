import { moneyAmountsEqual, sumMoneyAmounts } from '../../platform/kernel/money-math';

/**
 * Continuous financial reconciliation engine (pure, ledger-agnostic, read-only).
 *
 * Detects — never fixes — reconciliation anomalies across the economic ledgers:
 * Billing, Receivable, Settlement, Treasury, Payable, Payment, JournalEntry.
 * A POSTED journal entry is immutable: this engine only reports findings.
 *
 * Input is a normalized set of facts produced by a read-side collector, so the
 * rules stay independent of physical tables (no new ledgers, no coupling).
 */

export const ECONOMIC_LEDGERS = [
  'billing',
  'receivable',
  'settlement',
  'treasury',
  'payable',
  'payment',
  'journal_entry',
] as const;

export type EconomicLedger = (typeof ECONOMIC_LEDGERS)[number];

export type ReconciliationFindingKind =
  | 'MISSING_POSTING'
  | 'DUPLICATE_POSTING'
  | 'AMOUNT_DIVERGENT'
  | 'CURRENCY_DIVERGENT'
  | 'SOURCE_NOT_FOUND'
  | 'UNBALANCED_POSTING';

export type EconomicSourceRef = {
  ledger: EconomicLedger;
  id: string;
};

/**
 * One economic fact (an effect). `source` identifies the upstream economic
 * origin (null for root facts such as billing). Journal entries express their
 * source as the economic event they post (`sourceContext` + `sourceId`), and
 * carry the debits/credits required to detect unbalanced postings.
 */
export type EconomicFact = {
  id: string;
  ledger: EconomicLedger;
  /** Normalized positive decimal string (e.g. "123.4500"); informational for journal entries. */
  amount: string;
  currencyCode: string;
  /** Source reference mandatory for every downstream effect (traceability). */
  sourceReference?: string;
  source?: EconomicSourceRef | null;
  postingSource?: { sourceContext: string; sourceId: string } | null;
  /**
   * Posting source kind expected for this economic fact (e.g. a settlement is
   * expected to be posted under SETTLEMENT, a payment under PAYMENT). Ledgers
   * without a defined accounting source kind keep this undefined and are still
   * reconciled for origin existence, amount agreement, duplicates and balance.
   */
  expectedPostingSourceContext?: string;
  debits?: Array<{ amount: string }>;
  credits?: Array<{ amount: string }>;
};

export type ReconciliationFinding = {
  kind: ReconciliationFindingKind;
  factId: string;
  ledger: EconomicLedger;
  detail: string;
};

export type ContinuousReconciliationReport = {
  status: 'PASS' | 'FAIL';
  duplicateEconomicEffects: number;
  unbalancedPostings: number;
  findings: ReconciliationFinding[];
};

function addFinding(
  findings: ReconciliationFinding[],
  kind: ReconciliationFindingKind,
  fact: EconomicFact,
  detail: string,
): void {
  findings.push({ kind, factId: fact.id, ledger: fact.ledger, detail });
}

/**
 * Reconciles the normalized facts. Every downstream fact must reference an
 * existing source, amount chains must agree, and every economic fact that must
 * be posted has exactly one balanced POSTED journal entry.
 */
export function runContinuousReconciliation(facts: EconomicFact[]): ContinuousReconciliationReport {
  const byId = new Map(facts.map((fact) => [`${fact.ledger}:${fact.id}`, fact]));
  const findings: ReconciliationFinding[] = [];

  for (const fact of facts) {
    // 1) Origin existence (never a dangling economic origin).
    if (fact.source) {
      const key = `${fact.source.ledger}:${fact.source.id}`;
      if (!byId.has(key)) {
        addFinding(findings, 'SOURCE_NOT_FOUND', fact, `source ${fact.source.ledger}:${fact.source.id} not found`);
      }
    }
    if (fact.ledger !== 'journal_entry' && !fact.sourceReference) {
      addFinding(findings, 'SOURCE_NOT_FOUND', fact, 'downstream economic effect is missing sourceReference');
    }
  }

  // 2) Journal entry integrity (balance + duplicate posting of one source).
  const journalEntries = facts.filter((fact) => fact.ledger === 'journal_entry');
  const postingsBySource = new Map<string, EconomicFact[]>();
  for (const journal of journalEntries) {
    const debit = sumMoneyAmounts(journal.debits?.map((line) => line.amount) ?? []);
    const credit = sumMoneyAmounts(journal.credits?.map((line) => line.amount) ?? []);
    if (!moneyAmountsEqual(debit, credit)) {
      addFinding(findings, 'UNBALANCED_POSTING', journal, `debit ${debit} != credit ${credit}`);
    }
    if (journal.postingSource) {
      const key = `${journal.postingSource.sourceContext}:${journal.postingSource.sourceId}`;
      const existing = postingsBySource.get(key) ?? [];
      existing.push(journal);
      postingsBySource.set(key, existing);
    }
  }
  const unbalancedPostings = findings.filter((finding) => finding.kind === 'UNBALANCED_POSTING').length;
  for (const [key, entries] of postingsBySource) {
    if (entries.length > 1) {
      for (const entry of entries) {
        addFinding(findings, 'DUPLICATE_POSTING', entry, `more than one POSTED journal entry for ${key}`);
      }
    }
  }

  // 3) Missing posting: a fact with an expected posting source kind must have
  //    exactly one POSTED journal entry referencing it.
  for (const fact of facts) {
    if (!fact.expectedPostingSourceContext) {
      continue;
    }
    const postings = journalEntries.filter(
      (journal) =>
        journal.postingSource?.sourceContext === fact.expectedPostingSourceContext &&
        journal.postingSource?.sourceId === fact.id,
    );
    if (postings.length === 0) {
      addFinding(
        findings,
        'MISSING_POSTING',
        fact,
        `${fact.ledger}:${fact.id} has no ${fact.expectedPostingSourceContext} journal entry posting`,
      );
    }
    for (const journal of postings) {
      if (journal.currencyCode !== fact.currencyCode) {
        addFinding(
          findings,
          'CURRENCY_DIVERGENT',
          journal,
          `journal ${journal.id} currency ${journal.currencyCode} != ${fact.ledger}:${fact.id} currency ${fact.currencyCode}`,
        );
      }
    }
  }

  // 4) Value divergence between an effect and its declared source.
  for (const fact of facts) {
    if (!fact.source) {
      continue;
    }
    const source = byId.get(`${fact.source.ledger}:${fact.source.id}`);
    if (source && source.currencyCode !== fact.currencyCode) {
      addFinding(
        findings,
        'CURRENCY_DIVERGENT',
        fact,
        `${fact.ledger}:${fact.id} currency ${fact.currencyCode} != source ${fact.source.ledger}:${fact.source.id} currency ${source.currencyCode}`,
      );
    } else if (source && !moneyAmountsEqual(source.amount, fact.amount)) {
      // Comparing nominal amounts across currencies is not an economic equality check.
      addFinding(
        findings,
        'AMOUNT_DIVERGENT',
        fact,
        `${fact.ledger}:${fact.id} amount ${fact.amount} != source ${fact.source.ledger}:${fact.source.id} amount ${source.amount}`,
      );
    }
  }

  const duplicateEconomicEffects = findings.filter((finding) => finding.kind === 'DUPLICATE_POSTING').length;
  return {
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    duplicateEconomicEffects,
    unbalancedPostings,
    findings,
  };
}

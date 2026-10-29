/**
 * STRICT HML economic-chain proof. Never provision, settle, post or reconcile data.
 * All mutations belong to the already-authorized application services and HML seed.
 * A missing edge fails the proof: there is no production fallback or synthetic PASS.
 *
 * Intentionally separate from verify-hml-business.ts until the existing synthetic
 * scenario runner can create the real finance/treasury/ledger facts via commands.
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { Pool } from 'pg';
import type { DatabaseService } from '../../infrastructure/database/database.service';
import { EconomicTraceReadModelService } from '../../accounting/repositories/economic-trace.read-model';

config({ path: process.env['CISNE_ENV'] === 'hml' ? '.env.hml' : '.env' });

const namespace = 'cisne-synthetic-dev-v1';
const scenarios = ['locacao-full', 'transporte-full'] as const;

function requireHml(): void {
  if (
    process.env['CISNE_ENV'] !== 'hml' ||
    process.env['HML_INTEGRATIONS_SANDBOX'] !== 'true' ||
    process.env['NODE_ENV'] === 'production'
  ) {
    throw new Error('HML_ECONOMIC_PROOF_FORBIDDEN_OUTSIDE_ISOLATED_HML');
  }
}

function requireExactlyOne<T>(
  name: string,
  scenario: string,
  rows: T[],
): T {
  if (rows.length !== 1) {
    throw new Error(`HML_ECONOMIC_${name}:${scenario}:expected=1,actual=${rows.length}`);
  }
  return rows[0]!;
}

type Origin = {
  client_id: string;
  service_order_id: string;
  measurement_id: string;
  billing_record_id: string;
  billing_document_id: string;
  receivable_id: string;
  document_amount: string;
  principal: string;
  currency_code: string;
  unit_id: string;
};

type Settlement = { id: string; amount: string; currency_code: string };
type MoneyMovement = { id: string; amount: string; currency_code: string; account_id: string };
type Reconciliation = { id: string; amount: string; currency_code: string };
type EconomicPosting = {
  event_id: string; posting_request_id: string; journal_entry_id: string;
  amount: string; currency_code: string;
  debit_total: string; credit_total: string; journal_lines: string;
};

export async function verifyHmlEconomicSpine(pool: Pool): Promise<Array<Record<string, string>>> {
  requireHml();
  const trace = new EconomicTraceReadModelService({
    getConnection: () => ({ pool }),
  } as unknown as DatabaseService);
  const evidence: Array<Record<string, string>> = [];

  for (const scenario of scenarios) {
    const origin = requireExactlyOne('ORIGIN', scenario, (await pool.query<Origin>(
      `SELECT c.id AS client_id, so.id AS service_order_id, m.id AS measurement_id,
              br.id AS billing_record_id, bd.id AS billing_document_id, r.id AS receivable_id,
              bd.total_amount::text AS document_amount, r.principal::text AS principal,
              r.currency_code, so.unit_id
         FROM pty.clients c
         JOIN so.service_orders so ON so.client_id = c.id AND so.status = 'COMPLETED'
         JOIN msr.measurements m ON m.service_order_id = so.id AND m.status = 'APPROVED'
         JOIN bil.billing_records br ON br.service_order_id = so.id AND br.measurement_id = m.id
         JOIN bil.billing_documents bd ON bd.billing_record_id = br.id AND bd.status = 'FINALIZED'
         JOIN fin.receivables r ON r.origin_billing_document_id = bd.id
          AND r.origin_service_order_id = so.id
          AND r.origin_measurement_id = m.id AND r.origin_billing_record_id = br.id
          AND r.client_id = c.id AND r.unit_id = so.unit_id
        WHERE c.external_erp_id = $1`,
      [`${namespace}:${scenario}`],
    )).rows);
    if (origin.principal !== origin.document_amount) {
      throw new Error(`HML_ECONOMIC_PRINCIPAL_MISMATCH:${scenario}`);
    }

    const acceptance = requireExactlyOne('CUSTOMER_ACCEPTANCE', scenario, (await pool.query<{
      result: string; evidence_id: string | null;
    }>(
      `SELECT a.result::text AS result, a.evidence_id
         FROM msr.customer_acceptances a
        WHERE a.measurement_id = $1 AND a.service_order_id = $2
        ORDER BY a.cycle_number DESC, a.occurred_at DESC, a.id DESC
        LIMIT 1`,
      [origin.measurement_id, origin.service_order_id],
    )).rows);
    if (acceptance.result !== 'ACCEPTED') {
      throw new Error(`HML_ECONOMIC_ACCEPTANCE_NOT_APPROVED:${scenario}`);
    }

    const settlements = (await pool.query<Settlement>(
      `SELECT id, amount::text AS amount, currency_code
         FROM fin.settlements
        WHERE receivable_id = $1 AND status = 'POSTED'`,
      [origin.receivable_id],
    )).rows;
    const settlement = requireExactlyOne('SETTLEMENT', scenario, settlements);
    if (settlement.amount !== origin.principal || settlement.currency_code !== origin.currency_code) {
      throw new Error(`HML_ECONOMIC_SETTLEMENT_MISMATCH:${scenario}`);
    }

    const movements = (await pool.query<MoneyMovement>(
      `SELECT id, account_id, amount::text AS amount, currency_code
         FROM fin.financial_transactions
        WHERE origin_kind = 'RECEIVABLE_SETTLEMENT'
          AND origin_id = $1 AND direction = 'CREDIT' AND status = 'POSTED'`,
      [settlement.id],
    )).rows;
    const movement = requireExactlyOne('BANK_MOVEMENT', scenario, movements);
    if (movement.amount !== settlement.amount || movement.currency_code !== origin.currency_code) {
      throw new Error(`HML_ECONOMIC_BANK_AMOUNT_MISMATCH:${scenario}`);
    }

    const reconciliations = (await pool.query<Reconciliation>(
      `SELECT rec.id, rm.amount::text AS amount, bs.currency_code
         FROM fin.reconciliation_matches rm
         JOIN fin.reconciliations rec ON rec.id = rm.reconciliation_id AND rec.status = 'CONFIRMED'
         JOIN fin.bank_statement_lines line ON line.id = rm.bank_statement_line_id
           AND line.bank_statement_id = rec.bank_statement_id
         JOIN fin.bank_statements bs ON bs.id = rec.bank_statement_id
         JOIN fin.financial_transactions tx ON tx.id = rm.financial_transaction_id
          AND tx.account_id = bs.financial_account_id
        WHERE rm.is_active = true AND rm.target_kind = 'RECEIVABLE_SETTLEMENT'
          AND rm.target_id = $1 AND rm.financial_transaction_id = $2
          AND rec.unit_id = $3 AND bs.unit_id = $3
          AND line.direction = tx.direction AND line.amount = tx.amount
          AND rm.amount = tx.amount`,
      [settlement.id, movement.id, origin.unit_id],
    )).rows;
    const reconciliation = requireExactlyOne('RECONCILIATION', scenario, reconciliations);
    if (reconciliation.amount !== settlement.amount ||
        reconciliation.currency_code !== settlement.currency_code) {
      throw new Error(`HML_ECONOMIC_RECONCILIATION_AMOUNT_MISMATCH:${scenario}`);
    }

    const postings = (await pool.query<EconomicPosting>(
      `SELECT e.id AS event_id, p.id AS posting_request_id,
              j.id AS journal_entry_id, e.amount::text AS amount, e.currency_code,
              COALESCE(SUM(l.amount) FILTER (WHERE l.direction = 'DEBIT'), 0)::text AS debit_total,
              COALESCE(SUM(l.amount) FILTER (WHERE l.direction = 'CREDIT'), 0)::text AS credit_total,
              COUNT(l.id)::text AS journal_lines
         FROM plt.economic_events e
         JOIN evt.outbox_events outbox ON outbox.id = e.outbox_event_id
         JOIN acc.accounting_posting_requests p
           ON p.source_id = e.source_id AND p.event_kind::text = e.event_kind
          AND p.unit_id = e.unit_id AND p.status = 'POSTED'
         JOIN acc.journal_entries j ON j.id = p.journal_entry_id
          AND j.status = 'POSTED' AND j.source_id = e.source_id
         JOIN acc.journal_entry_lines l ON l.journal_entry_id = j.id
        WHERE e.source_id = $1 AND e.event_kind = 'SETTLEMENT_CONFIRMED'
          AND e.source_kind = 'RECEIVABLE_SETTLEMENT' AND e.unit_id = $2
          AND j.currency_code = e.currency_code
        GROUP BY e.id, p.id, j.id`,
      [settlement.id, origin.unit_id],
    )).rows;
    const posting = requireExactlyOne('ACCOUNTING_POSTING', scenario, postings);
    if (posting.amount !== settlement.amount ||
        posting.currency_code !== settlement.currency_code ||
        posting.debit_total !== posting.credit_total ||
        posting.debit_total !== settlement.amount ||
        Number(posting.journal_lines) < 2) {
      throw new Error(`HML_ECONOMIC_UNBALANCED_JOURNAL:${scenario}`);
    }

    // Real backend Economic Trace read model, not an independently invented mapping.
    const view = await trace.forSettlement(settlement.id);
    if (!view || view.accountingState !== 'POSTED' ||
        view.factId !== settlement.id ||
        view.economicEvent?.id !== posting.event_id ||
        view.posting.journalEntryId !== posting.journal_entry_id ||
        view.posting.postingRequestId !== posting.posting_request_id) {
      throw new Error(`HML_ECONOMIC_TRACE_INCOMPLETE:${scenario}`);
    }

    evidence.push({
      scenario,
      clientId: origin.client_id,
      serviceOrderId: origin.service_order_id,
      measurementId: origin.measurement_id,
      billingRecordId: origin.billing_record_id,
      billingDocumentId: origin.billing_document_id,
      receivableId: origin.receivable_id,
      settlementId: settlement.id,
      bankMovementId: movement.id,
      reconciliationId: reconciliation.id,
      economicEventId: posting.event_id,
      postingRequestId: posting.posting_request_id,
      journalEntryId: posting.journal_entry_id,
      exactAmount: origin.principal,
      currencyCode: origin.currency_code,
      economicTraceState: view.accountingState,
    });
  }

  return evidence;
}

async function main(): Promise<void> {
  requireHml();
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('HML_ECONOMIC_DATABASE_URL_REQUIRED');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const evidence = await verifyHmlEconomicSpine(pool);
    process.stdout.write(JSON.stringify({
      economicChainVerified: evidence.length === scenarios.length,
      source: 'HML_ISOLATED_POSTGRES',
      productionValidated: false,
      scenarios: evidence,
    }) + '\\n');
  } finally {
    await pool.end();
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

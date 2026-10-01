import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from './env.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');

export { loadEnvFile };

export function loadRepoEnv() {
  loadEnvFile(resolve(repoRoot, '.env.example'));
  loadEnvFile(resolve(repoRoot, '.env'));
}

export function getTestDatabaseUrl() {
  return process.env['TEST_DATABASE_URL']?.trim() || undefined;
}

export function migrationFileHash(relativePath) {
  const filePath = resolve(repoRoot, 'packages/database/migrations', relativePath);
  const content = readFileSync(filePath, 'utf8');
  return createHash('sha256').update(content).digest('hex');
}

export function readDrizzleJournal() {
  const journalPath = resolve(repoRoot, 'packages/database/migrations/meta/_journal.json');
  return JSON.parse(readFileSync(journalPath, 'utf8'));
}

/**
 * Presence checks for domain migrations. `null` means "legacy journal entry":
 * hash may be recorded without a dedicated artefact probe (0000–0018).
 * Domain tags MUST have a probe so an incomplete DB is not marked applied.
 *
 * Classification rule (why every tag above 0018 has an entry here): a probe is
 * only registered when the migration produces a DETERMINISTIC, REPRESENTATIVE
 * structural effect that is cheap to verify — a relation, a column, an enum
 * label, an index or a function. Tags whose only effect is a data rewrite or an
 * incidental comment have no stable artefact and stay out of this table on
 * purpose; that is why this is a curated registry and not a generated one.
 *
 * Every effect below was read from the migration SQL itself, not guessed:
 * - 0043/0048 only create/replace `rpt.*` views (no table), hence `view`;
 * - 0040/0041/0075 only ADD COLUMN, hence `column`;
 * - 0055/0057 only ADD VALUE to an existing enum, hence `enumLabel`.
 * `scripts/check-scripts.mjs` asserts that every journal tag above the legacy
 * boundary appears here, so a new migration cannot be recorded without a probe.
 */
const MIGRATION_EFFECT_CHECKS = {
  '0019_service_orders_baseline': { table: 'so.service_orders' },
  '0020_service_orders_state_transitions': { column: ['so', 'service_orders', 'prepared_at'] },
  '0021_planning_allocation_baseline': { table: 'so.planned_resources' },
  '0022_service_order_execution_baseline': { table: 'so.execution_entries' },
  '0023_measurement_baseline': { table: 'msr.measurements' },
  '0024_billing_baseline': { table: 'bil.billing_records' },
  '0025_billing_documents': { table: 'bil.billing_documents' },
  '0026_domain_events_notifications': { table: 'evt.domain_events' },
  '0027_background_jobs': { table: 'plt.background_jobs' },
  '0028_transactional_outbox': { table: 'evt.outbox_events' },
  '0029_integration_inbox': { table: 'int.integration_inbox' },
  '0030_notification_delivery': { table: 'ntf.notifications' },
  '0031_operational_business_alerts': { table: 'alt.business_alerts' },
  '0032_background_job_operational_alert_scan': {
    enumLabel: ['plt', 'background_job_kind', 'OPERATIONAL_ALERT_SCAN'],
  },
  '0033_search_trigram_indexes': { index: 'clients_legal_name_trgm_idx' },
  '0034_report_exports': { table: 'rpt.report_exports' },
  '0035_service_orders_list_perf_index': { index: 'service_orders_unit_status_created_idx' },
  '0036_workforce_members_baseline': { table: 'wrk.workforce_members' },
  '0037_purchase_order_balance': { table: 'com.purchase_order_consumption_entries' },
  '0038_commercial_contracts_baseline': { table: 'com.contracts' },
  '0039_service_request_history_events': { table: 'sr.service_request_history_events' },
  '0040_proposal_commercial_snapshots': {
    column: ['com', 'proposal_versions', 'items_sale_total_amount'],
  },
  '0041_purchase_order_commercial_snapshots': {
    column: ['com', 'purchase_orders', 'items_line_total_amount'],
  },
  '0042_operational_costs_baseline': { table: 'so.operational_cost_entries' },
  '0043_cross_context_read_contracts': { view: 'rpt.read_service_orders' },
  '0044_finance_receivables': { table: 'fin.receivables' },
  '0045_finance_payables': { table: 'fin.payables' },
  '0046_finance_treasury': { table: 'fin.financial_accounts' },
  '0047_accounting_ledger': { table: 'acc.charts_of_accounts' },
  '0048_accounting_reporting': { view: 'acc.posted_journal_lines' },
  '0049_fiscal_core': { table: 'fis.fiscal_documents' },
  '0050_tax_engine': { table: 'fis.tax_rules' },
  '0051_inventory_core': { table: 'inv.inventory_items' },
  '0052_payroll_foundation': { table: 'pay.employment_contracts' },
  '0053_bank_reconciliation': { table: 'fin.bank_statements' },
  '0054_accounting_posting': { table: 'acc.accounting_posting_rules' },
  '0055_fiscal_accounting_events': {
    enumLabel: ['acc', 'posting_event_kind', 'TAX_CALCULATION_CONFIRMED'],
  },
  '0056_inventory_costing': { table: 'inv.costing_rules' },
  '0057_payroll_accounting_events': {
    enumLabel: ['acc', 'posting_event_kind', 'PAYROLL_REOPENED'],
  },
  '0058_bank_statement_import': { table: 'fin.bank_statement_imports' },
  '0059_period_close_controls': { table: 'acc.period_close_policies' },
  '0060_tax_assessment_obligation': { table: 'fis.tax_assessments' },
  '0061_fiscal_period_close': { table: 'fis.fiscal_periods' },
  '0062_fixed_asset_accounting': { table: 'acc.fixed_asset_registers' },
  '0063_budget_management': { table: 'fin.budgets' },
  '0064_supplier_master': { table: 'pty.suppliers' },
  '0065_procurement_core': { table: 'prc.purchase_requests' },
  '0066_supplier_invoice': { table: 'prc.supplier_invoices' },
  '0067_three_way_match': { table: 'prc.three_way_matches' },
  '0068_financial_approval_matrix': { table: '"authorization".approval_matrices' },
  '0069_expense_management': { table: 'fin.expenses' },
  '0070_receivable_collections': { table: 'fin.receivable_collections' },
  '0071_operational_authority_gates': {
    column: ['pty', 'clients', 'purchase_order_requirement'],
  },
  '0072_legal_establishment_master': { table: 'pty.legal_entities' },
  '0073_recurring_billing_schedule': { table: 'bil.recurring_billing_schedules' },
  '0074_access_administration': { table: '"authorization".access_roles' },
  '0075_accounting_entry_number': { column: ['acc', 'journal_entries', 'entry_number'] },
  '0076_deadline_kernel': { fn: ['so', 'deadline_for'] },
  '0077_workforce_member_identity': { column: ['wrk', 'workforce_members', 'identity_id'] },
  '0078_workforce_member_allocation': {
    column: ['res', 'resource_allocations', 'workforce_member_id'],
  },
  '0079_clients_list_indexes': { index: 'clients_legal_name_id_idx' },
  '0080_receivable_settlement_reversal': {
    enumLabel: ['fin', 'settlement_status', 'REVERSED'],
  },
  '0081_receivable_settlement_reversal_columns': {
    column: ['fin', 'settlements', 'reversal_idempotency_key'],
  },
  '0082_audit_trail_logs': { table: 'audit.audit_logs' },
};

/**
 * Tags 0000–0018 predate per-migration artefact probes, so a recorded hash without a
 * probe is legitimate for them. Any tag above this boundary without a probe is a gap
 * in MIGRATION_EFFECT_CHECKS, not a legacy entry: it must stay unrecorded so the
 * migrator actually runs it instead of silently marking an unmigrated database complete.
 *
 * The boundary is a 4-digit migration NUMBER, not a string prefix: comparing full tags
 * lexicographically puts `0018_service_requests_baseline` "above" `0018`, which would
 * wrongly treat the last legacy tag as a domain tag.
 */
export const LEGACY_UNPROBED_MAX_TAG = '0018';

const LEGACY_UNPROBED_MAX_NUMBER = Number(LEGACY_UNPROBED_MAX_TAG);

function migrationNumberOf(tag) {
  return Number.parseInt(tag.slice(0, 4), 10);
}

/** True when `tag` may legitimately lack an artefact probe. */
export function isLegacyUnprobedTag(tag) {
  const number = migrationNumberOf(tag);
  return Number.isNaN(number) || number <= LEGACY_UNPROBED_MAX_NUMBER;
}

/** Read-only view of the probe registry, for the completeness gate. */
export const MIGRATION_PROBE_TAGS = Object.freeze(Object.keys(MIGRATION_EFFECT_CHECKS));

/**
 * Validate the probe registry against the journal on disk. Cheap and hermetic: no
 * database, no network. Exposed so `scripts/check-scripts.mjs` can fail CI when a
 * migration ships without a probe — the exact gap that once let 0077/0078 be
 * recorded as applied without running.
 */
export function findUnprobedJournalTags() {
  const journal = readDrizzleJournal();
  return journal.entries
    .filter((entry) => !isLegacyUnprobedTag(entry.tag))
    .filter((entry) => MIGRATION_EFFECT_CHECKS[entry.tag] === undefined)
    .map((entry) => entry.tag);
}

async function migrationEffectsPresent(pool, tag) {
  const check = MIGRATION_EFFECT_CHECKS[tag];
  if (!check) {
    return null;
  }
  if (check.table) {
    return tableExists(pool, check.table);
  }
  if (check.view) {
    // `to_regclass` resolves any relation, views included; a view probe is kept as a
    // distinct kind so the registry states what the migration actually creates.
    return tableExists(pool, check.view);
  }
  if (check.column) {
    const [schema, table, column] = check.column;
    const result = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
       ) AS exists`,
      [schema, table, column],
    );
    return result.rows[0]?.exists === true;
  }
  if (check.enumLabel) {
    const [schema, typeName, label] = check.enumLabel;
    const result = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_type t
         INNER JOIN pg_enum e ON e.enumtypid = t.oid
         INNER JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = $1 AND t.typname = $2 AND e.enumlabel = $3
       ) AS exists`,
      [schema, typeName, label],
    );
    return result.rows[0]?.exists === true;
  }
  if (check.index) {
    const result = await pool.query('SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = $1) AS exists', [
      check.index,
    ]);
    return result.rows[0]?.exists === true;
  }
  if (check.fn) {
    const [schema, fnName] = check.fn;
    const result = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_proc p
         INNER JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = $1 AND p.proname = $2
       ) AS exists`,
      [schema, fnName],
    );
    return result.rows[0]?.exists === true;
  }
  return null;
}

export async function syncDrizzleJournal(pool) {
  const journal = readDrizzleJournal();

  // Fresh databases have no drizzle journal table yet — the migrator creates it
  // on first run. Reconciliation is only meaningful once the table exists, so
  // bail out early instead of failing on `drizzle.__drizzle_migrations`.
  const hasMigrationsTable = await tableExists(pool, 'drizzle.__drizzle_migrations');
  if (!hasMigrationsTable) {
    return { inserted: 0, removed: 0, unprobed: [], reason: 'migration journal table not created yet' };
  }

  const applied = await pool.query('SELECT hash FROM drizzle.__drizzle_migrations');
  const appliedHashes = new Set(applied.rows.map((row) => row.hash));

  const hasScopedRecords = await tableExists(pool, '"authorization".scoped_records');
  if (!hasScopedRecords) {
    return { inserted: 0, removed: 0, unprobed: [], reason: 'baseline schema not detected' };
  }

  let inserted = 0;
  let removed = 0;
  const unprobed = [];
  for (const entry of journal.entries) {
    const fileName = `${entry.tag}.sql`;
    const hash = migrationFileHash(fileName);
    const effects = await migrationEffectsPresent(pool, entry.tag);

    if (appliedHashes.has(hash)) {
      if (effects === false) {
        await pool.query('DELETE FROM drizzle.__drizzle_migrations WHERE hash = $1', [hash]);
        appliedHashes.delete(hash);
        removed += 1;
      }
      continue;
    }

    if (effects === true) {
      await pool.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [
        hash,
        entry.when,
      ]);
      appliedHashes.add(hash);
      inserted += 1;
      continue;
    }

    if (effects === null) {
      // No artefact probe. Legitimate for legacy tags, whose effects predate this
      // registry. For ANY later tag this is a gap in MIGRATION_EFFECT_CHECKS, and the
      // hash cannot be justified: recording it would claim an effect that was never
      // verified — exactly how 0077/0078 were once marked applied on a database where
      // they had not run, after which the migrator skipped them forever.
      //
      // Recording a migration as applied is a distinct operation from reconciling a
      // known-good journal (Flyway keeps `repair`/`validate` separate; Prisma requires
      // an explicit `migrate resolve --applied`). So an unprobed domain tag is left
      // UNRECORDED here and reported instead: the migrator then actually runs it, which
      // is the only outcome that cannot silently produce a schema behind its journal.
      if (!isLegacyUnprobedTag(entry.tag)) {
        unprobed.push(entry.tag);
        continue;
      }
      await pool.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [
        hash,
        entry.when,
      ]);
      appliedHashes.add(hash);
      inserted += 1;
    }
  }

  if (unprobed.length > 0) {
    console.warn(
      `[sync-drizzle-journal] ${unprobed.length} tag(s) above ${LEGACY_UNPROBED_MAX_TAG} have no ` +
        `artefact probe in MIGRATION_EFFECT_CHECKS and were deliberately NOT recorded: ` +
        `${unprobed.join(', ')}. Add a probe (scripts/check-scripts.mjs enforces this) so the ` +
        `migration is executed or proven instead of being marked applied blind.`,
    );
  }

  return {
    inserted,
    removed,
    unprobed,
    reason:
      inserted > 0 || removed > 0
        ? 'journal reconciled'
        : unprobed.length > 0
          ? 'journal aligned except for unprobed tags'
          : 'journal already aligned',
  };
}

async function tableExists(pool, table) {
  const result = await pool.query('SELECT to_regclass($1) AS regclass', [table]);
  return result.rows[0]?.regclass !== null;
}

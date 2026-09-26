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
  '0070_receivable_collections': { table: 'fin.receivable_collections' },
  '0071_operational_authority_gates': {
    column: ['pty', 'clients', 'purchase_order_requirement'],
  },
  '0072_legal_establishment_master': { table: 'pty.legal_entities' },
  '0073_recurring_billing_schedule': { table: 'bil.recurring_billing_schedules' },
  '0074_access_administration': { table: '"authorization".access_roles' },
  '0076_deadline_kernel': { fn: ['so', 'deadline_for'] },
  '0077_workforce_member_identity': { column: ['wrk', 'workforce_members', 'identity_id'] },
  '0078_workforce_member_allocation': {
    column: ['res', 'resource_allocations', 'workforce_member_id'],
  },
};

/**
 * Tags 0000–0018 predate per-migration artefact probes, so a recorded hash without a
 * probe is legitimate for them. Any tag above this boundary without a probe is a gap
 * in MIGRATION_EFFECT_CHECKS, not a legacy entry: it must stay unrecorded so the
 * migrator actually runs it instead of silently marking an unmigrated database complete.
 */
const LEGACY_UNPROBED_MAX_TAG = '0018';

async function migrationEffectsPresent(pool, tag) {
  const check = MIGRATION_EFFECT_CHECKS[tag];
  if (!check) {
    return null;
  }
  if (check.table) {
    return tableExists(pool, check.table);
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
      // No artefact probe. Legitimate for legacy tags; for any later tag this is a gap
      // in MIGRATION_EFFECT_CHECKS and the hash is about to be recorded WITHOUT the
      // migration having been proven to run. That is how 0077/0078 were once marked
      // applied on an unmigrated database, so make the gap loud instead of silent.
      if (entry.tag > LEGACY_UNPROBED_MAX_TAG) {
        unprobed.push(entry.tag);
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
        `artefact probe in MIGRATION_EFFECT_CHECKS and were recorded from hash alone: ` +
        `${unprobed.join(', ')}. Add a probe so an unmigrated database is never marked applied.`,
    );
  }

  return {
    inserted,
    removed,
    unprobed,
    reason:
      inserted > 0 || removed > 0 ? 'journal reconciled' : 'journal already aligned',
  };
}

async function tableExists(pool, table) {
  const result = await pool.query('SELECT to_regclass($1) AS regclass', [table]);
  return result.rows[0]?.regclass !== null;
}

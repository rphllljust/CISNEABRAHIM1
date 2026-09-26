import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { getTestDatabaseUrl, loadVitestEnv } from './load-vitest-env';

loadVitestEnv();

const repoRoot = resolve(__dirname, '../../../../');
const journalPath = resolve(repoRoot, 'packages/database/migrations/meta/_journal.json');
const migrationsDir = resolve(repoRoot, 'packages/database/migrations');

function migrationFileHash(fileName: string): string {
  const content = readMigrationSql(join(migrationsDir, fileName));
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Reconcile `drizzle.__drizzle_migrations` with the migrations folder.
 *
 * ORDERING INVARIANT: this must only ever run AFTER the per-migration coverage
 * checks below. Recording a hash claims "this migration's effect is present", and
 * the only things that can justify that claim are those checks. Running it first is
 * how a database once ended up with the full journal and a schema missing the last
 * migrations: the hash was written for tags this file has no coverage for, the
 * drizzle migrator then treated them as applied and never ran them.
 *
 * A missing journal table is not an error: a database that has never been migrated
 * has nothing to reconcile, and the coverage checks build the schema instead. Same
 * stance as `countAppliedMigrations` in `packages/database/src/migrate.ts`.
 */
async function syncDrizzleJournal(pool: pg.Pool): Promise<void> {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string; when: number }>;
  };
  let applied: pg.QueryResult<{ hash: string }>;
  try {
    applied = await pool.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations');
  } catch (error) {
    // 42P01 = undefined_table: the migrator has never run here.
    if ((error as { code?: string }).code === '42P01') {
      return;
    }
    throw error;
  }
  const appliedHashes = new Set(applied.rows.map((row) => row.hash));

  const hasScopedRecords = await tableExists(pool, '"authorization".scoped_records');
  if (!hasScopedRecords) {
    return;
  }

  for (const entry of journal.entries) {
    const hash = migrationFileHash(`${entry.tag}.sql`);
    if (appliedHashes.has(hash)) {
      continue;
    }
    await pool.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [
      hash,
      entry.when,
    ]);
    appliedHashes.add(hash);
  }
}

async function tableExists(pool: pg.Pool, table: string): Promise<boolean> {
  const result = await pool.query<{ regclass: string | null }>(
    'SELECT to_regclass($1) AS regclass',
    [table],
  );
  return result.rows[0]?.regclass !== null;
}

async function columnExists(
  pool: pg.Pool,
  schema: string,
  table: string,
  column: string,
): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = $2
         AND column_name = $3
     ) AS exists`,
    [schema, table, column],
  );
  return result.rows[0]?.exists === true;
}

function readMigrationSql(filePath: string): string {
  const bytes = readFileSync(filePath);
  const isUtf16Le =
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes.length >= 4 && bytes[1] === 0 && bytes[3] === 0));
  const sql = isUtf16Le ? bytes.toString('utf16le') : bytes.toString('utf8');
  return sql.replace(/^\uFEFF/, '').replace(/\0/g, '');
}

function splitMigrationStatements(sql: string): string[] {
  if (sql.includes('--> statement-breakpoint')) {
    return sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
  }
  return sql
    .split(/;\s*(?=(?:CREATE|ALTER|DROP|COMMENT)\b)/i)
    .map((statement) => statement.trim().replace(/;$/, ''))
    .filter((statement) => statement.length > 0);
}

async function applySqlFile(pool: pg.Pool, relativePath: string): Promise<void> {
  const filePath = resolve(__dirname, '../../../../packages/database/migrations', relativePath);
  const statements = splitMigrationStatements(readMigrationSql(filePath));

  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('already exists') ||
        message.includes('duplicate key') ||
        message.includes('duplicate_object')
      ) {
        continue;
      }
      throw error;
    }
  }
}

export default async function ensureMigrations(): Promise<void> {
  const testDatabaseUrl = getTestDatabaseUrl();
  if (!testDatabaseUrl) {
    return;
  }

  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  try {
    const hasInfrastructureBaseline = await tableExists(pool, 'infrastructure.schema_baseline');
    if (!hasInfrastructureBaseline) {
      await applySqlFile(pool, '0000_early_thaddeus_ross.sql');
    }

    const hasIdentities = await tableExists(pool, 'identity.identities');
    if (!hasIdentities) {
      await applySqlFile(pool, '0001_striped_the_liberteens.sql');
    }

    const hasAuthorizationSchema = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'authorization') AS exists`,
    );
    if (!hasAuthorizationSchema.rows[0]?.exists) {
      await applySqlFile(pool, '0002_authorization_baseline.sql');
    }

    const hasScopedRecords = await tableExists(pool, '"authorization".scoped_records');
    if (!hasScopedRecords) {
      await applySqlFile(pool, '0003_contextual_scope_enums.sql');
      await applySqlFile(pool, '0004_contextual_scope_tables.sql');
    }

    const hasSecurityAudit = await tableExists(pool, 'audit.security_audit_events');
    if (!hasSecurityAudit) {
      await applySqlFile(pool, '0005_security_audit_events.sql');
    }

    const hasClients = await tableExists(pool, 'pty.clients');
    if (!hasClients) {
      await applySqlFile(pool, '0006_clients_baseline.sql');
    }

    const hasCatalog = await tableExists(pool, 'cat.service_definitions');
    if (!hasCatalog) {
      await applySqlFile(pool, '0007_service_catalog_baseline.sql');
    }

    const hasLineageVersion = await columnExists(pool, 'cat', 'service_definitions', 'version');
    if (!hasLineageVersion) {
      await applySqlFile(pool, '0008_service_definitions_lineage_version.sql');
    }

    const hasUnits = await tableExists(pool, 'cat.units_of_measure');
    if (!hasUnits) {
      await applySqlFile(pool, '0009_units_of_measure.sql');
    }

    const hasPhysicalResourceTypes = await tableExists(pool, 'cat.physical_resource_types');
    if (!hasPhysicalResourceTypes) {
      await applySqlFile(pool, '0010_physical_resource_types.sql');
    }

    const hasLaborTypes = await tableExists(pool, 'cat.operational_labor_types');
    if (!hasLaborTypes) {
      await applySqlFile(pool, '0011_operational_labor_types.sql');
    }

    const hasMeasurementBasis = await columnExists(pool, 'cat', 'service_definition_versions', 'measurement_basis');
    if (!hasMeasurementBasis) {
      await applySqlFile(pool, '0012_commercial_pricing_measurement.sql');
    }

    const hasObservationEvidenceKind = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_type t
         INNER JOIN pg_enum e ON e.enumtypid = t.oid
         INNER JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'cat'
           AND t.typname = 'evidence_kind'
           AND e.enumlabel = 'OBSERVATION'
       ) AS exists`,
    );
    if (!hasObservationEvidenceKind.rows[0]?.exists) {
      await applySqlFile(pool, '0013_execution_requirements.sql');
    }

    const hasPhysicalAssets = await tableExists(pool, 'ast.physical_assets');
    if (!hasPhysicalAssets) {
      await applySqlFile(pool, '0014_physical_assets_baseline.sql');
    }

    const hasDocuments = await tableExists(pool, 'doc.documents');
    if (!hasDocuments) {
      await applySqlFile(pool, '0015_documents_baseline.sql');
    }

    const hasProposals = await tableExists(pool, 'com.proposals');
    if (!hasProposals) {
      await applySqlFile(pool, '0016_commercial_proposals_baseline.sql');
    }

    const hasPurchaseOrders = await tableExists(pool, 'com.purchase_orders');
    if (!hasPurchaseOrders) {
      await applySqlFile(pool, '0017_commercial_purchase_orders_baseline.sql');
    }

    const hasServiceRequests = await tableExists(pool, 'sr.service_requests');
    if (!hasServiceRequests) {
      await applySqlFile(pool, '0018_service_requests_baseline.sql');
    }

    const hasServiceOrders = await tableExists(pool, 'so.service_orders');
    if (!hasServiceOrders) {
      await applySqlFile(pool, '0019_service_orders_baseline.sql');
    }

    const hasPreparedAt = await columnExists(pool, 'so', 'service_orders', 'prepared_at');
    if (!hasPreparedAt) {
      await applySqlFile(pool, '0020_service_orders_state_transitions.sql');
    }

    const hasPlannedResources = await tableExists(pool, 'so.planned_resources');
    if (!hasPlannedResources) {
      await applySqlFile(pool, '0021_planning_allocation_baseline.sql');
    }

    const hasExecutionEntries = await tableExists(pool, 'so.execution_entries');
    if (!hasExecutionEntries) {
      await applySqlFile(pool, '0022_service_order_execution_baseline.sql');
    }

    const hasMeasurements = await tableExists(pool, 'msr.measurements');
    if (!hasMeasurements) {
      await applySqlFile(pool, '0023_measurement_baseline.sql');
    }

    const hasBillingRecords = await tableExists(pool, 'bil.billing_records');
    if (!hasBillingRecords) {
      await applySqlFile(pool, '0024_billing_baseline.sql');
    }

    const hasBillingDocuments = await tableExists(pool, 'bil.billing_documents');
    if (!hasBillingDocuments) {
      await applySqlFile(pool, '0025_billing_documents.sql');
    } else {
      await pool.query(`
        ALTER TABLE bil.billing_document_items
        DROP CONSTRAINT IF EXISTS billing_document_items_billing_item_id_fkey
      `);
      await pool.query(`
        ALTER TABLE bil.billing_document_items
        ADD CONSTRAINT billing_document_items_billing_item_id_fkey
        FOREIGN KEY (billing_item_id) REFERENCES bil.billing_items(id) ON DELETE SET NULL
      `);
    }

    const hasDomainEvents = await tableExists(pool, 'evt.domain_events');
    if (!hasDomainEvents) {
      await applySqlFile(pool, '0026_domain_events_notifications.sql');
    }

    const hasBackgroundJobs = await tableExists(pool, 'plt.background_jobs');
    if (!hasBackgroundJobs) {
      await applySqlFile(pool, '0027_background_jobs.sql');
    }

    const hasOutboxEvents = await tableExists(pool, 'evt.outbox_events');
    if (!hasOutboxEvents) {
      await applySqlFile(pool, '0028_transactional_outbox.sql');
    }

    const hasIntegrationInbox = await tableExists(pool, 'int.integration_inbox');
    if (!hasIntegrationInbox) {
      await applySqlFile(pool, '0029_integration_inbox.sql');
    }

    const hasNotifications = await tableExists(pool, 'ntf.notifications');
    if (!hasNotifications) {
      await applySqlFile(pool, '0030_notification_delivery.sql');
    }

    const hasBusinessAlerts = await tableExists(pool, 'alt.business_alerts');
    if (!hasBusinessAlerts) {
      await applySqlFile(pool, '0031_operational_business_alerts.sql');
    }

    const hasOperationalAlertScanJob = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_type t
         INNER JOIN pg_enum e ON e.enumtypid = t.oid
         INNER JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'plt'
           AND t.typname = 'background_job_kind'
           AND e.enumlabel = 'OPERATIONAL_ALERT_SCAN'
       ) AS exists`,
    );
    if (!hasOperationalAlertScanJob.rows[0]?.exists) {
      await applySqlFile(pool, '0032_background_job_operational_alert_scan.sql');
    }

    const hasClientNameTrgm = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'clients_legal_name_trgm_idx') AS exists`,
    );
    if (!hasClientNameTrgm.rows[0]?.exists) {
      await applySqlFile(pool, '0033_search_trigram_indexes.sql');
    }

    const hasReportExports = await tableExists(pool, 'rpt.report_exports');
    if (!hasReportExports) {
      await applySqlFile(pool, '0034_report_exports.sql');
    }

    const hasServiceOrdersListIdx = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'service_orders_unit_status_created_idx') AS exists`,
    );
    if (!hasServiceOrdersListIdx.rows[0]?.exists) {
      await applySqlFile(pool, '0035_service_orders_list_perf_index.sql');
    }

    const hasWorkforceMembers = await tableExists(pool, 'wrk.workforce_members');
    if (!hasWorkforceMembers) {
      await applySqlFile(pool, '0036_workforce_members_baseline.sql');
    }

    const hasPoConsumedAmount = await columnExists(pool, 'com', 'purchase_orders', 'consumed_amount');
    if (!hasPoConsumedAmount) {
      await applySqlFile(pool, '0037_purchase_order_balance.sql');
    }

    const hasContracts = await tableExists(pool, 'com.contracts');
    if (!hasContracts) {
      await applySqlFile(pool, '0038_commercial_contracts_baseline.sql');
    }

    const hasServiceRequestHistory = await tableExists(pool, 'sr.service_request_history_events');
    if (!hasServiceRequestHistory) {
      await applySqlFile(pool, '0039_service_request_history_events.sql');
    }

    const hasProposalCommercialSnapshot = await columnExists(
      pool,
      'com',
      'proposal_items',
      'commercial_snapshot',
    );
    if (!hasProposalCommercialSnapshot) {
      await applySqlFile(pool, '0040_proposal_commercial_snapshots.sql');
    }

    const hasPurchaseOrderCommercialSnapshot = await columnExists(
      pool,
      'com',
      'purchase_order_items',
      'commercial_snapshot',
    );
    if (!hasPurchaseOrderCommercialSnapshot) {
      await applySqlFile(pool, '0041_purchase_order_commercial_snapshots.sql');
    }

    const hasOperationalCosts = await tableExists(pool, 'so.operational_cost_entries');
    if (!hasOperationalCosts) {
      await applySqlFile(pool, '0042_operational_costs_baseline.sql');
    }

    const hasCrossContextReadContracts = await tableExists(pool, 'rpt.read_service_orders');
    if (!hasCrossContextReadContracts) {
      await applySqlFile(pool, '0043_cross_context_read_contracts.sql');
    }

    const hasReceivables = await tableExists(pool, 'fin.receivables');
    if (!hasReceivables) {
      await applySqlFile(pool, '0044_finance_receivables.sql');
    }

    const hasPayables = await tableExists(pool, 'fin.payables');
    if (!hasPayables) {
      await applySqlFile(pool, '0045_finance_payables.sql');
    }

    const hasTreasury = await tableExists(pool, 'fin.financial_accounts');
    if (!hasTreasury) {
      await applySqlFile(pool, '0046_finance_treasury.sql');
    }

    const hasAccounting = await tableExists(pool, 'acc.journal_entries');
    if (!hasAccounting) {
      await applySqlFile(pool, '0047_accounting_ledger.sql');
    }

    const hasPostedJournalLines = await tableExists(pool, 'acc.posted_journal_lines');
    if (!hasPostedJournalLines) {
      await applySqlFile(pool, '0048_accounting_reporting.sql');
    }

    const hasFiscalDocuments = await tableExists(pool, 'fis.fiscal_documents');
    if (!hasFiscalDocuments) {
      await applySqlFile(pool, '0049_fiscal_core.sql');
    }

    const hasTaxRules = await tableExists(pool, 'fis.tax_rules');
    if (!hasTaxRules) {
      await applySqlFile(pool, '0050_tax_engine.sql');
    }

    const hasInventoryItems = await tableExists(pool, 'inv.inventory_items');
    const hasStockBalances = await tableExists(pool, 'inv.stock_balances');
    if (!hasInventoryItems || !hasStockBalances) {
      await applySqlFile(pool, '0051_inventory_core.sql');
    }

    const hasEmploymentContracts = await tableExists(pool, 'pay.employment_contracts');
    if (!hasEmploymentContracts) {
      await applySqlFile(pool, '0052_payroll_foundation.sql');
    }

    const hasBankStatements = await tableExists(pool, 'fin.bank_statements');
    if (!hasBankStatements) {
      await applySqlFile(pool, '0053_bank_reconciliation.sql');
    } else {
      await pool.query(`
        CREATE OR REPLACE FUNCTION fin.forbid_confirmed_reconciliation_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            IF OLD.status = 'CONFIRMED' THEN
              RAISE EXCEPTION 'BANK_RECONCILIATION_CONFIRMED_IMMUTABLE' USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN OLD;
          END IF;
          IF OLD.status = 'CONFIRMED' THEN
            IF NEW.status = 'UNRECONCILED' AND NEW.unreconciled_at IS NOT NULL THEN
              RETURN NEW;
            END IF;
            RAISE EXCEPTION 'BANK_RECONCILIATION_CONFIRMED_IMMUTABLE' USING ERRCODE = 'restrict_violation';
          END IF;
          RETURN NEW;
        END;
        $$;
      `);
    }

    const hasPostingRules = await tableExists(pool, 'acc.accounting_posting_rules');
    if (!hasPostingRules) {
      await applySqlFile(pool, '0054_accounting_posting.sql');
    } else {
      await pool.query(`
        CREATE OR REPLACE FUNCTION acc.forbid_published_posting_rule_version_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            IF OLD.status = 'PUBLISHED' THEN
              RAISE EXCEPTION 'ACCOUNTING_RULE_VERSION_IMMUTABLE' USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN OLD;
          END IF;
          IF OLD.status = 'PUBLISHED' THEN
            RAISE EXCEPTION 'ACCOUNTING_RULE_VERSION_IMMUTABLE' USING ERRCODE = 'restrict_violation';
          END IF;
          RETURN NEW;
        END;
        $$;
      `);
    }

    const hasTaxCalculationEvent = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_enum e
         INNER JOIN pg_type t ON t.oid = e.enumtypid
         INNER JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'acc'
           AND t.typname = 'posting_event_kind'
           AND e.enumlabel = 'TAX_CALCULATION_CONFIRMED'
       ) AS exists`,
    );
    if (!hasTaxCalculationEvent.rows[0]?.exists) {
      await applySqlFile(pool, '0055_fiscal_accounting_events.sql');
    }

    const hasCostingRules = await tableExists(pool, 'inv.costing_rules');
    if (!hasCostingRules) {
      await applySqlFile(pool, '0056_inventory_costing.sql');
    } else {
      await pool.query(`
        CREATE OR REPLACE FUNCTION inv.forbid_published_costing_rule_version_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            IF OLD.status = 'PUBLISHED' THEN
              RAISE EXCEPTION 'INVENTORY_COSTING_VERSION_IMMUTABLE' USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN OLD;
          END IF;
          IF OLD.status = 'PUBLISHED' THEN
            RAISE EXCEPTION 'INVENTORY_COSTING_VERSION_IMMUTABLE' USING ERRCODE = 'restrict_violation';
          END IF;
          RETURN NEW;
        END;
        $$;
      `);
    }

    const hasPayrollReopenedEvent = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_enum e
         INNER JOIN pg_type t ON t.oid = e.enumtypid
         INNER JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'acc'
           AND t.typname = 'posting_event_kind'
           AND e.enumlabel = 'PAYROLL_REOPENED'
       ) AS exists`,
    );
    if (!hasPayrollReopenedEvent.rows[0]?.exists) {
      await applySqlFile(pool, '0057_payroll_accounting_events.sql');
    }

    const hasBankStatementImports = await tableExists(pool, 'fin.bank_statement_imports');
    if (!hasBankStatementImports) {
      await applySqlFile(pool, '0058_bank_statement_import.sql');
    }

    const hasPeriodClosePolicies = await tableExists(pool, 'acc.period_close_policies');
    if (!hasPeriodClosePolicies) {
      await applySqlFile(pool, '0059_period_close_controls.sql');
    }

    const hasTaxAssessments = await tableExists(pool, 'fis.tax_assessments');
    if (!hasTaxAssessments) {
      await applySqlFile(pool, '0060_tax_assessment_obligation.sql');
    }

    const hasFiscalPeriods = await tableExists(pool, 'fis.fiscal_periods');
    if (!hasFiscalPeriods) {
      await applySqlFile(pool, '0061_fiscal_period_close.sql');
    } else {
      await pool.query(`
CREATE OR REPLACE FUNCTION fis.reject_ordinary_write_on_closed_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  competence_key text;
  target_unit text;
  closed_exists boolean;
BEGIN
  IF TG_TABLE_NAME = 'fiscal_documents' THEN
    target_unit := COALESCE(NEW.unit_id, OLD.unit_id);
    competence_key := to_char(COALESCE(NEW.issued_on, OLD.issued_on)::date, 'YYYY-MM');
    IF TG_OP = 'UPDATE' AND NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED' THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'tax_assessments' THEN
    target_unit := COALESCE(NEW.unit_id, OLD.unit_id);
    competence_key := COALESCE(NEW.period_key, OLD.period_key);
    IF NEW.supersedes_assessment_id IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IN ('ADJUSTED', 'CANCELLED') THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM fis.fiscal_periods p
    WHERE p.unit_id = target_unit
      AND p.period_key = competence_key
      AND p.status = 'CLOSED'
  ) INTO closed_exists;

  IF closed_exists THEN
    RAISE EXCEPTION 'FISCAL_PERIOD_CLOSED'
      USING ERRCODE = 'P0001';
  END IF;
      RETURN NEW;
END;
$$;`);
    }

    const hasFixedAssetRegisters = await tableExists(pool, 'acc.fixed_asset_registers');
    if (!hasFixedAssetRegisters) {
      await applySqlFile(pool, '0062_fixed_asset_accounting.sql');
    }

    const hasBudgets = await tableExists(pool, 'fin.budgets');
    if (!hasBudgets) {
      await applySqlFile(pool, '0063_budget_management.sql');
    }

    const hasSuppliers = await tableExists(pool, 'pty.suppliers');
    if (!hasSuppliers) {
      await applySqlFile(pool, '0064_supplier_master.sql');
    }

    const hasPurchaseRequests = await tableExists(pool, 'prc.purchase_requests');
    if (!hasPurchaseRequests) {
      await applySqlFile(pool, '0065_procurement_core.sql');
    }

    const hasSupplierInvoices = await tableExists(pool, 'prc.supplier_invoices');
    if (!hasSupplierInvoices) {
      await applySqlFile(pool, '0066_supplier_invoice.sql');
    }

    const hasThreeWayMatches = await tableExists(pool, 'prc.three_way_matches');
    if (!hasThreeWayMatches) {
      await applySqlFile(pool, '0067_three_way_match.sql');
    }

    const hasApprovalMatrices = await tableExists(pool, 'authorization.approval_matrices');
    if (!hasApprovalMatrices) {
      await applySqlFile(pool, '0068_financial_approval_matrix.sql');
    }

    const hasExpenses = await tableExists(pool, 'fin.expenses');
    if (!hasExpenses) {
      await applySqlFile(pool, '0069_expense_management.sql');
    }

    const hasReceivableCollections = await tableExists(pool, 'fin.receivable_collections');
    if (!hasReceivableCollections) {
      await applySqlFile(pool, '0070_receivable_collections.sql');
    }

    const hasPurchaseOrderRequirement = await columnExists(
      pool,
      'pty',
      'clients',
      'purchase_order_requirement',
    );
    if (!hasPurchaseOrderRequirement) {
      await applySqlFile(pool, '0071_operational_authority_gates.sql');
    }

    const hasLegalEntities = await tableExists(pool, 'pty.legal_entities');
    if (!hasLegalEntities) {
      await applySqlFile(pool, '0072_legal_establishment_master.sql');
    }

    const hasRecurringBillingSchedules = await tableExists(pool, 'bil.recurring_billing_schedules');
    if (!hasRecurringBillingSchedules) {
      await applySqlFile(pool, '0073_recurring_billing_schedule.sql');
    }

    const hasOnePublishedIndex = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_class c
         INNER JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'authorization'
           AND c.relname = 'approval_matrix_versions_one_published_uidx'
       ) AS exists`,
    );
    if (!hasOnePublishedIndex.rows[0]?.exists) {
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS approval_matrix_versions_one_published_uidx
        ON "authorization".approval_matrix_versions (matrix_id)
        WHERE status = 'PUBLISHED'
      `);
    }

    const hasAccessRoles = await tableExists(pool, '"authorization".access_roles');
    if (!hasAccessRoles) {
      await applySqlFile(pool, '0074_access_administration.sql');
    }

    const hasJournalEntryNumber = await columnExists(pool, 'acc', 'journal_entries', 'entry_number');
    if (!hasJournalEntryNumber) {
      await applySqlFile(pool, '0075_accounting_entry_number.sql');
    }

    const hasDeadlineKernel = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_proc p
         INNER JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'so'
           AND p.proname = 'deadline_for'
       ) AS exists`,
    );
    if (!hasDeadlineKernel.rows[0]?.exists) {
      await applySqlFile(pool, '0076_deadline_kernel.sql');
    }

    const hasWorkforceIdentity = await columnExists(pool, 'wrk', 'workforce_members', 'identity_id');
    if (!hasWorkforceIdentity) {
      await applySqlFile(pool, '0077_workforce_member_identity.sql');
    }

    const hasAllocationWorkforceMember = await columnExists(
      pool,
      'res',
      'resource_allocations',
      'workforce_member_id',
    );
    if (!hasAllocationWorkforceMember) {
      await applySqlFile(pool, '0078_workforce_member_allocation.sql');
    }

    const hasClientsListIndex = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'clients_legal_name_id_idx') AS exists`,
    );
    if (!hasClientsListIndex.rows[0]?.exists) {
      await applySqlFile(pool, '0079_clients_list_indexes.sql');
    }

    await syncDrizzleJournal(pool);
  } finally {
    await pool.end();
  }
}

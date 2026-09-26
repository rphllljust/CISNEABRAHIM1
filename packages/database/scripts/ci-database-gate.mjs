import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';
import { listMigrationSqlFiles, MIGRATIONS_DIR } from './migration-files.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const envPath = resolve(repoRoot, '.env');
const envExamplePath = resolve(repoRoot, '.env.example');

if (existsSync(envPath)) {
  config({ path: envPath });
} else {
  config({ path: envExamplePath });
}

const MIGRATION_FILES = listMigrationSqlFiles();

const INCREMENTAL_BASELINE_FILES = MIGRATION_FILES.slice(0, -1);
const INCREMENTAL_DELTA_FILE = MIGRATION_FILES.at(-1);

const EXPECTED_SCHEMAS = [
  'infrastructure',
  'identity',
  'authorization',
  'audit',
  'pty',
  'cat',
  'ast',
  'doc',
  'com',
  'sr',
  'so',
  'res',
  'msr',
  'bil',
  'evt',
  'plt',
  'int',
  'ntf',
  'alt',
  'wrk',
  'rpt',
  'fin',
  'acc',
  'fis',
  'inv',
  'pay',
];

const EXPECTED_TABLES = [
  'infrastructure.schema_baseline',
  'identity.identities',
  'authorization.grants',
  'authorization.approval_matrices',
  'authorization.approval_matrix_versions',
  'authorization.approval_matrix_rules',
  'authorization.approval_role_assignments',
  'audit.security_audit_events',
  'pty.clients',
  'pty.suppliers',
  'pty.supplier_contacts',
  'pty.supplier_addresses',
  'pty.supplier_history_events',
  'cat.service_definitions',
  'cat.service_definition_versions',
  'ast.physical_assets',
  'doc.documents',
  'com.proposals',
  'com.purchase_orders',
  'sr.service_requests',
  'so.service_orders',
  'so.planned_resources',
  'res.resource_allocations',
  'so.execution_entries',
  'so.operational_cost_entries',
  'msr.measurements',
  'bil.billing_records',
  'bil.billing_documents',
  'evt.domain_events',
  'evt.notification_intents',
  'plt.background_jobs',
  'evt.outbox_events',
  'int.integration_inbox',
  'int.integration_inbox_effects',
  'ntf.notifications',
  'ntf.delivery_attempts',
  'alt.business_alerts',
  'wrk.workforce_members',
  'rpt.report_exports',
  'com.purchase_order_consumption_entries',
  'fin.receivables',
  'fin.receivable_installments',
  'fin.settlements',
  'fin.expense_categories',
  'fin.payables',
  'fin.expenses',
  'fin.expense_items',
  'fin.expense_approvals',
  'fin.expense_reimbursements',
  'fin.receivable_collections',
  'fin.collection_actions',
  'fin.collection_promises',
  'fin.collection_history',
  'fin.payable_installments',
  'fin.payments',
  'fin.financial_accounts',
  'fin.bank_accounts',
  'fin.cash_accounts',
  'fin.treasury_transfers',
  'fin.financial_transactions',
  'acc.charts_of_accounts',
  'acc.accounting_accounts',
  'acc.accounting_periods',
  'acc.journal_entries',
  'acc.journal_entry_lines',
  'acc.accounting_posting_rules',
  'acc.accounting_posting_rule_versions',
  'acc.accounting_posting_requests',
  'fis.fiscal_documents',
  'fis.fiscal_document_items',
  'fis.fiscal_party_snapshots',
  'fis.fiscal_tax_details',
  'fis.fiscal_events',
  'fis.fiscal_authorizations',
  'fis.tax_rules',
  'fis.tax_rule_versions',
  'fis.tax_contexts',
  'fis.tax_calculations',
  'fis.tax_calculation_lines',
  'fis.tax_assessments',
  'fis.tax_obligations',
  'fis.tax_assessment_events',
  'fis.fiscal_periods',
  'fis.fiscal_period_close_runs',
  'fis.fiscal_period_close_check_results',
  'inv.warehouses',
  'inv.inventory_items',
  'inv.stock_reservations',
  'inv.stock_movements',
  'inv.stock_position_locks',
  'inv.costing_rules',
  'inv.costing_rule_versions',
  'pay.employment_contracts',
  'pay.payroll_periods',
  'pay.payroll_events',
  'pay.payroll_calculations',
  'pay.payroll_results',
  'fin.bank_statements',
  'fin.bank_statement_lines',
  'fin.bank_statement_imports',
  'fin.reconciliations',
  'fin.reconciliation_matches',
  'acc.period_close_policies',
  'acc.period_close_runs',
  'acc.period_close_check_results',
  'acc.fixed_asset_registers',
  'acc.fixed_asset_movements',
  'fin.budgets',
  'fin.budget_versions',
  'fin.budget_periods',
  'fin.budget_lines',
  'prc.purchase_requests',
  'prc.purchase_request_lines',
  'prc.purchase_request_approvals',
  'prc.supplier_purchase_orders',
  'prc.supplier_purchase_order_lines',
  'prc.goods_receipts',
  'prc.goods_receipt_lines',
  'prc.supplier_invoices',
  'prc.three_way_matches',
];

const EXPECTED_READ_CONTRACTS = [
  'rpt.read_clients',
  'rpt.read_client_addresses',
  'rpt.read_proposals',
  'rpt.read_proposal_versions',
  'rpt.read_purchase_orders',
  'rpt.read_service_definitions',
  'rpt.read_service_definition_versions',
  'rpt.read_service_requests',
  'rpt.read_service_orders',
  'rpt.read_planned_resources',
  'rpt.read_execution_entries',
  'rpt.read_execution_evidence',
  'rpt.read_operational_cost_entries',
  'rpt.read_resource_allocations',
  'rpt.read_physical_assets',
  'rpt.read_vehicle_profiles',
  'rpt.read_measurements',
  'rpt.read_measurement_items',
  'rpt.read_billing_records',
  'rpt.read_billing_documents',
  'rpt.read_documents',
  'rpt.read_document_versions',
  'rpt.read_stored_objects',
  'rpt.read_receivables',
  'rpt.read_receivable_installments',
  'rpt.read_settlements',
  'rpt.read_expense_categories',
  'rpt.read_payables',
  'rpt.read_payable_installments',
  'rpt.read_payments',
  'rpt.read_financial_accounts',
  'rpt.read_bank_accounts',
  'rpt.read_cash_accounts',
  'rpt.read_treasury_transfers',
  'rpt.read_financial_transactions',
  'rpt.read_charts_of_accounts',
  'rpt.read_accounting_accounts',
  'rpt.read_accounting_periods',
  'rpt.read_journal_entries',
  'rpt.read_journal_entry_lines',
  'rpt.read_posted_journal_lines',
  'rpt.read_fiscal_documents',
  'rpt.read_fiscal_document_items',
  'rpt.read_fiscal_party_snapshots',
  'rpt.read_fiscal_tax_details',
  'rpt.read_fiscal_events',
  'rpt.read_fiscal_authorizations',
  'rpt.read_tax_rules',
  'rpt.read_tax_rule_versions',
  'rpt.read_tax_contexts',
  'rpt.read_tax_calculations',
  'rpt.read_tax_calculation_lines',
  'rpt.read_tax_assessments',
  'rpt.read_tax_obligations',
  'rpt.read_tax_assessment_events',
  'rpt.read_fiscal_periods',
  'rpt.read_fiscal_period_close_runs',
  'rpt.read_fiscal_period_close_check_results',
  'rpt.read_warehouses',
  'rpt.read_inventory_items',
  'rpt.read_stock_movements',
  'rpt.read_stock_reservations',
  'rpt.read_stock_balances',
  'rpt.read_employment_contracts',
  'rpt.read_payroll_periods',
  'rpt.read_payroll_events',
  'rpt.read_payroll_calculations',
  'rpt.read_payroll_results',
  'rpt.read_bank_statements',
  'rpt.read_bank_statement_lines',
  'rpt.read_bank_statement_imports',
  'rpt.read_reconciliations',
  'rpt.read_reconciliation_matches',
  'rpt.read_period_close_policies',
  'rpt.read_period_close_runs',
  'rpt.read_period_close_check_results',
  'rpt.read_fixed_asset_registers',
  'rpt.read_fixed_asset_movements',
  'rpt.read_budgets',
  'rpt.read_budget_versions',
  'rpt.read_budget_periods',
  'rpt.read_budget_lines',
  'rpt.read_suppliers',
  'rpt.read_supplier_contacts',
  'rpt.read_supplier_addresses',
  'rpt.read_supplier_history_events',
  'rpt.read_purchase_requests',
  'rpt.read_purchase_request_lines',
  'rpt.read_supplier_purchase_orders',
  'rpt.read_supplier_purchase_order_lines',
  'rpt.read_goods_receipts',
  'rpt.read_supplier_invoices',
  'rpt.read_three_way_matches',
  'rpt.read_approval_matrices',
  'rpt.read_approval_matrix_rules',
  'rpt.read_expenses',
  'rpt.read_expense_items',
  'rpt.read_expense_approvals',
  'rpt.read_expense_reimbursements',
  'rpt.read_receivable_collections',
  'rpt.read_collection_actions',
  'rpt.read_collection_promises',
  'rpt.read_collection_history',
];

function adminConnectionString() {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is required for ci-database-gate.');
  }
  return url;
}

function quoteIdent(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function withAdminClient(run) {
  const client = new pg.Client({ connectionString: adminConnectionString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function databaseExists(client, databaseName) {
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  return result.rowCount > 0;
}

async function recreateDatabase(client, databaseName) {
  await client.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1
       AND pid <> pg_backend_pid()`,
    [databaseName],
  );

  if (await databaseExists(client, databaseName)) {
    await client.query(`DROP DATABASE ${quoteIdent(databaseName)}`);
  }

  await client.query(`CREATE DATABASE ${quoteIdent(databaseName)}`);
}

function databaseUrlForName(databaseName) {
  const parsed = new URL(adminConnectionString());
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function applySqlFile(client, relativePath) {
  const filePath = resolve(MIGRATIONS_DIR, relativePath);
  const sql = readFileSync(filePath, 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await client.query(statement);
  }
}

async function applyMigrations(connectionString, files) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const file of files) {
      await applySqlFile(client, file);
    }
  } finally {
    await client.end();
  }
}

async function assertExpectedSchema(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const schemas = await client.query(
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name = ANY($1::text[])
       ORDER BY schema_name`,
      [EXPECTED_SCHEMAS],
    );
    const foundSchemas = schemas.rows.map((row) => row.schema_name);
    if (foundSchemas.length !== EXPECTED_SCHEMAS.length) {
      throw new Error(
        `Expected schemas ${EXPECTED_SCHEMAS.join(', ')}; found ${foundSchemas.join(', ')}`,
      );
    }

    for (const qualifiedTable of EXPECTED_TABLES) {
      const result = await client.query('SELECT to_regclass($1) AS regclass', [qualifiedTable]);
      if (!result.rows[0]?.regclass) {
        throw new Error(`Expected table missing: ${qualifiedTable}`);
      }
    }

    for (const qualifiedView of EXPECTED_READ_CONTRACTS) {
      const result = await client.query('SELECT to_regclass($1) AS regclass', [qualifiedView]);
      if (!result.rows[0]?.regclass) {
        throw new Error(`Expected read contract missing: ${qualifiedView}`);
      }
    }

    const baseline = await client.query(
      `SELECT baseline_version
       FROM infrastructure.schema_baseline
       ORDER BY id
       LIMIT 1`,
    );
    if (!baseline.rows[0]?.baseline_version) {
      throw new Error('Technical schema baseline seed missing in infrastructure.schema_baseline');
    }
  } finally {
    await client.end();
  }
}

async function assertConstraints(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const actorId = randomUUID();
    const definitionId = randomUUID();
    const passwordHash = '$2b$12$ci.gate.actor.hash.placeholder.abcdefghijklmnopqrstuvwxyz012345';

    await client.query(`INSERT INTO identity.identities (id, status) VALUES ($1, 'active')`, [
      actorId,
    ]);
    await client.query(
      `INSERT INTO identity.credentials (
         id, identity_id, login_identifier_normalized, password_hash
       ) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), actorId, `ci-gate-${randomUUID()}@test.local`, passwordHash],
    );

    await client.query(
      `INSERT INTO cat.service_definitions (
         id, code, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, 'CI-GATE-DEF', $2, $2)`,
      [definitionId, actorId],
    );

    await client
      .query(
        `INSERT INTO cat.service_definitions (
           id, code, created_by_identity_id, updated_by_identity_id
         ) VALUES ($1, 'CI-GATE-DEF', $2, $2)`,
        [randomUUID(), actorId],
      )
      .then(() => {
        throw new Error('Expected duplicate service_definitions.code to violate unique constraint');
      })
      .catch((error) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
          return;
        }
        throw error;
      });
  } finally {
    await client.end();
  }
}

async function assertPreDeltaState(connectionString, deltaFile) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    if (deltaFile === '0007_service_catalog_baseline.sql') {
      const result = await client.query('SELECT to_regclass($1) AS regclass', [
        'cat.service_definitions',
      ]);
      if (result.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains cat.service_definitions before delta',
        );
      }
      return;
    }

    if (deltaFile === '0008_service_definitions_lineage_version.sql') {
      const catalog = await client.query('SELECT to_regclass($1) AS regclass', [
        'cat.service_definitions',
      ]);
      if (!catalog.rows[0]?.regclass) {
        throw new Error('Expected cat.service_definitions before 0008 delta');
      }
      const column = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'cat'
           AND table_name = 'service_definitions'
           AND column_name = 'version'`,
      );
      if ((column.rowCount ?? 0) > 0) {
        throw new Error(
          'Incremental baseline incorrectly contains service_definitions.version before 0008',
        );
      }
      return;
    }

    if (deltaFile === '0009_units_of_measure.sql') {
      const catalog = await client.query('SELECT to_regclass($1) AS regclass', [
        'cat.service_definitions',
      ]);
      if (!catalog.rows[0]?.regclass) {
        throw new Error('Expected cat.service_definitions before 0009 delta');
      }
      const units = await client.query('SELECT to_regclass($1) AS regclass', [
        'cat.units_of_measure',
      ]);
      if (units.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains cat.units_of_measure before 0009');
      }
      return;
    }

    if (deltaFile === '0010_physical_resource_types.sql') {
      const units = await client.query('SELECT to_regclass($1) AS regclass', [
        'cat.units_of_measure',
      ]);
      if (!units.rows[0]?.regclass) {
        throw new Error('Expected cat.units_of_measure before 0010 delta');
      }
      const resourceTypes = await client.query('SELECT to_regclass($1) AS regclass', [
        'cat.physical_resource_types',
      ]);
      if (resourceTypes.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains cat.physical_resource_types before 0010',
        );
      }
      return;
    }

    if (deltaFile === '0011_operational_labor_types.sql') {
      const resourceTypes = await client.query('SELECT to_regclass($1) AS regclass', [
        'cat.physical_resource_types',
      ]);
      if (!resourceTypes.rows[0]?.regclass) {
        throw new Error('Expected cat.physical_resource_types before 0011 delta');
      }
      const laborTypes = await client.query('SELECT to_regclass($1) AS regclass', [
        'cat.operational_labor_types',
      ]);
      if (laborTypes.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains cat.operational_labor_types before 0011',
        );
      }
      return;
    }

    if (deltaFile === '0012_commercial_pricing_measurement.sql') {
      const laborTypes = await client.query('SELECT to_regclass($1) AS regclass', [
        'cat.operational_labor_types',
      ]);
      if (!laborTypes.rows[0]?.regclass) {
        throw new Error('Expected cat.operational_labor_types before 0012 delta');
      }
      const measurementBasis = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'cat'
           AND table_name = 'service_definition_versions'
           AND column_name = 'measurement_basis'
         LIMIT 1`,
      );
      if ((measurementBasis.rowCount ?? 0) > 0) {
        throw new Error(
          'Incremental baseline incorrectly contains measurement_basis before 0012',
        );
      }
      return;
    }

    if (deltaFile === '0013_execution_requirements.sql') {
      const measurementBasis = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'cat'
           AND table_name = 'service_definition_versions'
           AND column_name = 'measurement_basis'
         LIMIT 1`,
      );
      if ((measurementBasis.rowCount ?? 0) === 0) {
        throw new Error('Expected measurement_basis before 0013 delta');
      }
      const enumValues = await client.query(
        `SELECT e.enumlabel
         FROM pg_type t
         INNER JOIN pg_enum e ON e.enumtypid = t.oid
         INNER JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'cat'
           AND t.typname = 'evidence_kind'
           AND e.enumlabel = 'OBSERVATION'`,
      );
      if ((enumValues.rowCount ?? 0) > 0) {
        throw new Error('Incremental baseline incorrectly contains OBSERVATION evidence_kind before 0013');
      }
      return;
    }

    if (deltaFile === '0028_transactional_outbox.sql') {
      const backgroundJobs = await client.query('SELECT to_regclass($1) AS regclass', [
        'plt.background_jobs',
      ]);
      if (!backgroundJobs.rows[0]?.regclass) {
        throw new Error('Expected plt.background_jobs before 0028 delta');
      }
      const outboxEvents = await client.query('SELECT to_regclass($1) AS regclass', [
        'evt.outbox_events',
      ]);
      if (outboxEvents.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains evt.outbox_events before 0028');
      }
      return;
    }

    if (deltaFile === '0029_integration_inbox.sql') {
      const outboxEvents = await client.query('SELECT to_regclass($1) AS regclass', [
        'evt.outbox_events',
      ]);
      if (!outboxEvents.rows[0]?.regclass) {
        throw new Error('Expected evt.outbox_events before 0029 delta');
      }
      const integrationInbox = await client.query('SELECT to_regclass($1) AS regclass', [
        'int.integration_inbox',
      ]);
      if (integrationInbox.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains int.integration_inbox before 0029');
      }
      return;
    }

    if (deltaFile === '0027_background_jobs.sql') {
      const domainEvents = await client.query('SELECT to_regclass($1) AS regclass', [
        'evt.domain_events',
      ]);
      if (!domainEvents.rows[0]?.regclass) {
        throw new Error('Expected evt.domain_events before 0027 delta');
      }
      const backgroundJobs = await client.query('SELECT to_regclass($1) AS regclass', [
        'plt.background_jobs',
      ]);
      if (backgroundJobs.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains plt.background_jobs before 0027');
      }
      return;
    }

    if (deltaFile === '0026_domain_events_notifications.sql') {
      const billingDocuments = await client.query('SELECT to_regclass($1) AS regclass', [
        'bil.billing_documents',
      ]);
      if (!billingDocuments.rows[0]?.regclass) {
        throw new Error('Expected bil.billing_documents before 0026 delta');
      }
      const domainEvents = await client.query('SELECT to_regclass($1) AS regclass', [
        'evt.domain_events',
      ]);
      if (domainEvents.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains evt.domain_events before 0026');
      }
      return;
    }

    if (deltaFile === '0025_billing_documents.sql') {
      const billingRecords = await client.query('SELECT to_regclass($1) AS regclass', [
        'bil.billing_records',
      ]);
      if (!billingRecords.rows[0]?.regclass) {
        throw new Error('Expected bil.billing_records before 0025 delta');
      }
      const billingDocuments = await client.query('SELECT to_regclass($1) AS regclass', [
        'bil.billing_documents',
      ]);
      if (billingDocuments.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains bil.billing_documents before 0025');
      }
      return;
    }

    if (deltaFile === '0037_purchase_order_balance.sql') {
      const purchaseOrders = await client.query('SELECT to_regclass($1) AS regclass', [
        'com.purchase_orders',
      ]);
      if (!purchaseOrders.rows[0]?.regclass) {
        throw new Error('Expected com.purchase_orders before 0037 delta');
      }
      const billingRecords = await client.query('SELECT to_regclass($1) AS regclass', [
        'bil.billing_records',
      ]);
      if (!billingRecords.rows[0]?.regclass) {
        throw new Error('Expected bil.billing_records before 0037 delta');
      }
      const consumption = await client.query('SELECT to_regclass($1) AS regclass', [
        'com.purchase_order_consumption_entries',
      ]);
      if (consumption.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains com.purchase_order_consumption_entries before 0037',
        );
      }
      return;
    }

    if (deltaFile === '0043_cross_context_read_contracts.sql') {
      const operations = await client.query('SELECT to_regclass($1) AS regclass', [
        'so.operational_cost_entries',
      ]);
      if (!operations.rows[0]?.regclass) {
        throw new Error('Expected so.operational_cost_entries before 0043 delta');
      }
      const readContract = await client.query('SELECT to_regclass($1) AS regclass', [
        'rpt.read_service_orders',
      ]);
      if (readContract.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains rpt.read_service_orders before 0043',
        );
      }
      return;
    }

    if (deltaFile === '0044_finance_receivables.sql') {
      const billingDocuments = await client.query('SELECT to_regclass($1) AS regclass', [
        'bil.billing_documents',
      ]);
      if (!billingDocuments.rows[0]?.regclass) {
        throw new Error('Expected bil.billing_documents before 0044 delta');
      }
      const receivables = await client.query('SELECT to_regclass($1) AS regclass', [
        'fin.receivables',
      ]);
      if (receivables.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains fin.receivables before 0044');
      }
      return;
    }

    if (deltaFile === '0045_finance_payables.sql') {
      const receivables = await client.query('SELECT to_regclass($1) AS regclass', [
        'fin.receivables',
      ]);
      if (!receivables.rows[0]?.regclass) {
        throw new Error('Expected fin.receivables before 0045 delta');
      }
      const payables = await client.query('SELECT to_regclass($1) AS regclass', ['fin.payables']);
      if (payables.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains fin.payables before 0045');
      }
      return;
    }

    if (deltaFile === '0046_finance_treasury.sql') {
      const payables = await client.query('SELECT to_regclass($1) AS regclass', ['fin.payables']);
      if (!payables.rows[0]?.regclass) {
        throw new Error('Expected fin.payables before 0046 delta');
      }
      const accounts = await client.query('SELECT to_regclass($1) AS regclass', [
        'fin.financial_accounts',
      ]);
      if (accounts.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains fin.financial_accounts before 0046');
      }
      return;
    }

    if (deltaFile === '0047_accounting_ledger.sql') {
      const accounts = await client.query('SELECT to_regclass($1) AS regclass', [
        'fin.financial_accounts',
      ]);
      if (!accounts.rows[0]?.regclass) {
        throw new Error('Expected fin.financial_accounts before 0047 delta');
      }
      const charts = await client.query('SELECT to_regclass($1) AS regclass', [
        'acc.charts_of_accounts',
      ]);
      if (charts.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains acc.charts_of_accounts before 0047');
      }
      return;
    }

    if (deltaFile === '0048_accounting_reporting.sql') {
      const journals = await client.query('SELECT to_regclass($1) AS regclass', [
        'acc.journal_entries',
      ]);
      if (!journals.rows[0]?.regclass) {
        throw new Error('Expected acc.journal_entries before 0048 delta');
      }
      const postedLines = await client.query('SELECT to_regclass($1) AS regclass', [
        'acc.posted_journal_lines',
      ]);
      if (postedLines.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains acc.posted_journal_lines before 0048');
      }
      return;
    }

    if (deltaFile === '0049_fiscal_core.sql') {
      const postedLines = await client.query('SELECT to_regclass($1) AS regclass', [
        'acc.posted_journal_lines',
      ]);
      if (!postedLines.rows[0]?.regclass) {
        throw new Error('Expected acc.posted_journal_lines before 0049 delta');
      }
      const documents = await client.query('SELECT to_regclass($1) AS regclass', [
        'fis.fiscal_documents',
      ]);
      if (documents.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains fis.fiscal_documents before 0049');
      }
      return;
    }

    if (deltaFile === '0050_tax_engine.sql') {
      const documents = await client.query('SELECT to_regclass($1) AS regclass', [
        'fis.fiscal_documents',
      ]);
      if (!documents.rows[0]?.regclass) {
        throw new Error('Expected fis.fiscal_documents before 0050 delta');
      }
      const taxRules = await client.query('SELECT to_regclass($1) AS regclass', [
        'fis.tax_rules',
      ]);
      if (taxRules.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains fis.tax_rules before 0050');
      }
      return;
    }

    if (deltaFile === '0051_inventory_core.sql') {
      const taxRules = await client.query('SELECT to_regclass($1) AS regclass', [
        'fis.tax_rules',
      ]);
      if (!taxRules.rows[0]?.regclass) {
        throw new Error('Expected fis.tax_rules before 0051 delta');
      }
      const items = await client.query('SELECT to_regclass($1) AS regclass', [
        'inv.inventory_items',
      ]);
      if (items.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains inv.inventory_items before 0051');
      }
      return;
    }

    if (deltaFile === '0052_payroll_foundation.sql') {
      const items = await client.query('SELECT to_regclass($1) AS regclass', [
        'inv.inventory_items',
      ]);
      if (!items.rows[0]?.regclass) {
        throw new Error('Expected inv.inventory_items before 0052 delta');
      }
      const contracts = await client.query('SELECT to_regclass($1) AS regclass', [
        'pay.employment_contracts',
      ]);
      if (contracts.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains pay.employment_contracts before 0052',
        );
      }
      return;
    }

    if (deltaFile === '0053_bank_reconciliation.sql') {
      const contracts = await client.query('SELECT to_regclass($1) AS regclass', [
        'pay.employment_contracts',
      ]);
      if (!contracts.rows[0]?.regclass) {
        throw new Error('Expected pay.employment_contracts before 0053 delta');
      }
      const statements = await client.query('SELECT to_regclass($1) AS regclass', [
        'fin.bank_statements',
      ]);
      if (statements.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains fin.bank_statements before 0053');
      }
      return;
    }

    if (deltaFile === '0054_accounting_posting.sql') {
      const statements = await client.query('SELECT to_regclass($1) AS regclass', [
        'fin.bank_statements',
      ]);
      if (!statements.rows[0]?.regclass) {
        throw new Error('Expected fin.bank_statements before 0054 delta');
      }
      const rules = await client.query('SELECT to_regclass($1) AS regclass', [
        'acc.accounting_posting_rules',
      ]);
      if (rules.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains acc.accounting_posting_rules before 0054',
        );
      }
      return;
    }

    if (deltaFile === '0055_fiscal_accounting_events.sql') {
      const rules = await client.query('SELECT to_regclass($1) AS regclass', [
        'acc.accounting_posting_rules',
      ]);
      if (!rules.rows[0]?.regclass) {
        throw new Error('Expected acc.accounting_posting_rules before 0055 delta');
      }
      const extraEvent = await client.query(
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
      if (extraEvent.rows[0]?.exists) {
        throw new Error(
          'Incremental baseline incorrectly contains TAX_CALCULATION_CONFIRMED before 0055',
        );
      }
      return;
    }

    if (deltaFile === '0056_inventory_costing.sql') {
      const items = await client.query('SELECT to_regclass($1) AS regclass', [
        'inv.inventory_items',
      ]);
      if (!items.rows[0]?.regclass) {
        throw new Error('Expected inv.inventory_items before 0056 delta');
      }
      const costing = await client.query('SELECT to_regclass($1) AS regclass', [
        'inv.costing_rules',
      ]);
      if (costing.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains inv.costing_rules before 0056',
        );
      }
      return;
    }

    if (deltaFile === '0057_payroll_accounting_events.sql') {
      const costing = await client.query('SELECT to_regclass($1) AS regclass', [
        'inv.costing_rules',
      ]);
      if (!costing.rows[0]?.regclass) {
        throw new Error('Expected inv.costing_rules before 0057 delta');
      }
      const extraEvent = await client.query(
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
      if (extraEvent.rows[0]?.exists) {
        throw new Error(
          'Incremental baseline incorrectly contains PAYROLL_REOPENED before 0057',
        );
      }
      return;
    }

    if (deltaFile === '0058_bank_statement_import.sql') {
      const statements = await client.query('SELECT to_regclass($1) AS regclass', [
        'fin.bank_statements',
      ]);
      if (!statements.rows[0]?.regclass) {
        throw new Error('Expected fin.bank_statements before 0058 delta');
      }
      const imports = await client.query('SELECT to_regclass($1) AS regclass', [
        'fin.bank_statement_imports',
      ]);
      if (imports.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains fin.bank_statement_imports before 0058',
        );
      }
      return;
    }

    if (deltaFile === '0059_period_close_controls.sql') {
      const imports = await client.query('SELECT to_regclass($1) AS regclass', [
        'fin.bank_statement_imports',
      ]);
      if (!imports.rows[0]?.regclass) {
        throw new Error('Expected fin.bank_statement_imports before 0059 delta');
      }
      const policies = await client.query('SELECT to_regclass($1) AS regclass', [
        'acc.period_close_policies',
      ]);
      if (policies.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains acc.period_close_policies before 0059',
        );
      }
      return;
    }

    if (deltaFile === '0060_tax_assessment_obligation.sql') {
      const policies = await client.query('SELECT to_regclass($1) AS regclass', [
        'acc.period_close_policies',
      ]);
      if (!policies.rows[0]?.regclass) {
        throw new Error('Expected acc.period_close_policies before 0060 delta');
      }
      const assessments = await client.query('SELECT to_regclass($1) AS regclass', [
        'fis.tax_assessments',
      ]);
      if (assessments.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains fis.tax_assessments before 0060',
        );
      }
      return;
    }

    if (deltaFile === '0061_fiscal_period_close.sql') {
      const assessments = await client.query('SELECT to_regclass($1) AS regclass', [
        'fis.tax_assessments',
      ]);
      if (!assessments.rows[0]?.regclass) {
        throw new Error('Expected fis.tax_assessments before 0061 delta');
      }
      const periods = await client.query('SELECT to_regclass($1) AS regclass', [
        'fis.fiscal_periods',
      ]);
      if (periods.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains fis.fiscal_periods before 0061');
      }
      return;
    }

    if (deltaFile === '0062_fixed_asset_accounting.sql') {
      const periods = await client.query('SELECT to_regclass($1) AS regclass', [
        'fis.fiscal_periods',
      ]);
      if (!periods.rows[0]?.regclass) {
        throw new Error('Expected fis.fiscal_periods before 0062 delta');
      }
      const registers = await client.query('SELECT to_regclass($1) AS regclass', [
        'acc.fixed_asset_registers',
      ]);
      if (registers.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains acc.fixed_asset_registers before 0062',
        );
      }
      return;
    }

    if (deltaFile === '0063_budget_management.sql') {
      const registers = await client.query('SELECT to_regclass($1) AS regclass', [
        'acc.fixed_asset_registers',
      ]);
      if (!registers.rows[0]?.regclass) {
        throw new Error('Expected acc.fixed_asset_registers before 0063 delta');
      }
      const budgets = await client.query('SELECT to_regclass($1) AS regclass', ['fin.budgets']);
      if (budgets.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains fin.budgets before 0063');
      }
      return;
    }

    if (deltaFile === '0064_supplier_master.sql') {
      const budgets = await client.query('SELECT to_regclass($1) AS regclass', ['fin.budgets']);
      if (!budgets.rows[0]?.regclass) {
        throw new Error('Expected fin.budgets before 0064 delta');
      }
      const suppliers = await client.query('SELECT to_regclass($1) AS regclass', ['pty.suppliers']);
      if (suppliers.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains pty.suppliers before 0064');
      }
      return;
    }

    if (deltaFile === '0065_procurement_core.sql') {
      const suppliers = await client.query('SELECT to_regclass($1) AS regclass', ['pty.suppliers']);
      if (!suppliers.rows[0]?.regclass) {
        throw new Error('Expected pty.suppliers before 0065 delta');
      }
      const requests = await client.query('SELECT to_regclass($1) AS regclass', [
        'prc.purchase_requests',
      ]);
      if (requests.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains prc.purchase_requests before 0065',
        );
      }
      return;
    }

    if (deltaFile === '0070_receivable_collections.sql') {
      const receivables = await client.query('SELECT to_regclass($1) AS regclass', ['fin.receivables']);
      if (!receivables.rows[0]?.regclass) {
        throw new Error('Expected fin.receivables before 0070 delta');
      }
      const collections = await client.query('SELECT to_regclass($1) AS regclass', [
        'fin.receivable_collections',
      ]);
      if (collections.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains fin.receivable_collections before 0070',
        );
      }
      return;
    }

    if (deltaFile === '0069_expense_management.sql') {
      const payables = await client.query('SELECT to_regclass($1) AS regclass', ['fin.payables']);
      if (!payables.rows[0]?.regclass) {
        throw new Error('Expected fin.payables before 0069 delta');
      }
      const expenses = await client.query('SELECT to_regclass($1) AS regclass', ['fin.expenses']);
      if (expenses.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains fin.expenses before 0069');
      }
      return;
    }

    if (deltaFile === '0068_financial_approval_matrix.sql') {
      const grants = await client.query('SELECT to_regclass($1) AS regclass', ['authorization.grants']);
      if (!grants.rows[0]?.regclass) {
        throw new Error('Expected authorization.grants before 0068 delta');
      }
      const matrices = await client.query('SELECT to_regclass($1) AS regclass', [
        'authorization.approval_matrices',
      ]);
      if (matrices.rows[0]?.regclass) {
        throw new Error(
          'Incremental baseline incorrectly contains authorization.approval_matrices before 0068',
        );
      }
      return;
    }

    if (deltaFile === '0067_three_way_match.sql') {
      const invoices = await client.query('SELECT to_regclass($1) AS regclass', [
        'prc.supplier_invoices',
      ]);
      if (!invoices.rows[0]?.regclass) {
        throw new Error('Expected prc.supplier_invoices before 0067 delta');
      }
      const matches = await client.query('SELECT to_regclass($1) AS regclass', [
        'prc.three_way_matches',
      ]);
      if (matches.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains prc.three_way_matches before 0067');
      }
      return;
    }

    if (deltaFile === '0066_supplier_invoice.sql') {
      const requests = await client.query('SELECT to_regclass($1) AS regclass', [
        'prc.purchase_requests',
      ]);
      if (!requests.rows[0]?.regclass) {
        throw new Error('Expected prc.purchase_requests before 0066 delta');
      }
      const invoices = await client.query('SELECT to_regclass($1) AS regclass', [
        'prc.supplier_invoices',
      ]);
      if (invoices.rows[0]?.regclass) {
        throw new Error('Incremental baseline incorrectly contains prc.supplier_invoices before 0066');
      }
      return;
    }

    if (deltaFile === '0078_workforce_member_allocation.sql') {
      const identity = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'wrk'
           AND table_name = 'workforce_members'
           AND column_name = 'identity_id'
         LIMIT 1`,
      );
      if ((identity.rowCount ?? 0) === 0) {
        throw new Error('Expected wrk.workforce_members.identity_id before 0078 delta');
      }
      const allocation = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'res'
           AND table_name = 'resource_allocations'
           AND column_name = 'workforce_member_id'
         LIMIT 1`,
      );
      if ((allocation.rowCount ?? 0) > 0) {
        throw new Error(
          'Incremental baseline incorrectly contains res.resource_allocations.workforce_member_id before 0078',
        );
      }
      return;
    }

    throw new Error(`Unsupported incremental delta migration: ${deltaFile}`);
  } finally {
    await client.end();
  }
}

async function main() {
  const freshDb = process.env['CI_GATE_FRESH_DB'] ?? 'cisne_gate_fresh';
  const incrementalDb = process.env['CI_GATE_INCREMENTAL_DB'] ?? 'cisne_gate_incremental';

  console.log('CI database gate: fresh database migration');
  await withAdminClient(async (admin) => {
    await recreateDatabase(admin, freshDb);
    await recreateDatabase(admin, incrementalDb);
  });

  const freshUrl = databaseUrlForName(freshDb);
  await applyMigrations(freshUrl, MIGRATION_FILES);
  await assertExpectedSchema(freshUrl);
  await assertConstraints(freshUrl);
  console.log('  PASS — fresh database migrated and schema validated');

  console.log('CI database gate: incremental migration (N-1 → N)');
  const incrementalUrl = databaseUrlForName(incrementalDb);
  await applyMigrations(incrementalUrl, INCREMENTAL_BASELINE_FILES);
  await assertPreDeltaState(incrementalUrl, INCREMENTAL_DELTA_FILE);
  await applyMigrations(incrementalUrl, [INCREMENTAL_DELTA_FILE]);
  await assertExpectedSchema(incrementalUrl);
  await assertConstraints(incrementalUrl);
  console.log('  PASS — incremental upgrade validated');

  console.log('CI database gate: PASS');
}

main().catch((error) => {
  console.error('CI database gate: FAIL');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

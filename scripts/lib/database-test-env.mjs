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
 * effect that is cheap to verify — a relation, a column, an enum label, an index,
 * a function or (for seed-only migrations) a deterministic seeded row. This is a
 * curated registry rather than a generated one: each probe must prove an effect
 * that the migration itself owns, never merely an artefact created by an earlier tag.
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
  '0083_supplier_archived_status_and_columns': { column: ['pty', 'suppliers', 'archive_reason'] },
  '0084_metadata_store': { table: 'meta.permissions' },
  '0085_metadata_seed_entities': { row: ['meta', 'entities', 'name', 'billing-records'] },
  '0086_metadata_seed_finance': { row: ['meta', 'entities', 'name', 'cash-forecast'] },
  '0087_metadata_v2': { table: 'meta.computed_fields' },
  '0088_metadata_views_v4': { row: ['meta', 'views', 'view_type', 'graph'] },
  /*
   * SEEDS DE METADADO (0089–0093) — o artefacto é a LINHA em `meta.entities`.
   *
   * O seed não cria tabela, coluna, índice nem enum: ele REGISTRA no metadata store uma entidade
   * que já existia. A linha é, portanto, o efeito observável — e o valor escolhido é o `name` da
   * entidade criada por aquele arquivo, não um campo qualquer dele.
   *
   * Sem estas provas o reconciliador não tinha como justificar o hash: os tags ficavam
   * deliberadamente NÃO registrados (o migrator então reexecuta a migration, que é idempotente por
   * ON CONFLICT — comportamento correto e por isso silencioso) e o gate `pnpm lint` falhava em toda
   * branch. A prova fecha a lacuna pelo caminho previsto, sem afrouxar a regra.
   */
  '0089_metadata_seed_client': { row: ['meta', 'entities', 'name', 'client'] },
  '0090_metadata_seed_service_request': { row: ['meta', 'entities', 'name', 'service-request'] },
  '0091_metadata_seed_proposal': { row: ['meta', 'entities', 'name', 'proposal'] },
  '0092_metadata_seed_purchase_order': { row: ['meta', 'entities', 'name', 'purchase-order'] },
  '0093_metadata_seed_contract': { row: ['meta', 'entities', 'name', 'contract'] },
  /*
   * 0094 não registra entidade: ela LIGA flags de filtro em campos de uma entidade já semeada. O
   * efeito observável é a FLAG, então a prova é a coluna `in_filter` de um campo nomeado —
   * `table`/`row` não descreveriam este efeito, e uma prova frouxa deixaria o hash ser registrado
   * sem que o recorte composto existisse de fato.
   */
  '0094_metadata_receivable_compound_filter': {
    fieldFlag: ['meta', 'fields', 'receivables', 'external_reference', 'in_filter'],
  },
  '0095_metadata_payable_compound_filter': {
    fieldFlag: ['meta', 'fields', 'payables', 'external_reference', 'in_filter'],
  },
  '0096_metadata_budget_compound_filter': {
    fieldFlag: ['meta', 'fields', 'budgets', 'code', 'in_filter'],
  },
  '0097_client_customer_360': { table: 'pty.client_units' },
  '0098_metadata_seed_customer_360': {
    fieldFlag: ['meta', 'fields', 'client', 'group_name', 'in_list'],
  },
  '0099_customer_purchase_order_number': {
    column: ['so', 'service_orders', 'customer_purchase_order_number'],
  },
  '0100_customer_item_reference': {
    column: ['com', 'proposal_items', 'customer_item_reference'],
  },
  '0101_proposal_contact': { column: ['com', 'proposals', 'contact_id'] },
  /*
   * 0102 nao cria coluna nem tabela: reescreve o `layout` da view `list` de `service-orders`
   * no metadata store. A sonda verifica o efeito REAL — a flag `in_list` do campo `origin`,
   * que continua publicado na lista depois da poda de colunas.
   */
  '0102_service_order_worklist_columns': {
    fieldFlag: ['meta', 'fields', 'service-orders', 'origin', 'in_list'],
  },
  /*
   * 0103 cria a tabela `plt.saved_views` — a persistência corporativa de Saved Views, que
   * substitui o `localStorage` como fonte e é o que torna `scope: ROLE` realmente publicado.
   * A sonda é a TABELA: a migration cria o artefato inteiro, e a existência dele responde
   * exatamente pelo efeito. Prouvar só uma coluna deixaria a tabela ausente passar como aplicada.
   */
  '0103_saved_views': { table: ['plt', 'saved_views'] },
  /*
   * F1.1 — 0104 cria o ledger do FATO econômico. A sonda é a TABELA `fin.economic_events`:
   * a migration cria o artefato inteiro (tabela, índice único de deduplicação
   * `(event_kind, source_id)` e as views de contrato publicado), e a existência da tabela
   * responde pelo efeito que a migração promete. ProvR só uma coluna deixaria a tabela
   * ausente passar como aplicada.
   */
  '0104_economic_events': { table: ['fin', 'economic_events'] },
  /*
   * F1.2 — 0105 sobe o ledger para a PLATAFORMA. O fato econômico é vocabulário comum a
   * FINANCE/FISCAL/INVENTORY/PAYROLL/ASSETS: em `fin.*` obrigaria os outros domínios a ler
   * o schema de FINANCE, o que a regra de fronteira proíbe.
   *
   * A sonda é a COLUNA `reverses_source_id` — e não apenas a tabela — porque o efeito
   * distintivo da 0105 é promover o vínculo de ESTORNO a vínculo indexado. Uma tabela
   * vazia criada sem essa coluna passaria como "aplicada" sem entregar o contrato.
   */
  '0105_platform_economic_events': {
    column: ['plt', 'economic_events', 'reverses_source_id'],
  },
  /*
   * F1.2 — 0106 recria os contratos publicados de FINANCE com paridade de colunas.
   *
   * A sonda é `rpt.read_settlements.reversed_at`: é exatamente a coluna que faltava quando
   * 0080/0081 adicionaram as colunas de estorno às tabelas de origem sem recriar a view.
   * Sondar a existência da view não provaria nada — ela já existia no estado quebrado.
   */
  '0106_published_read_contracts_refresh': {
    column: ['rpt', 'read_settlements', 'reversed_at'],
  },
  /*
   * DISPATCH + EXECUTION + ACTUALS — 0107 abre a vertical operacional completa.
   *
   * A sonda é `so.execution_actuals` porque é a tabela que NÃO existia de forma
   * alguma antes desta migration: sem ela não há REALIZADO, e sem realizado não há
   * custo real nem variação. As demais tabelas da 0107 (despacho, medidores,
   * combustível, assinatura, eventos, fechamento, base de medição) dependem desta
   * para produzir consequência — um realizado que não existe torna a conclusão
   * impossível e a medição vazia.
   *
   * Sondar `so.service_order_dispatches` provaria menos: a prontidão e o comando de
   * despacho só geram efeito real porque o realizado é capturável depois deles.
   */
  '0107_dispatch_execution_actuals': { table: ['so', 'execution_actuals'] },
  /*
   * MEASUREMENT → ACCEPTANCE → BILLING READINESS — 0108 completa a cadeia.
   *
   * A sonda é `msr.customer_acceptances` porque é a tabela que expressa a
   * MUDANÇA DE NATUREZA desta migration: o aceite deixou de ser função pura
   * (`service-acceptance.ts`) e passou a ser FATO persistido com política,
   * ciclo, motivo de recusa e idempotência.
   *
   * As demais tabelas da 0108 (variações, elegibilidade, lacuna de receita)
   * dependem desta para produzir consequência: sem decisão de aceite registrada
   * a elegibilidade nunca sai de PENDING, e a lacuna de receita nunca reporta
   * `APPROVED_NOT_ACCEPTED` — ela mostraria tudo como bloqueio interno.
   *
   * Sondar `msr.measurement_variances` provaria só a re-formatação da comparação;
   * sondar a aceitação prova o controle comercial que a capability entrega.
   */
  '0108_measurement_acceptance_billing_readiness': { table: ['msr', 'customer_acceptances'] },
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
  if (check.row) {
    const [schema, table, column, value] = check.row;
    const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    const field = quoteIdentifier(column);
    const result = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM ${relation} WHERE ${field} = $1) AS exists`,
      [value],
    );
    return result.rows[0]?.exists === true;
  }
  /*
   * Flag booleana de um campo de metadado.
   *
   * Uma migration que LIGA uma capacidade (`in_filter`, `in_list`, `in_form`...) não cria artefato
   * nenhum: o efeito é o VALOR da coluna na linha daquele campo. `table` provaria só que a tabela
   * existe (criada por migration anterior) e `row` provaria só que o campo foi semeado — nenhum dos
   * dois distingue "a flag foi ligada" de "a migration nunca rodou".
   */
  if (check.fieldFlag) {
    const [schema, table, entityName, fieldName, flagColumn] = check.fieldFlag;
    const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    const result = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM ${relation} f
         INNER JOIN ${quoteIdentifier('meta')}.${quoteIdentifier('entities')} e ON e.id = f.entity_id
         WHERE e.name = $1 AND f.name = $2 AND f.${quoteIdentifier(flagColumn)} = true
       ) AS exists`,
      [entityName, fieldName],
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

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

async function tableExists(pool, table) {
  const result = await pool.query('SELECT to_regclass($1) AS regclass', [table]);
  return result.rows[0]?.regclass !== null;
}

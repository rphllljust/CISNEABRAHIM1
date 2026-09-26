import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { classifyRowVersion } from '../../infrastructure/database/optimistic-lock';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  AccountingError,
  JOURNAL_KINDS,
  JOURNAL_STATUSES,
  PERIOD_STATUSES,
  assertBalancedEntry,
  assertDraftMutable,
  assertOccurredInPeriod,
  assertPeriodOpen,
  assertPosted,
  reversalLines,
} from '../domain/ledger';
import {
  assertPeriodCloseAllowed,
  evaluatePeriodCloseChecks,
  periodCloseRunStatus,
  type PeriodCloseCheck,
  type PeriodCloseObservations,
  type PeriodClosePolicy,
} from '../domain/period-close';
import { assertAccountPostable } from '../domain/accounting-semantics';
import type {
  AccountPostability,
  AccountingAccountRow,
  AccountingJournalListItem,
  AccountingPeriodRow,
  ChartOfAccountsRow,
  ClosePeriodPersistenceInput,
  CreateAccountPersistenceInput,
  CreateChartPersistenceInput,
  CreatePeriodPersistenceInput,
  DraftJournalPersistenceInput,
  EnrichedJournalLineRow,
  JournalAggregate,
  JournalEntryLineRow,
  JournalEntryRow,
  JournalListPageInput,
  JournalListPageResult,
  LedgerMovementRow,
  PeriodCloseCheckDetailRow,
  PeriodClosePolicyRow,
  PeriodCloseRunDetailRow,
  PostedLineFactRow,
  PostJournalPersistenceInput,
  ReplaceJournalLinesPersistenceInput,
  ReopenPeriodPersistenceInput,
  ReverseJournalPersistenceInput,
} from './accounting.repository.types';

export type ClosePeriodOutcome = {
  period: AccountingPeriodRow;
  idempotent: boolean;
  runStatus: string | null;
  checks: PeriodCloseCheck[];
};

const CHART_RETURNING = `
  id, unit_id, code, name, status::text AS status, created_at, updated_at,
  created_by_identity_id, updated_by_identity_id
`;

const ACCOUNT_RETURNING = `
  id, chart_id, parent_id, code, name, class::text AS class, status::text AS status,
  created_at, updated_at, created_by_identity_id, updated_by_identity_id
`;

const PERIOD_RETURNING = `
  id, chart_id, unit_id, code, starts_on::text AS starts_on, ends_on::text AS ends_on,
  status::text AS status, closed_at, closed_by_identity_id, close_reason, reopened_at,
  reopened_by_identity_id, reopen_reason, reopen_count, row_version, created_at, updated_at,
  created_by_identity_id, updated_by_identity_id
`;

const ENTRY_RETURNING = `
  id, chart_id, period_id, unit_id, status::text AS status, kind::text AS kind, description,
  occurred_on::text AS occurred_on, currency_code, source_kind::text AS source_kind, source_id,
  source_reference, idempotency_key, reverses_entry_id, entry_number, posted_at, posted_by_identity_id,
  row_version, created_at, updated_at, created_by_identity_id, updated_by_identity_id
`;

const LINE_RETURNING = `
  id, journal_entry_id, line_number, account_id, direction::text AS direction,
  amount::text AS amount, description, created_at
`;

@Injectable()
export class AccountingRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findChartById(chartId: string): Promise<ChartOfAccountsRow | null> {
    const result = await this.pool().query<ChartOfAccountsRow>(
      `SELECT ${CHART_RETURNING} FROM acc.charts_of_accounts WHERE id = $1`,
      [chartId],
    );
    return result.rows[0] ?? null;
  }

  async findAccountById(accountId: string): Promise<AccountingAccountRow | null> {
    const result = await this.pool().query<AccountingAccountRow>(
      `SELECT ${ACCOUNT_RETURNING} FROM acc.accounting_accounts WHERE id = $1`,
      [accountId],
    );
    return result.rows[0] ?? null;
  }

  async findPeriodById(periodId: string): Promise<AccountingPeriodRow | null> {
    const result = await this.pool().query<AccountingPeriodRow>(
      `SELECT ${PERIOD_RETURNING} FROM acc.accounting_periods WHERE id = $1`,
      [periodId],
    );
    return result.rows[0] ?? null;
  }

  async findOpenPeriodContaining(chartId: string, occurredOn: string): Promise<AccountingPeriodRow | null> {
    const result = await this.pool().query<AccountingPeriodRow>(
      `SELECT ${PERIOD_RETURNING}
       FROM acc.accounting_periods
       WHERE chart_id = $1
         AND status = 'OPEN'
         AND starts_on <= $2::date
         AND ends_on >= $2::date
       ORDER BY starts_on
       LIMIT 2`,
      [chartId, occurredOn],
    );
    if (result.rows.length !== 1) {
      return null;
    }
    return result.rows[0] ?? null;
  }

  async createAndPostOnClient(
    client: PoolClient,
    input: DraftJournalPersistenceInput,
  ): Promise<JournalAggregate> {
    const draft = await this.insertDraft(client, input);
    return this.postLocked(client, {
      journalEntryId: draft.entry.id,
      rowVersion: draft.entry.row_version,
      actorIdentityId: input.actorIdentityId,
    });
  }

  async findJournalById(journalEntryId: string): Promise<JournalAggregate | null> {
    const entry = await this.pool().query<JournalEntryRow>(
      `SELECT ${ENTRY_RETURNING} FROM acc.journal_entries WHERE id = $1`,
      [journalEntryId],
    );
    if (!entry.rows[0]) {
      return null;
    }
    const lines = await this.listLines(journalEntryId);
    return { entry: entry.rows[0], lines };
  }

  async listPostedLines(chartId: string): Promise<JournalEntryLineRow[]> {
    const result = await this.pool().query<JournalEntryLineRow>(
      `SELECT l.id, l.journal_entry_id, l.line_number, l.account_id, l.direction::text AS direction,
              l.amount::text AS amount, l.description, l.created_at
       FROM acc.journal_entry_lines l
       INNER JOIN acc.journal_entries e ON e.id = l.journal_entry_id
       WHERE e.chart_id = $1 AND e.status = 'POSTED'
       ORDER BY e.posted_at, l.line_number`,
      [chartId],
    );
    return result.rows;
  }

  async listAccountsByChart(chartId: string): Promise<AccountingAccountRow[]> {
    const result = await this.pool().query<AccountingAccountRow>(
      `SELECT ${ACCOUNT_RETURNING} FROM acc.accounting_accounts WHERE chart_id = $1 ORDER BY code`,
      [chartId],
    );
    return result.rows;
  }

  async countDraftsInPeriod(periodId: string, client?: PoolClient): Promise<number> {
    const db = client ?? this.pool();
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM acc.journal_entries
       WHERE period_id = $1 AND status = 'DRAFT'`,
      [periodId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async listPostedJournalsInPeriod(periodId: string): Promise<JournalAggregate[]> {
    const entries = await this.pool().query<JournalEntryRow>(
      `SELECT ${ENTRY_RETURNING}
       FROM acc.journal_entries
       WHERE period_id = $1 AND status = 'POSTED'
       ORDER BY occurred_on, posted_at, id`,
      [periodId],
    );
    const aggregates: JournalAggregate[] = [];
    for (const entry of entries.rows) {
      aggregates.push({ entry, lines: await this.listLines(entry.id) });
    }
    return aggregates;
  }

  async listPostedLineFacts(input: {
    chartId: string;
    beforeOn?: string;
    periodId?: string;
  }): Promise<PostedLineFactRow[]> {
    const result = await this.pool().query<PostedLineFactRow>(
      `SELECT a.id AS account_id, a.code AS account_code, a.name AS account_name,
              a.class::text AS account_class, l.direction::text AS direction, l.amount::text AS amount
       FROM acc.posted_journal_lines l
       INNER JOIN acc.accounting_accounts a ON a.id = l.account_id
       WHERE l.chart_id = $1
         AND ($2::date IS NULL OR l.occurred_on < $2::date)
         AND ($3::uuid IS NULL OR l.period_id = $3::uuid)`,
      [input.chartId, input.beforeOn ?? null, input.periodId ?? null],
    );
    return result.rows;
  }

  async listLedgerMovements(periodId: string, accountId: string): Promise<LedgerMovementRow[]> {
    const result = await this.pool().query<LedgerMovementRow>(
      `SELECT l.journal_entry_id, l.occurred_on::text AS occurred_on, e.description, e.source_reference,
              e.kind::text AS kind, l.line_number, l.direction::text AS direction, l.amount::text AS amount,
              l.line_description
       FROM acc.posted_journal_lines l
       INNER JOIN acc.journal_entries e ON e.id = l.journal_entry_id
       WHERE l.period_id = $1 AND l.account_id = $2
       ORDER BY l.occurred_on, e.posted_at, l.line_number`,
      [periodId, accountId],
    );
    return result.rows;
  }

  async countPostedUnbalanced(): Promise<number> {
    const result = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM (
         SELECT e.id
         FROM acc.journal_entries e
         INNER JOIN acc.journal_entry_lines l ON l.journal_entry_id = e.id
         WHERE e.status = 'POSTED'
         GROUP BY e.id
         HAVING COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount ELSE 0 END), 0)
              <> COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE 0 END), 0)
             OR COUNT(*) < 2
       ) broken`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async countDuplicatePostings(): Promise<number> {
    const result = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM (
         SELECT source_kind, source_id, idempotency_key
         FROM acc.journal_entries
         WHERE status = 'POSTED'
         GROUP BY source_kind, source_id, idempotency_key
         HAVING COUNT(*) > 1
       ) dup`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async createChart(input: CreateChartPersistenceInput): Promise<ChartOfAccountsRow> {
    try {
      const result = await this.pool().query<ChartOfAccountsRow>(
        `INSERT INTO acc.charts_of_accounts (
           unit_id, code, name, created_by_identity_id, updated_by_identity_id
         ) VALUES ($1, $2, $3, $4, $4)
         RETURNING ${CHART_RETURNING}`,
        [input.unitId, input.code, input.name, input.actorIdentityId],
      );
      return result.rows[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AccountingError('ACCOUNTING_DUPLICATE_POSTING');
      }
      throw error;
    }
  }

  async createAccount(input: CreateAccountPersistenceInput): Promise<AccountingAccountRow> {
    const chart = await this.findChartById(input.chartId);
    if (!chart) {
      throw new AccountingError('ACCOUNTING_CHART_NOT_FOUND');
    }
    if (input.parentId) {
      const parent = await this.findAccountById(input.parentId);
      if (!parent || parent.chart_id !== input.chartId) {
        throw new AccountingError('ACCOUNTING_ACCOUNT_CHART_MISMATCH');
      }
    }
    try {
      const result = await this.pool().query<AccountingAccountRow>(
        `INSERT INTO acc.accounting_accounts (
           chart_id, parent_id, code, name, class,
           created_by_identity_id, updated_by_identity_id
         ) VALUES ($1, $2, $3, $4, $5::acc.account_class, $6, $6)
         RETURNING ${ACCOUNT_RETURNING}`,
        [
          input.chartId,
          input.parentId ?? null,
          input.code,
          input.name,
          input.class,
          input.actorIdentityId,
        ],
      );
      return result.rows[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AccountingError('ACCOUNTING_DUPLICATE_POSTING');
      }
      throw error;
    }
  }

  async createPeriod(input: CreatePeriodPersistenceInput): Promise<AccountingPeriodRow> {
    const chart = await this.findChartById(input.chartId);
    if (!chart) {
      throw new AccountingError('ACCOUNTING_CHART_NOT_FOUND');
    }
    try {
      const result = await this.pool().query<AccountingPeriodRow>(
        `INSERT INTO acc.accounting_periods (
           chart_id, unit_id, code, starts_on, ends_on,
           created_by_identity_id, updated_by_identity_id
         ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $6)
         RETURNING ${PERIOD_RETURNING}`,
        [
          input.chartId,
          input.unitId,
          input.code,
          input.startsOn,
          input.endsOn,
          input.actorIdentityId,
        ],
      );
      return result.rows[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AccountingError('ACCOUNTING_DUPLICATE_POSTING');
      }
      throw error;
    }
  }

  async closePeriod(input: ClosePeriodPersistenceInput): Promise<ClosePeriodOutcome> {
    const client = await this.pool().connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const locked = await this.lockPeriod(client, input.periodId);
      if (locked.status === PERIOD_STATUSES.Closed) {
        await client.query('COMMIT');
        committed = true;
        return { period: locked, idempotent: true, runStatus: null, checks: [] };
      }
      assertPeriodOpen(locked.status);
      if (classifyRowVersion(locked, input.rowVersion) !== 'match') {
        throw new AccountingError('ACCOUNTING_VERSION_CONFLICT');
      }
      const policyRow = await this.ensureClosePolicy(client, locked, input.actorIdentityId);
      const policy = toClosePolicy(policyRow);
      const observations = await this.gatherCloseObservations(client, locked);
      const checks = evaluatePeriodCloseChecks(policy, observations);
      const runStatus = periodCloseRunStatus(checks);
      await this.persistCloseRun(client, {
        periodId: locked.id,
        policyId: policyRow.id,
        status: runStatus,
        actorIdentityId: input.actorIdentityId,
        checks,
      });
      if (runStatus !== 'SUCCEEDED') {
        await client.query('COMMIT');
        committed = true;
        assertPeriodCloseAllowed(checks);
      }
      const result = await client.query<AccountingPeriodRow>(
        `UPDATE acc.accounting_periods
         SET status = 'CLOSED',
             closed_at = NOW(),
             closed_by_identity_id = $2,
             close_reason = $3,
             reopened_at = NULL,
             reopened_by_identity_id = NULL,
             reopen_reason = NULL,
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $2
         WHERE id = $1
         RETURNING ${PERIOD_RETURNING}`,
        [input.periodId, input.actorIdentityId, input.reason],
      );
      await client.query('COMMIT');
      committed = true;
      return { period: result.rows[0]!, idempotent: false, runStatus, checks };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateClosePolicy(
    input: PeriodClosePolicy & {
      unitId: string;
      chartId: string;
      actorIdentityId: string;
    },
  ): Promise<void> {
    await this.pool().query(
      `INSERT INTO acc.period_close_policies (
         unit_id, chart_id,
         require_trial_balance_balanced, require_no_draft_journals,
         require_no_critical_pending_postings, require_no_duplicate_economic_events,
         require_origin_consistency, require_bank_reconciliation_integrity,
         require_receivables_settled, require_payables_settled,
         require_all_bank_lines_matched, require_fiscal_documents_authorized,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       ON CONFLICT (unit_id, chart_id) DO UPDATE SET
         require_trial_balance_balanced = EXCLUDED.require_trial_balance_balanced,
         require_no_draft_journals = EXCLUDED.require_no_draft_journals,
         require_no_critical_pending_postings = EXCLUDED.require_no_critical_pending_postings,
         require_no_duplicate_economic_events = EXCLUDED.require_no_duplicate_economic_events,
         require_origin_consistency = EXCLUDED.require_origin_consistency,
         require_bank_reconciliation_integrity = EXCLUDED.require_bank_reconciliation_integrity,
         require_receivables_settled = EXCLUDED.require_receivables_settled,
         require_payables_settled = EXCLUDED.require_payables_settled,
         require_all_bank_lines_matched = EXCLUDED.require_all_bank_lines_matched,
         require_fiscal_documents_authorized = EXCLUDED.require_fiscal_documents_authorized,
         updated_at = NOW(),
         updated_by_identity_id = EXCLUDED.updated_by_identity_id`,
      [
        input.unitId,
        input.chartId,
        input.requireTrialBalanceBalanced,
        input.requireNoDraftJournals,
        input.requireNoCriticalPendingPostings,
        input.requireNoDuplicateEconomicEvents,
        input.requireOriginConsistency,
        input.requireBankReconciliationIntegrity,
        input.requireReceivablesSettled,
        input.requirePayablesSettled,
        input.requireAllBankLinesMatched,
        input.requireFiscalDocumentsAuthorized,
        input.actorIdentityId,
      ],
    );
  }

  async reopenPeriod(input: ReopenPeriodPersistenceInput): Promise<AccountingPeriodRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await this.lockPeriod(client, input.periodId);
      if (locked.status === PERIOD_STATUSES.Open) {
        throw new AccountingError('ACCOUNTING_PERIOD_OPEN');
      }
      if (classifyRowVersion(locked, input.rowVersion) !== 'match') {
        throw new AccountingError('ACCOUNTING_VERSION_CONFLICT');
      }
      const result = await client.query<AccountingPeriodRow>(
        `UPDATE acc.accounting_periods
         SET status = 'OPEN',
             closed_at = NULL,
             closed_by_identity_id = NULL,
             close_reason = NULL,
             reopened_at = NOW(),
             reopened_by_identity_id = $2,
             reopen_reason = $3,
             reopen_count = reopen_count + 1,
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $2
         WHERE id = $1
         RETURNING ${PERIOD_RETURNING}`,
        [input.periodId, input.actorIdentityId, input.reason],
      );
      await client.query('COMMIT');
      return result.rows[0]!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createDraft(input: DraftJournalPersistenceInput): Promise<JournalAggregate> {
    const existing = await this.findByIdempotency(input);
    if (existing) {
      return existing;
    }
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const created = await this.insertDraft(client, input);
      await client.query('COMMIT');
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const duplicate = await this.findByIdempotency(input);
        if (duplicate) {
          return duplicate;
        }
        throw new AccountingError('ACCOUNTING_DUPLICATE_POSTING');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceLines(input: ReplaceJournalLinesPersistenceInput): Promise<JournalAggregate> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const entry = await this.lockPeriodThenEntry(client, input.journalEntryId);
      assertDraftMutable(entry.status);
      if (classifyRowVersion(entry, input.rowVersion) !== 'match') {
        throw new AccountingError('ACCOUNTING_VERSION_CONFLICT');
      }
      assertPeriodOpen((await this.lockPeriod(client, entry.period_id)).status);
      await this.writeLines(client, entry, input.lines);
      const updated = await client.query<JournalEntryRow>(
        `UPDATE acc.journal_entries
         SET row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $2
         WHERE id = $1
         RETURNING ${ENTRY_RETURNING}`,
        [entry.id, input.actorIdentityId],
      );
      const lines = await this.listLines(entry.id, client);
      await client.query('COMMIT');
      return { entry: updated.rows[0]!, lines };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async post(input: PostJournalPersistenceInput): Promise<JournalAggregate> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const posted = await this.postLocked(client, input);
      await client.query('COMMIT');
      return posted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createAndPost(input: DraftJournalPersistenceInput): Promise<JournalAggregate> {
    const existing = await this.findByIdempotency(input);
    if (existing?.entry.status === JOURNAL_STATUSES.Posted) {
      return existing;
    }
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const draft = existing
        ? existing
        : await this.insertDraft(client, input);
      const posted = await this.postLocked(client, {
        journalEntryId: draft.entry.id,
        rowVersion: draft.entry.row_version,
        actorIdentityId: input.actorIdentityId,
      });
      await client.query('COMMIT');
      return posted;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const duplicate = await this.findByIdempotency(input);
        if (duplicate?.entry.status === JOURNAL_STATUSES.Posted) {
          return duplicate;
        }
        throw new AccountingError('ACCOUNTING_DUPLICATE_POSTING');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Lancamento que estornou o informado, quando existir. Somente leitura: usado para ligar a
   * auditoria na direcao "foi estornado por", que a resposta de detalhe nao expunha.
   */
  async findReversalOf(journalEntryId: string): Promise<JournalEntryRow | null> {
    const result = await this.pool().query<JournalEntryRow>(
      `SELECT ${ENTRY_RETURNING} FROM acc.journal_entries WHERE reverses_entry_id = $1`,
      [journalEntryId],
    );
    return result.rows[0] ?? null;
  }

  async reverse(input: ReverseJournalPersistenceInput): Promise<JournalAggregate> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const original = await this.lockPeriodThenEntry(client, input.journalEntryId);
      assertPosted(original.status);
      if (classifyRowVersion(original, input.rowVersion) !== 'match') {
        throw new AccountingError('ACCOUNTING_VERSION_CONFLICT');
      }
      const existingReversal = await client.query<JournalEntryRow>(
        `SELECT ${ENTRY_RETURNING} FROM acc.journal_entries WHERE reverses_entry_id = $1`,
        [original.id],
      );
      if (existingReversal.rows[0]) {
        if (existingReversal.rows[0].idempotency_key !== input.idempotencyKey) {
          throw new AccountingError('ACCOUNTING_ALREADY_REVERSED');
        }
        const lines = await this.listLines(existingReversal.rows[0].id, client);
        await client.query('COMMIT');
        return { entry: existingReversal.rows[0], lines };
      }
      const period = await this.lockPeriod(client, original.period_id);
      assertPeriodOpen(period.status);
      const originalLines = await this.listLines(original.id, client);
      const reversed = await this.insertDraft(client, {
        chartId: original.chart_id,
        periodId: original.period_id,
        description: input.reason,
        occurredOn: original.occurred_on,
        currencyCode: original.currency_code,
        sourceKind: original.source_kind,
        sourceId: original.source_id,
        sourceReference: original.source_reference,
        idempotencyKey: input.idempotencyKey,
        actorIdentityId: input.actorIdentityId,
        lines: reversalLines(
          originalLines.map((line) => ({
            lineNumber: line.line_number,
            accountId: line.account_id,
            direction: line.direction,
            amount: line.amount,
            description: line.description,
          })),
        ),
        kind: JOURNAL_KINDS.Reversal,
        reversesEntryId: original.id,
      });
      const posted = await this.postLocked(client, {
        journalEntryId: reversed.entry.id,
        rowVersion: reversed.entry.row_version,
        actorIdentityId: input.actorIdentityId,
      });
      await client.query('COMMIT');
      return posted;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const existing = await this.pool().query<JournalEntryRow>(
          `SELECT ${ENTRY_RETURNING}
           FROM acc.journal_entries
           WHERE chart_id = (SELECT chart_id FROM acc.journal_entries WHERE id = $1)
             AND idempotency_key = $2`,
          [input.journalEntryId, input.idempotencyKey],
        );
        if (existing.rows[0]) {
          const lines = await this.listLines(existing.rows[0].id);
          return { entry: existing.rows[0], lines };
        }
        throw new AccountingError('ACCOUNTING_ALREADY_REVERSED');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertDraft(
    client: PoolClient,
    input: DraftJournalPersistenceInput & { kind?: string; reversesEntryId?: string },
  ): Promise<JournalAggregate> {
    const period = await this.lockPeriod(client, input.periodId);
    assertPeriodOpen(period.status);
    const chart = await client.query<ChartOfAccountsRow>(
      `SELECT ${CHART_RETURNING} FROM acc.charts_of_accounts WHERE id = $1 FOR UPDATE`,
      [input.chartId],
    );
    if (!chart.rows[0]) {
      throw new AccountingError('ACCOUNTING_CHART_NOT_FOUND');
    }
    if (period.chart_id !== input.chartId) {
      throw new AccountingError('ACCOUNTING_ACCOUNT_CHART_MISMATCH');
    }
    assertOccurredInPeriod(input.occurredOn, period.starts_on, period.ends_on);
    const kind = input.kind ?? JOURNAL_KINDS.Entry;
    const result = await client.query<JournalEntryRow>(
      `INSERT INTO acc.journal_entries (
         chart_id, period_id, unit_id, status, kind, description, occurred_on, currency_code,
         source_kind, source_id, source_reference, idempotency_key, reverses_entry_id,
         created_by_identity_id, updated_by_identity_id
       ) VALUES (
         $1, $2, $3, 'DRAFT', $4::acc.journal_kind, $5, $6::date, $7,
         $8::acc.journal_source_kind, $9, $10, $11, $12, $13, $13
       )
       RETURNING ${ENTRY_RETURNING}`,
      [
        input.chartId,
        input.periodId,
        period.unit_id,
        kind,
        input.description,
        input.occurredOn,
        input.currencyCode,
        input.sourceKind,
        input.sourceId,
        input.sourceReference,
        input.idempotencyKey,
        input.reversesEntryId ?? null,
        input.actorIdentityId,
      ],
    );
    const entry = result.rows[0]!;
    await this.writeLines(client, entry, input.lines);
    const lines = await this.listLines(entry.id, client);
    return { entry, lines };
  }

  private async postLocked(
    client: PoolClient,
    input: PostJournalPersistenceInput,
  ): Promise<JournalAggregate> {
    const entry = await this.lockPeriodThenEntry(client, input.journalEntryId);
    if (entry.status === JOURNAL_STATUSES.Posted) {
      const lines = await this.listLines(entry.id, client);
      return { entry, lines };
    }
    if (classifyRowVersion(entry, input.rowVersion) !== 'match') {
      throw new AccountingError('ACCOUNTING_VERSION_CONFLICT');
    }
    const period = await this.lockPeriod(client, entry.period_id);
    assertPeriodOpen(period.status);
    const lines = await this.listLines(entry.id, client);
    assertBalancedEntry(
      lines.map((line) => ({
        lineNumber: line.line_number,
        accountId: line.account_id,
        direction: line.direction,
        amount: line.amount,
        description: line.description,
      })),
    );
    await this.assertEntryLinesPostableNow(client, entry.id, entry.kind);
    const posted = await client.query<JournalEntryRow>(
      `UPDATE acc.journal_entries
       SET status = 'POSTED',
           entry_number = (
             SELECT COALESCE(MAX(je.entry_number), 0) + 1
             FROM acc.journal_entries je
             WHERE je.period_id = $3 AND je.entry_number IS NOT NULL
           ),
           posted_at = NOW(),
           posted_by_identity_id = $2,
           row_version = row_version + 1,
           updated_at = NOW(),
           updated_by_identity_id = $2
       WHERE id = $1
       RETURNING ${ENTRY_RETURNING}`,
      [entry.id, input.actorIdentityId, entry.period_id],
    );
    return { entry: posted.rows[0]!, lines };
  }

  private async writeLines(
    client: PoolClient,
    entry: JournalEntryRow,
    lines: DraftJournalPersistenceInput['lines'],
  ): Promise<void> {
    if (lines.length > 0) {
      assertBalancedEntry(lines);
    }
    await client.query(`DELETE FROM acc.journal_entry_lines WHERE journal_entry_id = $1`, [
      entry.id,
    ]);
    for (const line of lines) {
      const account = await client.query<AccountingAccountRow>(
        `SELECT ${ACCOUNT_RETURNING} FROM acc.accounting_accounts WHERE id = $1 FOR UPDATE`,
        [line.accountId],
      );
      if (!account.rows[0]) {
        throw new AccountingError('ACCOUNTING_ACCOUNT_NOT_FOUND');
      }
      if (account.rows[0].chart_id !== entry.chart_id) {
        throw new AccountingError('ACCOUNTING_ACCOUNT_CHART_MISMATCH');
      }
      await this.assertAccountPostableNow(client, account.rows[0], entry);
      await client.query(
        `INSERT INTO acc.journal_entry_lines (
           journal_entry_id, line_number, account_id, direction, amount, description
         ) VALUES ($1, $2, $3, $4::acc.journal_direction, $5, $6)`,
        [
          entry.id,
          line.lineNumber,
          line.accountId,
          line.direction,
          line.amount,
          line.description ?? null,
        ],
      );
    }
  }

  /**
   * Conta precisa estar ATIVA e ser ANALÍTICA (sem filhos) para receber
   * escrituração de entrada ENTRY. Estornos (REVERSAL) restauram histórico e
   * podem referenciar contas posteriormente inativadas.
   */
  private async assertAccountPostableNow(
    client: PoolClient,
    account: AccountingAccountRow,
    entry: Pick<JournalEntryRow, 'kind'>,
  ): Promise<void> {
    if (entry.kind === JOURNAL_KINDS.Reversal) {
      return;
    }
    const children = await client.query<{ has_children: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM acc.accounting_accounts WHERE parent_id = $1
       ) AS has_children`,
      [account.id],
    );
    assertAccountPostable({
      status: account.status,
      hasChildren: children.rows[0]?.has_children ?? false,
    });
  }

  /**
   * Revalida no momento do POST que todas as contas das linhas continuam
   * postáveis (entrada ENTRY). Uma conta inativada/sintetizada entre o rascunho
   * e a postagem bloqueia a efetivação.
   */
  private async assertEntryLinesPostableNow(
    client: PoolClient,
    journalEntryId: string,
    kind: string,
  ): Promise<void> {
    if (kind === JOURNAL_KINDS.Reversal) {
      return;
    }
    const rows = await client.query<{
      account_id: string;
      status: string;
      has_children: boolean;
    }>(
      `SELECT l.account_id, a.status::text AS status,
              EXISTS(SELECT 1 FROM acc.accounting_accounts c WHERE c.parent_id = a.id) AS has_children
       FROM acc.journal_entry_lines l
       INNER JOIN acc.accounting_accounts a ON a.id = l.account_id
       WHERE l.journal_entry_id = $1`,
      [journalEntryId],
    );
    for (const row of rows.rows) {
      assertAccountPostable({ status: row.status, hasChildren: row.has_children });
    }
  }

  private async ensureClosePolicy(
    client: PoolClient,
    period: AccountingPeriodRow,
    actorIdentityId: string,
  ): Promise<PeriodClosePolicyRow> {
    await client.query(
      `INSERT INTO acc.period_close_policies (
         unit_id, chart_id, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $3)
       ON CONFLICT (unit_id, chart_id) DO NOTHING`,
      [period.unit_id, period.chart_id, actorIdentityId],
    );
    const result = await client.query<PeriodClosePolicyRow>(
      `SELECT id, unit_id, chart_id,
              require_trial_balance_balanced, require_no_draft_journals,
              require_no_critical_pending_postings, require_no_duplicate_economic_events,
              require_origin_consistency, require_bank_reconciliation_integrity,
              require_receivables_settled, require_payables_settled,
              require_all_bank_lines_matched, require_fiscal_documents_authorized
       FROM acc.period_close_policies
       WHERE unit_id = $1 AND chart_id = $2`,
      [period.unit_id, period.chart_id],
    );
    if (!result.rows[0]) {
      throw new AccountingError('ACCOUNTING_PERIOD_NOT_FOUND');
    }
    return result.rows[0];
  }

  private async gatherCloseObservations(
    client: PoolClient,
    period: AccountingPeriodRow,
  ): Promise<PeriodCloseObservations> {
    const startsOn = period.starts_on.slice(0, 10);
    const endsOn = period.ends_on.slice(0, 10);
    const count = async (sql: string, params: unknown[]): Promise<number> => {
      const result = await client.query<{ count: string }>(sql, params);
      return Number(result.rows[0]?.count ?? '0');
    };
    const receivablesPending = await count(
      `SELECT COUNT(*)::text AS count
       FROM rpt.read_receivables r
       WHERE r.unit_id = $1 AND r.lifecycle = 'ACTIVE'
         AND r.due_date BETWEEN $2::date AND $3::date
         AND r.principal > COALESCE((
           SELECT SUM(s.amount) FROM rpt.read_settlements s WHERE s.receivable_id = r.id
         ), 0)`,
      [period.unit_id, startsOn, endsOn],
    );
    const payablesPending = await count(
      `SELECT COUNT(*)::text AS count
       FROM rpt.read_payables p
       WHERE p.unit_id = $1 AND p.lifecycle = 'ACTIVE'
         AND p.due_date BETWEEN $2::date AND $3::date
         AND p.principal > COALESCE((
           SELECT SUM(pay.amount) FROM rpt.read_payments pay WHERE pay.payable_id = p.id
         ), 0)`,
      [period.unit_id, startsOn, endsOn],
    );
    const treasuryMovements = await count(
      `SELECT COUNT(*)::text AS count
       FROM rpt.read_financial_transactions t
       INNER JOIN rpt.read_financial_accounts a ON a.id = t.account_id
       WHERE a.unit_id = $1
         AND (t.occurred_at AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date`,
      [period.unit_id, startsOn, endsOn],
    );
    const bankIntegrityBroken = await count(
      `SELECT COUNT(*)::text AS count
       FROM rpt.read_reconciliations r
       WHERE r.unit_id = $1 AND r.status = 'CONFIRMED'
         AND NOT EXISTS (
           SELECT 1 FROM rpt.read_reconciliation_matches m
           WHERE m.reconciliation_id = r.id AND m.is_active
         )`,
      [period.unit_id],
    );
    const bankUnmatchedLines = await count(
      `SELECT COUNT(*)::text AS count
       FROM rpt.read_bank_statement_lines l
       INNER JOIN rpt.read_bank_statements s ON s.id = l.bank_statement_id
       WHERE s.unit_id = $1 AND l.match_status = 'UNMATCHED'
         AND s.period_starts_on <= $3::date AND s.period_ends_on >= $2::date`,
      [period.unit_id, startsOn, endsOn],
    );
    const fiscalUnauthorized = await count(
      `SELECT COUNT(*)::text AS count
       FROM rpt.read_fiscal_documents d
       WHERE d.unit_id = $1
         AND d.issued_on BETWEEN $2::date AND $3::date
         AND d.status NOT IN ('AUTHORIZED', 'CANCELLED')`,
      [period.unit_id, startsOn, endsOn],
    );
    const draftJournals = await this.countDraftsInPeriod(period.id, client);
    const trialUnbalanced = await count(
      `SELECT (
         (SELECT COUNT(*)
          FROM (
            SELECT e.id
            FROM acc.journal_entries e
            INNER JOIN acc.journal_entry_lines l ON l.journal_entry_id = e.id
            WHERE e.period_id = $1 AND e.status = 'POSTED'
            GROUP BY e.id
            HAVING COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount ELSE 0 END), 0)
                 <> COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE 0 END), 0)
          ) broken)
         +
         (SELECT CASE WHEN debit <> credit THEN 1 ELSE 0 END
          FROM (
            SELECT
              COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount ELSE 0 END), 0) AS debit,
              COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE 0 END), 0) AS credit
            FROM acc.journal_entries e
            INNER JOIN acc.journal_entry_lines l ON l.journal_entry_id = e.id
            WHERE e.period_id = $1 AND e.status = 'POSTED'
          ) totals)
       )::text AS count`,
      [period.id],
    );
    const pendingPostings = await count(
      `SELECT COUNT(*)::text AS count
       FROM acc.accounting_posting_requests r
       WHERE r.unit_id = $1 AND r.status = 'PENDING'
         AND r.occurred_on BETWEEN $2::date AND $3::date`,
      [period.unit_id, startsOn, endsOn],
    );
    const duplicateEconomicEvents = await count(
      `SELECT COUNT(*)::text AS count
       FROM (
         SELECT source_kind, source_id
         FROM acc.journal_entries
         WHERE period_id = $1 AND status = 'POSTED' AND kind = 'ENTRY'
         GROUP BY source_kind, source_id
         HAVING COUNT(*) > 1
       ) dup`,
      [period.id],
    );
    const originInconsistencies = await count(
      `SELECT COUNT(*)::text AS count
       FROM acc.journal_entries e
       WHERE e.period_id = $1 AND e.status = 'POSTED' AND e.kind = 'ENTRY'
         AND (
           (e.source_kind = 'SETTLEMENT' AND NOT EXISTS (
             SELECT 1 FROM rpt.read_settlements s WHERE s.id = e.source_id
           ))
           OR (e.source_kind = 'PAYMENT' AND NOT EXISTS (
             SELECT 1 FROM rpt.read_payments p WHERE p.id = e.source_id
           ))
           OR (e.source_kind = 'BILLING' AND NOT EXISTS (
             SELECT 1 FROM rpt.read_billing_documents b WHERE b.id = e.source_id
           ))
           OR (e.source_kind = 'TAX' AND NOT EXISTS (
             SELECT 1 FROM rpt.read_fiscal_documents f WHERE f.id = e.source_id
           ) AND NOT EXISTS (
             SELECT 1 FROM rpt.read_tax_calculations t WHERE t.id = e.source_id
           ))
           OR (e.source_kind = 'INVENTORY' AND NOT EXISTS (
             SELECT 1 FROM rpt.read_stock_movements m WHERE m.id = e.source_id
           ))
           OR (e.source_kind = 'PAYROLL' AND NOT EXISTS (
             SELECT 1 FROM rpt.read_payroll_periods p WHERE p.id = e.source_id
           ))
         )`,
      [period.id],
    );
    return {
      receivablesPending,
      payablesPending,
      treasuryMovements,
      bankIntegrityBroken,
      bankUnmatchedLines,
      fiscalUnauthorized,
      draftJournals,
      trialUnbalanced,
      pendingPostings,
      duplicateEconomicEvents,
      originInconsistencies,
    };
  }

  private async persistCloseRun(
    client: PoolClient,
    input: {
      periodId: string;
      policyId: string;
      status: string;
      actorIdentityId: string;
      checks: PeriodCloseCheck[];
    },
  ): Promise<void> {
    const run = await client.query<{ id: string }>(
      `INSERT INTO acc.period_close_runs (
         period_id, policy_id, status, created_by_identity_id
       ) VALUES ($1, $2, $3::acc.period_close_run_status, $4)
       RETURNING id`,
      [input.periodId, input.policyId, input.status, input.actorIdentityId],
    );
    for (const check of input.checks) {
      await client.query(
        `INSERT INTO acc.period_close_check_results (
           close_run_id, kind, result, blocking, observed_count, detail
         ) VALUES (
           $1, $2::acc.period_close_check_kind, $3::acc.period_close_check_result, $4, $5, $6
         )`,
        [run.rows[0]!.id, check.kind, check.result, check.blocking, check.observedCount, check.detail],
      );
    }
  }

  private async lockPeriod(client: PoolClient, periodId: string): Promise<AccountingPeriodRow> {
    const result = await client.query<AccountingPeriodRow>(
      `SELECT ${PERIOD_RETURNING} FROM acc.accounting_periods WHERE id = $1 FOR UPDATE`,
      [periodId],
    );
    if (!result.rows[0]) {
      throw new AccountingError('ACCOUNTING_PERIOD_NOT_FOUND');
    }
    return result.rows[0];
  }

  private async lockEntry(client: PoolClient, journalEntryId: string): Promise<JournalEntryRow> {
    const result = await client.query<JournalEntryRow>(
      `SELECT ${ENTRY_RETURNING} FROM acc.journal_entries WHERE id = $1 FOR UPDATE`,
      [journalEntryId],
    );
    if (!result.rows[0]) {
      throw new AccountingError('ACCOUNTING_NOT_FOUND');
    }
    return result.rows[0];
  }

  private async lockPeriodThenEntry(
    client: PoolClient,
    journalEntryId: string,
  ): Promise<JournalEntryRow> {
    const peek = await client.query<{ period_id: string }>(
      `SELECT period_id FROM acc.journal_entries WHERE id = $1`,
      [journalEntryId],
    );
    if (!peek.rows[0]) {
      throw new AccountingError('ACCOUNTING_NOT_FOUND');
    }
    await this.lockPeriod(client, peek.rows[0].period_id);
    return this.lockEntry(client, journalEntryId);
  }

  private async listLines(
    journalEntryId: string,
    client?: PoolClient,
  ): Promise<JournalEntryLineRow[]> {
    const db = client ?? this.pool();
    const result = await db.query<JournalEntryLineRow>(
      `SELECT ${LINE_RETURNING}
       FROM acc.journal_entry_lines
       WHERE journal_entry_id = $1
       ORDER BY line_number`,
      [journalEntryId],
    );
    return result.rows;
  }

  async findByIdempotency(
    input: Pick<DraftJournalPersistenceInput, 'chartId' | 'sourceKind' | 'sourceId' | 'idempotencyKey'>,
  ): Promise<JournalAggregate | null> {
    const result = await this.pool().query<JournalEntryRow>(
      `SELECT ${ENTRY_RETURNING}
       FROM acc.journal_entries
       WHERE (chart_id = $1 AND idempotency_key = $2)
          OR (source_kind = $3::acc.journal_source_kind AND source_id = $4 AND idempotency_key = $2)
       LIMIT 1`,
      [input.chartId, input.idempotencyKey, input.sourceKind, input.sourceId],
    );
    if (!result.rows[0]) {
      return null;
    }
    const lines = await this.listLines(result.rows[0].id);
    return { entry: result.rows[0], lines };
  }

  // ---------------------------------------------------------------------------
  // Leitura / listagens (projeções do ledger para a UI) — ordenação determinística.
  // ---------------------------------------------------------------------------

  async listChartsByUnit(unitId: string): Promise<ChartOfAccountsRow[]> {
    const result = await this.pool().query<ChartOfAccountsRow>(
      `SELECT ${CHART_RETURNING}
       FROM acc.charts_of_accounts
       WHERE unit_id = $1
       ORDER BY code, name`,
      [unitId],
    );
    return result.rows;
  }

  async listPeriodsByChart(chartId: string, status?: string): Promise<AccountingPeriodRow[]> {
    const statusFilter = status ? `AND status = $2::acc.period_status` : '';
    const result = await this.pool().query<AccountingPeriodRow>(
      `SELECT ${PERIOD_RETURNING}
       FROM acc.accounting_periods
       WHERE chart_id = $1 ${statusFilter}
       ORDER BY starts_on DESC, code`,
      status ? [chartId, status] : [chartId],
    );
    return result.rows;
  }

  async findAccountPostability(accountId: string): Promise<AccountPostability> {
    const account = await this.findAccountById(accountId);
    if (!account) {
      return { account: null, hasChildren: false };
    }
    const children = await this.pool().query<{ has_children: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM acc.accounting_accounts WHERE parent_id = $1) AS has_children`,
      [accountId],
    );
    return { account, hasChildren: children.rows[0]?.has_children ?? false };
  }

  async listJournalPage(input: JournalListPageInput): Promise<JournalListPageResult> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };
    if (input.chartId) {
      push('e.chart_id = ?', input.chartId);
    }
    if (input.periodId) {
      push('e.period_id = ?', input.periodId);
    }
    if (input.status) {
      push('e.status = ?::acc.journal_status', input.status);
    }
    if (input.kind) {
      push('e.kind = ?::acc.journal_kind', input.kind);
    }
    if (input.occurredFrom) {
      push('e.occurred_on >= ?::date', input.occurredFrom);
    }
    if (input.occurredTo) {
      push('e.occurred_on <= ?::date', input.occurredTo);
    }
    if (input.sourceKind) {
      push('e.source_kind = ?::acc.journal_source_kind', input.sourceKind);
    }
    if (input.accountId) {
      push(
        `EXISTS (SELECT 1 FROM acc.journal_entry_lines account_line
                 WHERE account_line.journal_entry_id = e.id AND account_line.account_id = ?)`,
        input.accountId,
      );
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acc.journal_entries e ${where}`,
      params,
    );
    const total = Number(count.rows[0]?.count ?? '0');
    const pageParams = [...params, input.pageSize, input.page * input.pageSize];
    const entries = await this.pool().query<JournalEntryRow>(
      `SELECT ${ENTRY_RETURNING}
       FROM acc.journal_entries e
       ${where}
       ORDER BY e.occurred_on ASC, e.created_at ASC, e.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
    );
    const items: AccountingJournalListItem[] = [];
    if (entries.rows.length > 0) {
      const entryIds = entries.rows.map((entry) => entry.id);
      const lines = await this.pool().query<EnrichedJournalLineRow>(
        `SELECT l.id, l.journal_entry_id, l.line_number, l.account_id, l.direction::text AS direction,
                l.amount::text AS amount, l.description, l.created_at,
                a.code AS account_code, a.name AS account_name, a.class::text AS account_class,
                a.status::text AS account_status
         FROM acc.journal_entry_lines l
         INNER JOIN acc.accounting_accounts a ON a.id = l.account_id
         WHERE l.journal_entry_id = ANY($1::uuid[])
         ORDER BY l.journal_entry_id, l.line_number`,
        [entryIds],
      );
      const linesByEntry = new Map<string, EnrichedJournalLineRow[]>();
      for (const line of lines.rows) {
        const bucket = linesByEntry.get(line.journal_entry_id) ?? [];
        bucket.push(line);
        linesByEntry.set(line.journal_entry_id, bucket);
      }
      for (const entry of entries.rows) {
        items.push({ entry, lines: linesByEntry.get(entry.id) ?? [] });
      }
    }
    return { items, total };
  }

  async listLedgerMovementsPage(
    periodId: string,
    accountId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: LedgerMovementRow[]; total: number }> {
    const count = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM acc.posted_journal_lines l
       WHERE l.period_id = $1 AND l.account_id = $2`,
      [periodId, accountId],
    );
    const total = Number(count.rows[0]?.count ?? '0');
    const result = await this.pool().query<LedgerMovementRow>(
      `SELECT l.journal_entry_id, l.occurred_on::text AS occurred_on, e.description, e.source_reference,
              e.kind::text AS kind, l.line_number, l.direction::text AS direction, l.amount::text AS amount,
              l.line_description
       FROM acc.posted_journal_lines l
       INNER JOIN acc.journal_entries e ON e.id = l.journal_entry_id
       WHERE l.period_id = $1 AND l.account_id = $2
       ORDER BY l.occurred_on, e.posted_at, e.id, l.line_number
       LIMIT $3 OFFSET $4`,
      [periodId, accountId, pageSize, page * pageSize],
    );
    return { items: result.rows, total };
  }

  async listAllLedgerMovements(
    periodId: string,
    accountId: string,
  ): Promise<LedgerMovementRow[]> {
    const result = await this.pool().query<LedgerMovementRow>(
      `SELECT l.journal_entry_id, l.occurred_on::text AS occurred_on, e.description, e.source_reference,
              e.kind::text AS kind, l.line_number, l.direction::text AS direction, l.amount::text AS amount,
              l.line_description
       FROM acc.posted_journal_lines l
       INNER JOIN acc.journal_entries e ON e.id = l.journal_entry_id
       WHERE l.period_id = $1 AND l.account_id = $2
       ORDER BY l.occurred_on, e.posted_at, e.id, l.line_number`,
      [periodId, accountId],
    );
    return result.rows;
  }

  async listPeriodCloseRuns(periodId: string): Promise<{
    runs: Array<{ run: PeriodCloseRunDetailRow; checks: PeriodCloseCheckDetailRow[] }>;
  }> {
    const runs = await this.pool().query<PeriodCloseRunDetailRow>(
      `SELECT id, period_id, policy_id, status::text AS status, created_at, created_by_identity_id
       FROM acc.period_close_runs
       WHERE period_id = $1
       ORDER BY created_at DESC, id DESC`,
      [periodId],
    );
    const grouped: Array<{ run: PeriodCloseRunDetailRow; checks: PeriodCloseCheckDetailRow[] }> = [];
    if (runs.rows.length > 0) {
      const runIds = runs.rows.map((run) => run.id);
      const checks = await this.pool().query<PeriodCloseCheckDetailRow>(
        `SELECT id, close_run_id, kind::text AS kind, result::text AS result, blocking,
                observed_count, detail
         FROM acc.period_close_check_results
         WHERE close_run_id = ANY($1::uuid[])
         ORDER BY close_run_id, kind`,
        [runIds],
      );
      const checksByRun = new Map<string, PeriodCloseCheckDetailRow[]>();
      for (const check of checks.rows) {
        const bucket = checksByRun.get(check.close_run_id) ?? [];
        bucket.push(check);
        checksByRun.set(check.close_run_id, bucket);
      }
      for (const run of runs.rows) {
        grouped.push({ run, checks: checksByRun.get(run.id) ?? [] });
      }
    }
    return { runs: grouped };
  }

  async updateAccount(input: {
    accountId: string;
    name?: string;
    status?: string;
    actorIdentityId: string;
  }): Promise<AccountingAccountRow> {
    const sets: string[] = [];
    const params: unknown[] = [input.accountId];
    if (input.name !== undefined && input.name !== null) {
      sets.push('name = $' + (params.length + 1));
      params.push(input.name.trim());
    }
    if (input.status !== undefined && input.status !== null) {
      sets.push('status = $' + (params.length + 1) + '::acc.account_status');
      params.push(input.status);
    }
    if (sets.length === 0) {
      const current = await this.findAccountById(input.accountId);
      if (!current) {
        throw new AccountingError('ACCOUNTING_ACCOUNT_NOT_FOUND');
      }
      return current;
    }
    sets.push('updated_at = NOW()', `updated_by_identity_id = $${params.length + 1}`);
    params.push(input.actorIdentityId);
    const result = await this.pool().query<AccountingAccountRow>(
      `UPDATE acc.accounting_accounts
       SET ${sets.join(', ')}
       WHERE id = $1
       RETURNING ${ACCOUNT_RETURNING}`,
      params,
    );
    if (!result.rows[0]) {
      throw new AccountingError('ACCOUNTING_ACCOUNT_NOT_FOUND');
    }
    return result.rows[0];
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function toClosePolicy(row: PeriodClosePolicyRow): PeriodClosePolicy {
  return {
    requireTrialBalanceBalanced: row.require_trial_balance_balanced,
    requireNoDraftJournals: row.require_no_draft_journals,
    requireNoCriticalPendingPostings: row.require_no_critical_pending_postings,
    requireNoDuplicateEconomicEvents: row.require_no_duplicate_economic_events,
    requireOriginConsistency: row.require_origin_consistency,
    requireBankReconciliationIntegrity: row.require_bank_reconciliation_integrity,
    requireReceivablesSettled: row.require_receivables_settled,
    requirePayablesSettled: row.require_payables_settled,
    requireAllBankLinesMatched: row.require_all_bank_lines_matched,
    requireFiscalDocumentsAuthorized: row.require_fiscal_documents_authorized,
  };
}

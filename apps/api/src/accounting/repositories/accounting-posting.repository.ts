import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool } from 'pg';
import { classifyRowVersion } from '../../infrastructure/database/optimistic-lock';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  POSTING_FAILURE_INJECTION,
  POSTING_FAILURE_STAGES,
  PostingFailureInjection,
} from '../../platform/kernel/posting-failure-injection';
import { AccountingError } from '../domain/ledger';
import { POSTING_REQUEST_STATUSES, POSTING_VERSION_STATUSES } from '../domain/posting';
import { AccountingRepository } from './accounting.repository';
import type { DraftJournalPersistenceInput, JournalAggregate } from './accounting.repository.types';
import type {
  PersistPostingRequestInput,
  PersistPostingRuleInput,
  PersistPostingRuleVersionInput,
  PostingRequestListFilter,
  PostingRequestListRow,
  PostingRequestRow,
  PostingRuleRow,
  PostingRuleVersionRow,
} from './accounting-posting.repository.types';

const RULE_RETURNING = `
  id, unit_id, code, name, origin_kind::text AS origin_kind, event_kind::text AS event_kind,
  status::text AS status, created_at, updated_at
`;

const VERSION_RETURNING = `
  id, posting_rule_id, version_number, status::text AS status,
  debit_account_id, credit_account_id, required_context,
  effective_from::text AS effective_from, effective_to::text AS effective_to,
  source_reference, row_version, published_at, created_at, updated_at
`;

const REQUEST_RETURNING = `
  id, unit_id, origin_kind::text AS origin_kind, event_kind::text AS event_kind, source_id,
  source_reference, idempotency_key, posting_rule_id, posting_rule_version_id, journal_entry_id,
  status::text AS status, amount::text AS amount, currency_code, occurred_on::text AS occurred_on,
  context, actor_identity_id, created_at, updated_at
`;

@Injectable()
export class AccountingPostingRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly accountingRepository: AccountingRepository,
    @Optional()
    @Inject(POSTING_FAILURE_INJECTION)
    private readonly postingFailures?: PostingFailureInjection,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async createRule(input: PersistPostingRuleInput): Promise<PostingRuleRow> {
    try {
      const result = await this.pool().query<PostingRuleRow>(
        `INSERT INTO acc.accounting_posting_rules (
           unit_id, code, name, origin_kind, event_kind, created_by_identity_id, updated_by_identity_id
         ) VALUES ($1, $2, $3, $4::acc.posting_origin_kind, $5::acc.posting_event_kind, $6, $6)
         RETURNING ${RULE_RETURNING}`,
        [input.unitId, input.code, input.name, input.originKind, input.eventKind, input.actorIdentityId],
      );
      return requiredRow(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AccountingError('ACCOUNTING_DUPLICATE_POSTING');
      }
      throw error;
    }
  }

  async findRuleById(ruleId: string): Promise<PostingRuleRow | null> {
    const result = await this.pool().query<PostingRuleRow>(
      `SELECT ${RULE_RETURNING} FROM acc.accounting_posting_rules WHERE id = $1`,
      [ruleId],
    );
    return result.rows[0] ?? null;
  }

  async createDraftVersion(input: PersistPostingRuleVersionInput): Promise<PostingRuleVersionRow> {
    const next = await this.pool().query<{ version_number: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
       FROM acc.accounting_posting_rule_versions
       WHERE posting_rule_id = $1`,
      [input.postingRuleId],
    );
    const result = await this.pool().query<PostingRuleVersionRow>(
      `INSERT INTO acc.accounting_posting_rule_versions (
         posting_rule_id, version_number, debit_account_id, credit_account_id, required_context,
         effective_from, effective_to, source_reference, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::date, $7::date, $8, $9, $9)
       RETURNING ${VERSION_RETURNING}`,
      [
        input.postingRuleId,
        next.rows[0]?.version_number ?? 1,
        input.debitAccountId,
        input.creditAccountId,
        JSON.stringify(input.requiredContext),
        input.effectiveFrom,
        input.effectiveTo,
        input.sourceReference,
        input.actorIdentityId,
      ],
    );
    return normalizeVersion(requiredRow(result.rows[0]));
  }

  async findVersionById(versionId: string): Promise<PostingRuleVersionRow | null> {
    const result = await this.pool().query<PostingRuleVersionRow>(
      `SELECT ${VERSION_RETURNING} FROM acc.accounting_posting_rule_versions WHERE id = $1`,
      [versionId],
    );
    return result.rows[0] ? normalizeVersion(result.rows[0]) : null;
  }

  async publishVersion(
    versionId: string,
    rowVersion: number,
    actorIdentityId: string,
  ): Promise<PostingRuleVersionRow> {
    const current = await this.findVersionById(versionId);
    if (!current) {
      throw new AccountingError('ACCOUNTING_NOT_FOUND');
    }
    if (current.status === POSTING_VERSION_STATUSES.Published) {
      throw new AccountingError('ACCOUNTING_RULE_VERSION_IMMUTABLE');
    }
    if (classifyRowVersion(current, rowVersion) !== 'match') {
      throw new AccountingError('ACCOUNTING_VERSION_CONFLICT');
    }
    const result = await this.pool().query<PostingRuleVersionRow>(
      `UPDATE acc.accounting_posting_rule_versions
       SET status = 'PUBLISHED',
           published_at = NOW(),
           published_by_identity_id = $2,
           row_version = row_version + 1,
           updated_at = NOW(),
           updated_by_identity_id = $2
       WHERE id = $1 AND row_version = $3 AND status = 'DRAFT'
       RETURNING ${VERSION_RETURNING}`,
      [versionId, actorIdentityId, rowVersion],
    );
    if (!result.rows[0]) {
      throw new AccountingError('ACCOUNTING_VERSION_CONFLICT');
    }
    return normalizeVersion(result.rows[0]);
  }

  async findPublishedVersionForEvent(input: {
    unitId: string;
    originKind: string;
    eventKind: string;
    effectiveOn: string;
  }): Promise<{ rule: PostingRuleRow; version: PostingRuleVersionRow } | null> {
    const result = await this.pool().query<PostingRuleVersionRow & PostingRuleRow>(
      `SELECT
         v.id, v.posting_rule_id, v.version_number, v.status::text AS status,
         v.debit_account_id, v.credit_account_id, v.required_context,
         v.effective_from::text AS effective_from, v.effective_to::text AS effective_to,
         v.source_reference, v.row_version, v.published_at, v.created_at, v.updated_at,
         r.id AS rule_id, r.unit_id, r.code, r.name,
         r.origin_kind::text AS origin_kind, r.event_kind::text AS event_kind,
         r.status::text AS rule_status
       FROM acc.accounting_posting_rule_versions v
       INNER JOIN acc.accounting_posting_rules r ON r.id = v.posting_rule_id
       WHERE r.unit_id = $1
         AND r.origin_kind = $2::acc.posting_origin_kind
         AND r.event_kind = $3::acc.posting_event_kind
         AND r.status = 'ACTIVE'
         AND v.status = 'PUBLISHED'
         AND v.effective_from <= $4::date
         AND (v.effective_to IS NULL OR v.effective_to >= $4::date)`,
      [input.unitId, input.originKind, input.eventKind, input.effectiveOn],
    );
    if (result.rows.length !== 1) {
      return null;
    }
    const row = result.rows[0]!;
    return {
      rule: {
        id: row.posting_rule_id,
        unit_id: row.unit_id,
        code: row.code,
        name: row.name,
        origin_kind: row.origin_kind,
        event_kind: row.event_kind,
        status: 'ACTIVE',
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      version: normalizeVersion(row),
    };
  }

  async findRequestByEvent(
    originKind: string,
    eventKind: string,
    sourceId: string,
  ): Promise<PostingRequestRow | null> {
    const result = await this.pool().query<PostingRequestRow>(
      `SELECT ${REQUEST_RETURNING}
       FROM acc.accounting_posting_requests
       WHERE origin_kind = $1::acc.posting_origin_kind
         AND event_kind = $2::acc.posting_event_kind
         AND source_id = $3`,
      [originKind, eventKind, sourceId],
    );
    return result.rows[0] ?? null;
  }

  async postConfirmedEvent(input: {
    request: PersistPostingRequestInput;
    journal: DraftJournalPersistenceInput;
  }): Promise<{ request: PostingRequestRow; journal: JournalAggregate; idempotent: boolean }> {
    const existing = await this.findRequestByEvent(
      input.request.originKind,
      input.request.eventKind,
      input.request.sourceId,
    );
    if (existing?.status === POSTING_REQUEST_STATUSES.Posted && existing.journal_entry_id) {
      const journal = await this.accountingRepository.findByIdempotency({
        chartId: input.journal.chartId,
        sourceKind: input.journal.sourceKind,
        sourceId: input.journal.sourceId,
        idempotencyKey: input.journal.idempotencyKey,
      });
      if (journal) {
        return { request: existing, journal, idempotent: true };
      }
    }

    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const journal = await this.accountingRepository.createAndPostOnClient(client, input.journal);
      this.postingFailures?.consume(POSTING_FAILURE_STAGES.DuringPosting);
      const inserted = await client.query<PostingRequestRow>(
        `INSERT INTO acc.accounting_posting_requests (
           unit_id, origin_kind, event_kind, source_id, source_reference, idempotency_key,
           posting_rule_id, posting_rule_version_id, journal_entry_id, status, amount,
           currency_code, occurred_on, context, actor_identity_id
         ) VALUES (
           $1, $2::acc.posting_origin_kind, $3::acc.posting_event_kind, $4, $5, $6,
           $7, $8, $9, 'POSTED', $10, $11, $12::date, $13::jsonb, $14
         )
         RETURNING ${REQUEST_RETURNING}`,
        [
          input.request.unitId,
          input.request.originKind,
          input.request.eventKind,
          input.request.sourceId,
          input.request.sourceReference,
          input.request.idempotencyKey,
          input.request.postingRuleId,
          input.request.postingRuleVersionId,
          journal.entry.id,
          input.request.amount,
          input.request.currencyCode,
          input.request.occurredOn,
          JSON.stringify(input.request.context),
          input.request.actorIdentityId,
        ],
      );
      await client.query('COMMIT');
      return { request: inserted.rows[0]!, journal, idempotent: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const raced = await this.findRequestByEvent(
          input.request.originKind,
          input.request.eventKind,
          input.request.sourceId,
        );
        const journal = await this.accountingRepository.findByIdempotency({
          chartId: input.journal.chartId,
          sourceKind: input.journal.sourceKind,
          sourceId: input.journal.sourceId,
          idempotencyKey: input.journal.idempotencyKey,
        });
        if (raced?.status === POSTING_REQUEST_STATUSES.Posted && journal) {
          return { request: raced, journal, idempotent: true };
        }
        if (journal?.entry.status === 'POSTED') {
          const attached = await this.attachRequestToPostedJournal(input.request, journal.entry.id);
          return { request: attached, journal, idempotent: true };
        }
        throw new AccountingError('ACCOUNTING_DUPLICATE_POSTING');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async recordPostedRequest(
    input: PersistPostingRequestInput,
    journalEntryId: string,
  ): Promise<PostingRequestRow> {
    return this.attachRequestToPostedJournal(input, journalEntryId);
  }

  private async attachRequestToPostedJournal(
    input: PersistPostingRequestInput,
    journalEntryId: string,
  ): Promise<PostingRequestRow> {
    try {
      const inserted = await this.pool().query<PostingRequestRow>(
        `INSERT INTO acc.accounting_posting_requests (
           unit_id, origin_kind, event_kind, source_id, source_reference, idempotency_key,
           posting_rule_id, posting_rule_version_id, journal_entry_id, status, amount,
           currency_code, occurred_on, context, actor_identity_id
         ) VALUES (
           $1, $2::acc.posting_origin_kind, $3::acc.posting_event_kind, $4, $5, $6,
           $7, $8, $9, 'POSTED', $10, $11, $12::date, $13::jsonb, $14
         )
         RETURNING ${REQUEST_RETURNING}`,
        [
          input.unitId,
          input.originKind,
          input.eventKind,
          input.sourceId,
          input.sourceReference,
          input.idempotencyKey,
          input.postingRuleId,
          input.postingRuleVersionId,
          journalEntryId,
          input.amount,
          input.currencyCode,
          input.occurredOn,
          JSON.stringify(input.context),
          input.actorIdentityId,
        ],
      );
      return inserted.rows[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findRequestByEvent(input.originKind, input.eventKind, input.sourceId);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  /**
   * Rastreabilidade evento -> lancamento: pagina os pedidos de lancamento da unidade com o
   * numero do lancamento contabil gerado. Consulta pura, sem escrita; serve a superficie
   * "origem dos lancamentos" e a auditoria do fechamento.
   */
  async listRequestPage(
    filter: PostingRequestListFilter,
  ): Promise<{ total: number; items: PostingRequestListRow[] }> {
    const conditions: string[] = ['r.unit_id = $1'];
    const values: unknown[] = [filter.unitId];
    const push = (fragment: string, value: unknown): void => {
      values.push(value);
      conditions.push(fragment.replace('?', `$${values.length}`));
    };
    if (filter.status) {
      push('r.status = ?::acc.posting_request_status', filter.status);
    }
    if (filter.originKind) {
      push('r.origin_kind = ?::acc.posting_origin_kind', filter.originKind);
    }
    if (filter.eventKind) {
      push('r.event_kind = ?::acc.posting_event_kind', filter.eventKind);
    }
    if (filter.occurredFrom) {
      push('r.occurred_on >= ?::date', filter.occurredFrom);
    }
    if (filter.occurredTo) {
      push('r.occurred_on <= ?::date', filter.occurredTo);
    }
    const where = conditions.join(' AND ');
    const total = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acc.accounting_posting_requests r WHERE ${where}`,
      values,
    );
    const pageValues = [...values, filter.pageSize, filter.page * filter.pageSize];
    const rows = await this.pool().query<PostingRequestListRow>(
      `SELECT
         r.id, r.unit_id, r.origin_kind::text AS origin_kind, r.event_kind::text AS event_kind,
         r.source_id, r.source_reference, r.idempotency_key, r.posting_rule_id,
         r.posting_rule_version_id, r.journal_entry_id, r.status::text AS status,
         r.amount::text AS amount, r.currency_code, r.occurred_on::text AS occurred_on,
         r.context, r.actor_identity_id, r.created_at, r.updated_at,
         e.entry_number::text AS journal_entry_number,
         e.status::text AS journal_entry_status,
         e.posted_at AS journal_entry_posted_at
       FROM acc.accounting_posting_requests r
       LEFT JOIN acc.journal_entries e ON e.id = r.journal_entry_id
       WHERE ${where}
       ORDER BY r.occurred_on DESC, r.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pageValues,
    );
    return { total: Number(total.rows[0]?.count ?? '0'), items: rows.rows };
  }

  /** Contagem por situacao para os cartoes da superficie de rastreabilidade. */
  async countRequestStatuses(unitId: string): Promise<Record<string, number>> {
    const result = await this.pool().query<{ status: string; count: string }>(
      `SELECT status::text AS status, COUNT(*)::text AS count
       FROM acc.accounting_posting_requests
       WHERE unit_id = $1
       GROUP BY status`,
      [unitId],
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }
}

function requiredRow<T>(row: T | undefined): T {
  if (!row) {
    throw new AccountingError('ACCOUNTING_NOT_FOUND');
  }
  return row;
}

function normalizeVersion(row: PostingRuleVersionRow): PostingRuleVersionRow {
  return {
    ...row,
    required_context: parseRequiredContext(row.required_context),
  };
}

function parseRequiredContext(value: unknown): string[] {
  const parsed: unknown = Array.isArray(value) ? value : JSON.parse(String(value));
  if (!Array.isArray(parsed)) {
    throw new AccountingError('ACCOUNTING_VALIDATION_FAILED');
  }
  const context: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') {
      throw new AccountingError('ACCOUNTING_VALIDATION_FAILED');
    }
    context.push(item);
  }
  return context;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  FISCAL_PERIOD_CLOSE_RUN_STATUSES,
  FISCAL_PERIOD_STATUSES,
  FiscalPeriodError,
  assertFiscalPeriodCanClose,
  assertFiscalPeriodCanReopen,
  assertFiscalPeriodCloseAllowed,
  evaluateFiscalPeriodCloseChecks,
  fiscalPeriodCloseRunStatus,
  type FiscalPeriodCloseCheck,
  type FiscalPeriodCloseObservations,
} from '../domain/fiscal-period';
import {
  FISCAL_PERIOD_FAILURE_INJECTION,
  FISCAL_PERIOD_FAILURE_STAGES,
  FiscalPeriodFailureInjection,
} from '../domain/fiscal-period-failure-injection';
import type {
  FiscalPeriodCloseObservationsRow,
  FiscalPeriodRow,
} from './fiscal-period.repository.types';

const PERIOD_RETURNING = `
  id, unit_id, period_key, status::text AS status, row_version, closed_at, closed_by_identity_id,
  reopened_at, reopened_by_identity_id, reopen_reason, created_at, updated_at
`;

@Injectable()
export class FiscalPeriodRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(FISCAL_PERIOD_FAILURE_INJECTION)
    private readonly failures?: FiscalPeriodFailureInjection,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(periodId: string): Promise<FiscalPeriodRow | null> {
    const result = await this.pool().query<FiscalPeriodRow>(
      `SELECT ${PERIOD_RETURNING} FROM fis.fiscal_periods WHERE id = $1`,
      [periodId],
    );
    return result.rows[0] ?? null;
  }

  async findByUnitPeriod(unitId: string, periodKey: string): Promise<FiscalPeriodRow | null> {
    const result = await this.pool().query<FiscalPeriodRow>(
      `SELECT ${PERIOD_RETURNING} FROM fis.fiscal_periods WHERE unit_id = $1 AND period_key = $2`,
      [unitId, periodKey],
    );
    return result.rows[0] ?? null;
  }

  /** Lista paginada de periodos fiscais da unidade (consulta pura, sem escrita). */
  async listPeriodPage(input: {
    unitId: string;
    status?: string;
    periodKeyFrom?: string;
    periodKeyTo?: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: FiscalPeriodRow[] }> {
    const conditions: string[] = ['unit_id = $1'];
    const params: unknown[] = [input.unitId];
    const push = (sql: string, value: unknown): void => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };
    if (input.status) {
      push('status = ?::fis.fiscal_period_status', input.status);
    }
    if (input.periodKeyFrom) {
      push('period_key >= ?', input.periodKeyFrom);
    }
    if (input.periodKeyTo) {
      push('period_key <= ?', input.periodKeyTo);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fis.fiscal_periods ${where}`,
      params,
    );
    const pageParams = [...params, input.pageSize, input.page * input.pageSize];
    const rows = await this.pool().query<FiscalPeriodRow>(
      `SELECT ${PERIOD_RETURNING}
       FROM fis.fiscal_periods
       ${where}
       ORDER BY period_key DESC, created_at DESC, id DESC
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    );
    return { total: Number(count.rows[0]?.count ?? '0'), items: rows.rows };
  }

  async open(input: {
    unitId: string;
    periodKey: string;
    actorIdentityId: string;
  }): Promise<{ period: FiscalPeriodRow; idempotent: boolean }> {
    const existing = await this.findByUnitPeriod(input.unitId, input.periodKey);
    if (existing) {
      return { period: existing, idempotent: true };
    }
    try {
      const result = await this.pool().query<FiscalPeriodRow>(
        `INSERT INTO fis.fiscal_periods (unit_id, period_key, created_by_identity_id, updated_by_identity_id)
         VALUES ($1, $2, $3, $3)
         RETURNING ${PERIOD_RETURNING}`,
        [input.unitId, input.periodKey, input.actorIdentityId],
      );
      return { period: result.rows[0]!, idempotent: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.findByUnitPeriod(input.unitId, input.periodKey);
        if (raced) {
          return { period: raced, idempotent: true };
        }
        throw new FiscalPeriodError('FISCAL_PERIOD_DUPLICATE');
      }
      throw error;
    }
  }

  async close(input: {
    periodId: string;
    actorIdentityId: string;
  }): Promise<{ period: FiscalPeriodRow; checks: FiscalPeriodCloseCheck[]; idempotent: boolean }> {
    const client = await this.pool().connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const locked = await client.query<FiscalPeriodRow>(
        `SELECT ${PERIOD_RETURNING} FROM fis.fiscal_periods WHERE id = $1 FOR UPDATE`,
        [input.periodId],
      );
      const period = locked.rows[0];
      if (!period) {
        throw new FiscalPeriodError('FISCAL_PERIOD_NOT_FOUND');
      }
      assertFiscalPeriodCanClose(period.status);
      if (period.status === FISCAL_PERIOD_STATUSES.Closed) {
        await client.query('COMMIT');
        committed = true;
        return { period, checks: [], idempotent: true };
      }

      const observations = await this.observe(client, period.unit_id, period.period_key);
      const checks = evaluateFiscalPeriodCloseChecks(observations);
      this.failures?.consume(FISCAL_PERIOD_FAILURE_STAGES.AfterCloseChecks);
      const runStatus = fiscalPeriodCloseRunStatus(checks);
      if (runStatus === FISCAL_PERIOD_CLOSE_RUN_STATUSES.Blocked) {
        await this.persistRun(client, period.id, runStatus, checks, input.actorIdentityId);
        await client.query('COMMIT');
        committed = true;
        assertFiscalPeriodCloseAllowed(checks);
      }

      this.failures?.consume(FISCAL_PERIOD_FAILURE_STAGES.BeforeMarkClosed);
      await this.persistRun(client, period.id, runStatus, checks, input.actorIdentityId);
      const updated = await client.query<FiscalPeriodRow>(
        `UPDATE fis.fiscal_periods
         SET status = $2,
             closed_at = NOW(),
             closed_by_identity_id = $3,
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $3
         WHERE id = $1
         RETURNING ${PERIOD_RETURNING}`,
        [period.id, FISCAL_PERIOD_STATUSES.Closed, input.actorIdentityId],
      );
      await client.query('COMMIT');
      committed = true;
      return { period: updated.rows[0]!, checks, idempotent: false };
    } catch (error) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* already rolled back */
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async reopen(input: {
    periodId: string;
    reason: string;
    actorIdentityId: string;
  }): Promise<FiscalPeriodRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<FiscalPeriodRow>(
        `SELECT ${PERIOD_RETURNING} FROM fis.fiscal_periods WHERE id = $1 FOR UPDATE`,
        [input.periodId],
      );
      const period = locked.rows[0];
      if (!period) {
        throw new FiscalPeriodError('FISCAL_PERIOD_NOT_FOUND');
      }
      if (period.status === FISCAL_PERIOD_STATUSES.Open && period.reopened_at) {
        await client.query('COMMIT');
        return period;
      }
      assertFiscalPeriodCanReopen(period.status);
      const updated = await client.query<FiscalPeriodRow>(
        `UPDATE fis.fiscal_periods
         SET status = $2,
             closed_at = NULL,
             closed_by_identity_id = NULL,
             reopened_at = NOW(),
             reopened_by_identity_id = $3,
             reopen_reason = $4,
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $3
         WHERE id = $1
         RETURNING ${PERIOD_RETURNING}`,
        [period.id, FISCAL_PERIOD_STATUSES.Open, input.actorIdentityId, input.reason],
      );
      await client.query('COMMIT');
      return updated.rows[0]!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listCloseChecks(periodId: string): Promise<FiscalPeriodCloseCheck[]> {
    const result = await this.pool().query<FiscalPeriodCloseCheck>(
      `SELECT c.kind::text AS kind, c.result::text AS result, c.blocking, c.observed_count AS "observedCount", c.detail
       FROM fis.fiscal_period_close_check_results c
       INNER JOIN fis.fiscal_period_close_runs r ON r.id = c.close_run_id
       WHERE r.fiscal_period_id = $1
       ORDER BY r.created_at DESC, c.kind
       LIMIT 4`,
      [periodId],
    );
    return result.rows;
  }

  private async observe(
    client: PoolClient,
    unitId: string,
    periodKey: string,
  ): Promise<FiscalPeriodCloseObservations> {
    const result = await client.query<FiscalPeriodCloseObservationsRow>(
      `SELECT
         (
           SELECT count(*)::text
           FROM fis.fiscal_documents d
           WHERE d.unit_id = $1
             AND to_char(d.issued_on::date, 'YYYY-MM') = $2
             AND d.status::text NOT IN ('AUTHORIZED', 'CANCELLED')
         ) AS pending_documents,
         (
           SELECT count(*)::text
           FROM fis.tax_assessments a
           WHERE a.unit_id = $1
             AND a.period_key = $2
             AND a.status = 'DRAFT'
             AND a.supersedes_assessment_id IS NULL
         ) AS draft_assessments,
         (
           SELECT count(*)::text
           FROM fis.tax_assessments a
           WHERE a.unit_id = $1
             AND a.period_key = $2
             AND (
               (a.status = 'DRAFT' AND a.supersedes_assessment_id IS NOT NULL)
               OR (
                 a.status = 'ADJUSTED'
                 AND NOT EXISTS (
                   SELECT 1
                   FROM fis.tax_assessments s
                   WHERE s.supersedes_assessment_id = a.id
                     AND s.status = 'FINALIZED'
                 )
               )
             )
         ) AS incomplete_adjustments,
         (
           SELECT (
             (
               SELECT count(*)
               FROM fis.fiscal_documents d
               WHERE d.unit_id = $1
                 AND to_char(d.issued_on::date, 'YYYY-MM') = $2
                 AND d.status::text IN ('SUBMITTED', 'REJECTED')
             ) + (
               SELECT count(*)
               FROM fis.tax_obligations o
               WHERE o.unit_id = $1
                 AND o.period_key = $2
                 AND o.status = 'OPEN'
                 AND o.payable_id IS NULL
             )
           )::text
         ) AS critical_pendencies`,
      [unitId, periodKey],
    );
    const row = result.rows[0]!;
    return {
      pendingDocuments: Number(row.pending_documents),
      draftAssessments: Number(row.draft_assessments),
      incompleteAdjustments: Number(row.incomplete_adjustments),
      criticalPendencies: Number(row.critical_pendencies),
    };
  }

  private async persistRun(
    client: PoolClient,
    periodId: string,
    status: string,
    checks: FiscalPeriodCloseCheck[],
    actorIdentityId: string,
  ): Promise<void> {
    const runId = randomUUID();
    await client.query(
      `INSERT INTO fis.fiscal_period_close_runs (id, fiscal_period_id, status, created_by_identity_id)
       VALUES ($1, $2, $3::fis.fiscal_period_close_run_status, $4)`,
      [runId, periodId, status, actorIdentityId],
    );
    for (const item of checks) {
      await client.query(
        `INSERT INTO fis.fiscal_period_close_check_results (
           close_run_id, kind, result, blocking, observed_count, detail
         )
         VALUES ($1, $2::fis.fiscal_period_close_check_kind, $3::fis.fiscal_period_close_check_result, $4, $5, $6)`,
        [runId, item.kind, item.result, item.blocking, item.observedCount, item.detail],
      );
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

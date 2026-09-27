import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { BudgetError, asBudgetIsoDate } from '../domain/budget';
import type {
  BudgetLineRow,
  BudgetPeriodRow,
  BudgetRow,
  BudgetVersionRow,
} from './budget.repository.types';

const BUDGET_RETURNING = `
  id, unit_id, code, name, currency_code, status::text AS status, row_version, created_at, updated_at
`;

const VERSION_RETURNING = `
  id, budget_id, version_number, status::text AS status, approved_at, approved_by_identity_id,
  created_by_identity_id, created_at
`;

const PERIOD_RETURNING = `
  id, budget_version_id, period_key, starts_on::text AS starts_on, ends_on::text AS ends_on, status::text AS status
`;

const LINE_RETURNING = `
  id, budget_period_id, line_number, amount::text AS amount, currency_code, cost_center_code,
  expense_category_id, account_id
`;

@Injectable()
export class BudgetRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  /**
   * Página de orçamentos sob o MESMO predicado da contagem. A linha é o próprio registro
   * (código, nome, moeda, estado) — sem junção com versões, períodos ou linhas.
   */
  async listBudgetPage(input: {
    whereClause: string;
    params: unknown[];
    limit: number;
    offset: number;
  }): Promise<BudgetRow[]> {
    const result = await this.pool().query<BudgetRow>(
      `SELECT ${BUDGET_RETURNING}
       FROM fin.budgets
       WHERE ${input.whereClause}
       ORDER BY code ASC, id ASC
       LIMIT $${input.params.length + 1}
       OFFSET $${input.params.length + 2}`,
      [...input.params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countBudgetList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM fin.budgets WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async findBudgetById(budgetId: string): Promise<BudgetRow | null> {    const result = await this.pool().query<BudgetRow>(
      `SELECT ${BUDGET_RETURNING} FROM fin.budgets WHERE id = $1`,
      [budgetId],
    );
    return result.rows[0] ?? null;
  }

  async findDraftVersion(budgetId: string): Promise<BudgetVersionRow | null> {
    const result = await this.pool().query<BudgetVersionRow>(
      `SELECT ${VERSION_RETURNING} FROM fin.budget_versions WHERE budget_id = $1 AND status = 'DRAFT'`,
      [budgetId],
    );
    return result.rows[0] ?? null;
  }

  async findLatestApprovedVersion(budgetId: string): Promise<BudgetVersionRow | null> {
    const result = await this.pool().query<BudgetVersionRow>(
      `SELECT ${VERSION_RETURNING}
       FROM fin.budget_versions
       WHERE budget_id = $1 AND status = 'APPROVED'
       ORDER BY version_number DESC
       LIMIT 1`,
      [budgetId],
    );
    return result.rows[0] ?? null;
  }

  async listVersions(budgetId: string): Promise<BudgetVersionRow[]> {
    const result = await this.pool().query<BudgetVersionRow>(
      `SELECT ${VERSION_RETURNING} FROM fin.budget_versions WHERE budget_id = $1 ORDER BY version_number`,
      [budgetId],
    );
    return result.rows;
  }

  async listPeriods(versionId: string): Promise<BudgetPeriodRow[]> {
    const result = await this.pool().query<BudgetPeriodRow>(
      `SELECT ${PERIOD_RETURNING} FROM fin.budget_periods WHERE budget_version_id = $1 ORDER BY starts_on`,
      [versionId],
    );
    return result.rows;
  }

  async listLines(periodId: string): Promise<BudgetLineRow[]> {
    const result = await this.pool().query<BudgetLineRow>(
      `SELECT ${LINE_RETURNING} FROM fin.budget_lines WHERE budget_period_id = $1 ORDER BY line_number`,
      [periodId],
    );
    return result.rows;
  }

  async findPeriodById(periodId: string): Promise<BudgetPeriodRow | null> {
    const result = await this.pool().query<BudgetPeriodRow>(
      `SELECT ${PERIOD_RETURNING} FROM fin.budget_periods WHERE id = $1`,
      [periodId],
    );
    return result.rows[0] ?? null;
  }

  async findVersionById(versionId: string): Promise<BudgetVersionRow | null> {
    const result = await this.pool().query<BudgetVersionRow>(
      `SELECT ${VERSION_RETURNING} FROM fin.budget_versions WHERE id = $1`,
      [versionId],
    );
    return result.rows[0] ?? null;
  }

  async createBudget(input: {
    unitId: string;
    code: string;
    name: string;
    currencyCode: string;
    actorIdentityId: string;
  }): Promise<{ budget: BudgetRow; version: BudgetVersionRow }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const budget = await client.query<BudgetRow>(
        `INSERT INTO fin.budgets (
           unit_id, code, name, currency_code, created_by_identity_id, updated_by_identity_id
         ) VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING ${BUDGET_RETURNING}`,
        [input.unitId, input.code, input.name, input.currencyCode, input.actorIdentityId],
      );
      const version = await client.query<BudgetVersionRow>(
        `INSERT INTO fin.budget_versions (budget_id, version_number, created_by_identity_id)
         VALUES ($1, 1, $2)
         RETURNING ${VERSION_RETURNING}`,
        [budget.rows[0]!.id, input.actorIdentityId],
      );
      await client.query('COMMIT');
      return { budget: budget.rows[0]!, version: version.rows[0]! };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new BudgetError('BUDGET_DUPLICATE');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async createNextVersion(input: {
    budgetId: string;
    actorIdentityId: string;
  }): Promise<BudgetVersionRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const source = await client.query<BudgetVersionRow>(
        `SELECT ${VERSION_RETURNING}
         FROM fin.budget_versions
         WHERE budget_id = $1 AND status = 'APPROVED'
         ORDER BY version_number DESC
         LIMIT 1
         FOR UPDATE`,
        [input.budgetId],
      );
      const approved = source.rows[0];
      if (!approved) {
        throw new BudgetError('BUDGET_NOT_APPROVED');
      }
      const draft = await client.query<BudgetVersionRow>(
        `INSERT INTO fin.budget_versions (budget_id, version_number, created_by_identity_id)
         VALUES ($1, $2, $3)
         RETURNING ${VERSION_RETURNING}`,
        [input.budgetId, approved.version_number + 1, input.actorIdentityId],
      );
      const periods = await client.query<BudgetPeriodRow>(
        `SELECT ${PERIOD_RETURNING} FROM fin.budget_periods WHERE budget_version_id = $1`,
        [approved.id],
      );
      for (const period of periods.rows) {
        const copied = await client.query<BudgetPeriodRow>(
          `INSERT INTO fin.budget_periods (
             budget_version_id, period_key, starts_on, ends_on, created_by_identity_id
           ) VALUES ($1, $2, $3, $4, $5)
           RETURNING ${PERIOD_RETURNING}`,
          [
            draft.rows[0]!.id,
            period.period_key,
            asBudgetIsoDate(period.starts_on),
            asBudgetIsoDate(period.ends_on),
            input.actorIdentityId,
          ],
        );
        const lines = await client.query<BudgetLineRow>(
          `SELECT ${LINE_RETURNING} FROM fin.budget_lines WHERE budget_period_id = $1`,
          [period.id],
        );
        for (const line of lines.rows) {
          await client.query(
            `INSERT INTO fin.budget_lines (
               budget_period_id, line_number, amount, currency_code, cost_center_code,
               expense_category_id, account_id, created_by_identity_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              copied.rows[0]!.id,
              line.line_number,
              line.amount,
              line.currency_code,
              line.cost_center_code,
              line.expense_category_id,
              line.account_id,
              input.actorIdentityId,
            ],
          );
        }
      }
      await client.query('COMMIT');
      return draft.rows[0]!;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new BudgetError('BUDGET_DRAFT_EXISTS');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async addPeriod(input: {
    versionId: string;
    periodKey: string;
    startsOn: string;
    endsOn: string;
    actorIdentityId: string;
  }): Promise<BudgetPeriodRow> {
    try {
      const result = await this.pool().query<BudgetPeriodRow>(
        `INSERT INTO fin.budget_periods (
           budget_version_id, period_key, starts_on, ends_on, created_by_identity_id
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING ${PERIOD_RETURNING}`,
        [input.versionId, input.periodKey, input.startsOn, input.endsOn, input.actorIdentityId],
      );
      return result.rows[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BudgetError('BUDGET_PERIOD_DUPLICATE');
      }
      if (isImmutable(error)) {
        throw new BudgetError('BUDGET_VERSION_IMMUTABLE');
      }
      throw error;
    }
  }

  async addLine(input: {
    periodId: string;
    amount: string;
    currencyCode: string;
    costCenterCode: string | null;
    expenseCategoryId: string | null;
    accountId: string | null;
    actorIdentityId: string;
  }): Promise<BudgetLineRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const next = await client.query<{ line_number: number }>(
        `SELECT COALESCE(max(line_number), 0) + 1 AS line_number FROM fin.budget_lines WHERE budget_period_id = $1`,
        [input.periodId],
      );
      const result = await client.query<BudgetLineRow>(
        `INSERT INTO fin.budget_lines (
           budget_period_id, line_number, amount, currency_code, cost_center_code,
           expense_category_id, account_id, created_by_identity_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${LINE_RETURNING}`,
        [
          input.periodId,
          next.rows[0]!.line_number,
          input.amount,
          input.currencyCode,
          input.costCenterCode,
          input.expenseCategoryId,
          input.accountId,
          input.actorIdentityId,
        ],
      );
      await client.query('COMMIT');
      return result.rows[0]!;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isImmutable(error)) {
        throw new BudgetError('BUDGET_VERSION_IMMUTABLE');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async approveVersion(input: {
    versionId: string;
    actorIdentityId: string;
  }): Promise<BudgetVersionRow> {
    const result = await this.pool().query<BudgetVersionRow>(
      `UPDATE fin.budget_versions
       SET status = 'APPROVED',
           approved_at = NOW(),
           approved_by_identity_id = $2
       WHERE id = $1 AND status = 'DRAFT'
       RETURNING ${VERSION_RETURNING}`,
      [input.versionId, input.actorIdentityId],
    );
    if (!result.rows[0]) {
      throw new BudgetError('BUDGET_NOT_DRAFT');
    }
    return result.rows[0];
  }

  async countPostedJournals(): Promise<number> {
    const result = await this.pool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM rpt.read_journal_entries WHERE status = 'POSTED'`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async postedActualForAccount(input: {
    unitId: string;
    accountId: string;
    currencyCode: string;
    startsOn: string;
    endsOn: string;
  }): Promise<string> {
    const result = await this.pool().query<{ actual: string }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount::numeric ELSE 0 END), 0)::numeric(18, 4)::text AS actual
       FROM rpt.read_posted_journal_lines
       WHERE unit_id = $1
         AND account_id = $2
         AND currency_code = $3
         AND occurred_on BETWEEN $4 AND $5`,
      [input.unitId, input.accountId, input.currencyCode, input.startsOn, input.endsOn],
    );
    return result.rows[0]?.actual ?? '0';
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

function isImmutable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('BUDGET_VERSION_IMMUTABLE');
}

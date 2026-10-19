import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { PayrollError } from '../domain/payroll';
import type {
  EmploymentContractRow,
  PersistPayrollCalculationInput,
  PersistPayrollEventInput,
  PayrollCalculationRow,
  PayrollEventRow,
  PayrollPeriodRow,
  PayrollResultRow,
} from './payroll.repository.types';

const CONTRACT_RETURNING = `
  id, unit_id, code, display_name, status::text AS status,
  person_ref, starts_on::text AS starts_on, ends_on::text AS ends_on
`;
const PERIOD_RETURNING = `
  id, unit_id, competence_year, competence_month,
  starts_on::text AS starts_on, ends_on::text AS ends_on,
  status::text AS status, row_version, created_by_identity_id, updated_by_identity_id
`;
const EVENT_RETURNING = `
  id, unit_id, payroll_period_id, employment_contract_id,
  event_kind::text AS event_kind, amount::text AS amount,
  component_label, description, formula_status::text AS formula_status, idempotency_key
`;
const CALCULATION_RETURNING = `
  id, unit_id, payroll_period_id, employment_contract_id,
  calculation_number, formula_status::text AS formula_status, created_by_identity_id
`;
const RESULT_RETURNING = `
  r.id, r.payroll_calculation_id, c.employment_contract_id,
  r.earning_total::text AS earning_total, r.deduction_total::text AS deduction_total,
  r.employer_charge_total::text AS employer_charge_total, r.net_total::text AS net_total
`;

@Injectable()
export class PayrollRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async createContract(input: {
    unitId: string;
    code: string;
    displayName: string;
    startsOn: string;
    endsOn: string | null;
    personRef: string | null;
    actorIdentityId: string;
  }): Promise<EmploymentContractRow> {
    const result = await this.pool().query<EmploymentContractRow>(
      `INSERT INTO pay.employment_contracts (
         unit_id, code, display_name, person_ref, starts_on, ends_on,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $7)
       RETURNING ${CONTRACT_RETURNING}`,
      [
        input.unitId,
        input.code,
        input.displayName,
        input.personRef,
        input.startsOn,
        input.endsOn,
        input.actorIdentityId,
      ],
    );
    return requiredRow(result.rows[0]);
  }

  async listContracts(input: {
    unitId: string;
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: EmploymentContractRow[]; total: number }> {
    const values: unknown[] = [input.unitId];
    const conditions = ['unit_id = $1'];
    if (input.q) {
      values.push(`%${input.q}%`);
      conditions.push(`(code ILIKE $${values.length} OR display_name ILIKE $${values.length})`);
    }
    const where = conditions.join(' AND ');
    const totalResult = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM pay.employment_contracts
        WHERE ${where}`,
      values,
    );
    const pageValues = [...values, input.pageSize, input.page * input.pageSize];
    const result = await this.pool().query<EmploymentContractRow>(
      `SELECT ${CONTRACT_RETURNING}
         FROM pay.employment_contracts
        WHERE ${where}
        ORDER BY display_name ASC, code ASC, id ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pageValues,
    );
    return {
      items: result.rows,
      total: Number(totalResult.rows[0]?.total ?? '0'),
    };
  }

  async findContractById(id: string): Promise<EmploymentContractRow | null> {
    const result = await this.pool().query<EmploymentContractRow>(
      `SELECT ${CONTRACT_RETURNING} FROM pay.employment_contracts WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async openPeriod(input: {
    unitId: string;
    competenceYear: number;
    competenceMonth: number;
    startsOn: string;
    endsOn: string;
    actorIdentityId: string;
  }): Promise<PayrollPeriodRow> {
    const result = await this.pool().query<PayrollPeriodRow>(
      `INSERT INTO pay.payroll_periods (
         unit_id, competence_year, competence_month, starts_on, ends_on,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $6)
       RETURNING ${PERIOD_RETURNING}`,
      [
        input.unitId,
        input.competenceYear,
        input.competenceMonth,
        input.startsOn,
        input.endsOn,
        input.actorIdentityId,
      ],
    );
    return requiredRow(result.rows[0]);
  }

  async listPeriods(input: {
    unitId: string;
    status?: string;
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: PayrollPeriodRow[]; total: number }> {
    const values: unknown[] = [input.unitId];
    const conditions = ['unit_id = $1'];
    if (input.status) {
      values.push(input.status);
      conditions.push(`status::text = ${values.length}`);
    }
    if (input.q) {
      values.push(`%${input.q}%`);
      const position = values.length;
      conditions.push(
        `(
          (LPAD(competence_month::text, 2, '0') || '/' || competence_year::text) ILIKE ${position}
          OR (competence_year::text || '-' || LPAD(competence_month::text, 2, '0')) ILIKE ${position}
          OR status::text ILIKE ${position}
        )`,
      );
    }
    const where = conditions.join(' AND ');
    const totalResult = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM pay.payroll_periods
        WHERE ${where}`,
      values,
    );
    const pageValues = [...values, input.pageSize, input.page * input.pageSize];
    const result = await this.pool().query<PayrollPeriodRow>(
      `SELECT ${PERIOD_RETURNING}
         FROM pay.payroll_periods
        WHERE ${where}
        ORDER BY competence_year DESC, competence_month DESC, id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pageValues,
    );
    return {
      items: result.rows,
      total: Number(totalResult.rows[0]?.total ?? '0'),
    };
  }

  async findPeriodById(id: string): Promise<PayrollPeriodRow | null> {
    const result = await this.pool().query<PayrollPeriodRow>(
      `SELECT ${PERIOD_RETURNING} FROM pay.payroll_periods WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findLatestCalculationActor(payrollPeriodId: string): Promise<string | null> {
    const result = await this.pool().query<{ created_by_identity_id: string }>(
      `SELECT created_by_identity_id
       FROM pay.payroll_calculations
       WHERE payroll_period_id = $1
       ORDER BY calculation_number DESC, calculated_at DESC
       LIMIT 1`,
      [payrollPeriodId],
    );
    return result.rows[0]?.created_by_identity_id ?? null;
  }

  async findEventByIdempotency(
    payrollPeriodId: string,
    idempotencyKey: string,
  ): Promise<PayrollEventRow | null> {
    const result = await this.pool().query<PayrollEventRow>(
      `SELECT ${EVENT_RETURNING}
       FROM pay.payroll_events
       WHERE payroll_period_id = $1 AND idempotency_key = $2`,
      [payrollPeriodId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async listEventsForPeriod(payrollPeriodId: string): Promise<PayrollEventRow[]> {
    const result = await this.pool().query<PayrollEventRow>(
      `SELECT ${EVENT_RETURNING}
       FROM pay.payroll_events
       WHERE payroll_period_id = $1
       ORDER BY created_at, id`,
      [payrollPeriodId],
    );
    return result.rows;
  }

  async listLatestResults(payrollPeriodId: string): Promise<PayrollResultRow[]> {
    const result = await this.pool().query<PayrollResultRow>(
      `SELECT ${RESULT_RETURNING}
       FROM pay.payroll_results r
       INNER JOIN pay.payroll_calculations c ON c.id = r.payroll_calculation_id
       WHERE c.payroll_period_id = $1
         AND c.calculation_number = (
           SELECT MAX(c2.calculation_number)
           FROM pay.payroll_calculations c2
           WHERE c2.payroll_period_id = c.payroll_period_id
             AND c2.employment_contract_id = c.employment_contract_id
         )
       ORDER BY c.employment_contract_id`,
      [payrollPeriodId],
    );
    return result.rows;
  }

  async countEventsByIdempotency(payrollPeriodId: string, idempotencyKey: string): Promise<number> {
    const result = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM pay.payroll_events
       WHERE payroll_period_id = $1 AND idempotency_key = $2`,
      [payrollPeriodId, idempotencyKey],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async withLockedPeriod<T>(
    payrollPeriodId: string,
    run: (client: PoolClient, period: PayrollPeriodRow) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<PayrollPeriodRow>(
        `SELECT ${PERIOD_RETURNING}
         FROM pay.payroll_periods
         WHERE id = $1
         FOR UPDATE`,
        [payrollPeriodId],
      );
      const period = locked.rows[0];
      if (!period) {
        throw new PayrollError('PAYROLL_NOT_FOUND');
      }
      const result = await run(client, period);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async insertEvent(client: PoolClient, input: PersistPayrollEventInput): Promise<PayrollEventRow> {
    await client.query('SAVEPOINT payroll_event_insert');
    try {
      const result = await client.query<PayrollEventRow>(
        `INSERT INTO pay.payroll_events (
           unit_id, payroll_period_id, employment_contract_id, event_kind, amount,
           component_label, description, idempotency_key, source_kind, source_id,
           created_by_identity_id
         ) VALUES (
           $1, $2, $3, $4::pay.payroll_event_kind, $5, $6, $7, $8, $9, $10, $11
         )
         RETURNING ${EVENT_RETURNING}`,
        [
          input.unitId,
          input.payrollPeriodId,
          input.employmentContractId,
          input.eventKind,
          input.amount,
          input.componentLabel,
          input.description,
          input.idempotencyKey,
          input.sourceKind,
          input.sourceId,
          input.actorIdentityId,
        ],
      );
      await client.query('RELEASE SAVEPOINT payroll_event_insert');
      return requiredRow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT payroll_event_insert');
      if (isUniqueViolation(error)) {
        const existing = await client.query<PayrollEventRow>(
          `SELECT ${EVENT_RETURNING}
           FROM pay.payroll_events
           WHERE payroll_period_id = $1 AND idempotency_key = $2`,
          [input.payrollPeriodId, input.idempotencyKey],
        );
        const row = existing.rows[0];
        if (row) {
          return row;
        }
      }
      throw error;
    }
  }

  async insertCalculation(
    client: PoolClient,
    input: PersistPayrollCalculationInput,
  ): Promise<{ calculation: PayrollCalculationRow; result: PayrollResultRow }> {
    const calculation = await client.query<PayrollCalculationRow>(
      `INSERT INTO pay.payroll_calculations (
         unit_id, payroll_period_id, employment_contract_id, calculation_number,
         inputs, created_by_identity_id
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING ${CALCULATION_RETURNING}`,
      [
        input.unitId,
        input.payrollPeriodId,
        input.employmentContractId,
        input.calculationNumber,
        JSON.stringify(input.inputs),
        input.actorIdentityId,
      ],
    );
    const calculationRow = requiredRow(calculation.rows[0]);
    const result = await client.query<PayrollResultRow>(
      `INSERT INTO pay.payroll_results (
         payroll_calculation_id, earning_total, deduction_total,
         employer_charge_total, net_total, detail_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, payroll_calculation_id, $7::uuid AS employment_contract_id,
                 earning_total::text AS earning_total, deduction_total::text AS deduction_total,
                 employer_charge_total::text AS employer_charge_total, net_total::text AS net_total`,
      [
        calculationRow.id,
        input.earningTotal,
        input.deductionTotal,
        input.employerChargeTotal,
        input.netTotal,
        JSON.stringify({ eventIds: (input.inputs as { eventIds?: string[] }).eventIds ?? [] }),
        input.employmentContractId,
      ],
    );
    return { calculation: calculationRow, result: requiredRow(result.rows[0]) };
  }

  async nextCalculationNumber(
    client: PoolClient,
    payrollPeriodId: string,
    employmentContractId: string,
  ): Promise<number> {
    const result = await client.query<{ next: string }>(
      `SELECT COALESCE(MAX(calculation_number), 0) + 1 AS next
       FROM pay.payroll_calculations
       WHERE payroll_period_id = $1 AND employment_contract_id = $2`,
      [payrollPeriodId, employmentContractId],
    );
    return Number(result.rows[0]?.next ?? '1');
  }

  async markCalculated(
    client: PoolClient,
    payrollPeriodId: string,
    actorIdentityId: string,
  ): Promise<PayrollPeriodRow> {
    const result = await client.query<PayrollPeriodRow>(
      `UPDATE pay.payroll_periods
       SET status = 'CALCULATED',
           calculated_at = NOW(),
           updated_at = NOW(),
           updated_by_identity_id = $2,
           row_version = row_version + 1
       WHERE id = $1
       RETURNING ${PERIOD_RETURNING}`,
      [payrollPeriodId, actorIdentityId],
    );
    return requiredRow(result.rows[0]);
  }

  async markClosed(
    client: PoolClient,
    payrollPeriodId: string,
    actorIdentityId: string,
  ): Promise<PayrollPeriodRow> {
    const result = await client.query<PayrollPeriodRow>(
      `UPDATE pay.payroll_periods
       SET status = 'CLOSED',
           closed_at = NOW(),
           updated_at = NOW(),
           updated_by_identity_id = $2,
           row_version = row_version + 1
       WHERE id = $1
       RETURNING ${PERIOD_RETURNING}`,
      [payrollPeriodId, actorIdentityId],
    );
    return requiredRow(result.rows[0]);
  }

  async markReopened(
    client: PoolClient,
    payrollPeriodId: string,
    actorIdentityId: string,
  ): Promise<PayrollPeriodRow> {
    const result = await client.query<PayrollPeriodRow>(
      `UPDATE pay.payroll_periods
       SET status = 'OPEN',
           reopened_at = NOW(),
           calculated_at = NULL,
           closed_at = NULL,
           updated_at = NOW(),
           updated_by_identity_id = $2,
           row_version = row_version + 1
       WHERE id = $1
       RETURNING ${PERIOD_RETURNING}`,
      [payrollPeriodId, actorIdentityId],
    );
    return requiredRow(result.rows[0]);
  }
}

function requiredRow<T>(row: T | undefined): T {
  if (!row) {
    throw new PayrollError('PAYROLL_NOT_FOUND');
  }
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

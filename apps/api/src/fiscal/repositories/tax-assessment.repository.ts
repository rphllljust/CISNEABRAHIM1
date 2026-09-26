import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { TAX_ASSESSMENT_EVENTS, TAX_ASSESSMENT_STATUSES, TAX_OBLIGATION_STATUSES, TaxAssessmentError } from '../domain/tax-assessment';
import {
  TAX_PAYABLE_FAILURE_INJECTION,
  TAX_PAYABLE_FAILURE_STAGES,
  TaxPayableFailureInjection,
} from '../domain/tax-payable-failure-injection';
import type {
  AttachPayableSnapshotInput,
  CancelTaxObligationPersistenceInput,
  CreateTaxAssessmentPersistenceInput,
  FinalizeTaxAssessmentPersistenceInput,
  TaxAssessmentAggregate,
  TaxAssessmentEventRow,
  TaxAssessmentListRow,
  TaxAssessmentRow,
  TaxObligationRow,
} from './tax-assessment.repository.types';

const ASSESSMENT_RETURNING = `
  id, unit_id, tax_calculation_id, tax_rule_id, tax_rule_version_id, tax_component, period_key,
  currency_code, assessed_amount::text AS assessed_amount, status::text AS status,
  supersedes_assessment_id, idempotency_key, row_version, finalized_at, cancelled_at, cancel_reason,
  created_at, updated_at
`;

const OBLIGATION_RETURNING = `
  id, tax_assessment_id, unit_id, tax_rule_id, tax_component, period_key, currency_code,
  amount::text AS amount, status::text AS status, origin_calculation_id, payable_id,
  payable_principal_snapshot::text AS payable_principal_snapshot, cancelled_at, cancel_reason, created_at
`;

const EVENT_RETURNING = `
  id, tax_assessment_id, event_type::text AS event_type, payload, occurred_at, actor_identity_id
`;

/** Listagem: avaliacao + obrigacao vinculada (LEFT JOIN, sem N+1). */
const ASSESSMENT_LIST_SELECT = `
  a.id, a.unit_id, a.tax_calculation_id, a.tax_rule_id, a.tax_rule_version_id, a.tax_component,
  a.period_key, a.currency_code, a.assessed_amount::text AS assessed_amount,
  a.status::text AS status, a.supersedes_assessment_id, a.idempotency_key, a.row_version,
  a.finalized_at, a.cancelled_at, a.cancel_reason, a.created_at, a.updated_at,
  o.id AS obligation_id,
  o.status::text AS obligation_status,
  o.amount::text AS obligation_amount,
  o.payable_id AS obligation_payable_id
`;

@Injectable()
export class TaxAssessmentRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(TAX_PAYABLE_FAILURE_INJECTION)
    private readonly failures?: TaxPayableFailureInjection,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(assessmentId: string): Promise<TaxAssessmentAggregate | null> {
    const assessment = await this.pool().query<TaxAssessmentRow>(
      `SELECT ${ASSESSMENT_RETURNING} FROM fis.tax_assessments WHERE id = $1`,
      [assessmentId],
    );
    if (!assessment.rows[0]) {
      return null;
    }
    const [obligation, events] = await Promise.all([
      this.findObligationByAssessmentId(assessmentId),
      this.listEvents(assessmentId),
    ]);
    return { assessment: assessment.rows[0], obligation, events };
  }

  async findByIdempotency(unitId: string, idempotencyKey: string): Promise<TaxAssessmentAggregate | null> {
    const assessment = await this.pool().query<TaxAssessmentRow>(
      `SELECT ${ASSESSMENT_RETURNING}
       FROM fis.tax_assessments
       WHERE unit_id = $1 AND idempotency_key = $2`,
      [unitId, idempotencyKey],
    );
    if (!assessment.rows[0]) {
      return null;
    }
    return this.findById(assessment.rows[0].id);
  }

  /**
   * Lista paginada de apuracoes da unidade, com a obrigacao tributaria vinculada.
   * Consulta pura para a superficie de apuracao (situacao, competencia e componente).
   */
  async listAssessmentPage(input: {
    unitId: string;
    status?: string[] | string;
    periodKey?: string;
    taxComponent?: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: TaxAssessmentListRow[] }> {
    const conditions: string[] = ['a.unit_id = $1'];
    const params: unknown[] = [input.unitId];
    const push = (sql: string, value: unknown): void => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };
    if (input.status) {
      const statuses = Array.isArray(input.status) ? input.status : [input.status];
      push('a.status = ANY(?::fis.tax_assessment_status[])', statuses);
    }
    if (input.periodKey) {
      push('a.period_key = ?', input.periodKey);
    }
    if (input.taxComponent) {
      push('a.tax_component = ?', input.taxComponent);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fis.tax_assessments a ${where}`,
      params,
    );
    const pageParams = [...params, input.pageSize, input.page * input.pageSize];
    const rows = await this.pool().query<TaxAssessmentListRow>(
      `SELECT ${ASSESSMENT_LIST_SELECT}
       FROM fis.tax_assessments a
       LEFT JOIN fis.tax_obligations o ON o.tax_assessment_id = a.id
       ${where}
       ORDER BY a.period_key DESC, a.created_at DESC, a.id DESC
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    );
    return { total: Number(count.rows[0]?.count ?? '0'), items: rows.rows };
  }

  async findActiveByTaxPeriod(
    unitId: string,
    taxRuleId: string,
    periodKey: string,
  ): Promise<TaxAssessmentRow | null> {
    const result = await this.pool().query<TaxAssessmentRow>(
      `SELECT ${ASSESSMENT_RETURNING}
       FROM fis.tax_assessments
       WHERE unit_id = $1 AND tax_rule_id = $2 AND period_key = $3
         AND status IN ('DRAFT', 'FINALIZED')`,
      [unitId, taxRuleId, periodKey],
    );
    return result.rows[0] ?? null;
  }

  async findObligationById(obligationId: string): Promise<TaxObligationRow | null> {
    const result = await this.pool().query<TaxObligationRow>(
      `SELECT ${OBLIGATION_RETURNING} FROM fis.tax_obligations WHERE id = $1`,
      [obligationId],
    );
    return result.rows[0] ?? null;
  }

  async findObligationByAssessmentId(assessmentId: string): Promise<TaxObligationRow | null> {
    const result = await this.pool().query<TaxObligationRow>(
      `SELECT ${OBLIGATION_RETURNING}
       FROM fis.tax_obligations
       WHERE tax_assessment_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [assessmentId],
    );
    return result.rows[0] ?? null;
  }

  async listEvents(assessmentId: string): Promise<TaxAssessmentEventRow[]> {
    const result = await this.pool().query<TaxAssessmentEventRow>(
      `SELECT ${EVENT_RETURNING}
       FROM fis.tax_assessment_events
       WHERE tax_assessment_id = $1
       ORDER BY occurred_at, id`,
      [assessmentId],
    );
    return result.rows;
  }

  async countAssessments(): Promise<number> {
    const result = await this.pool().query<{ count: string }>(`SELECT count(*)::text AS count FROM fis.tax_assessments`);
    return Number(result.rows[0]?.count ?? 0);
  }

  async countObligations(): Promise<number> {
    const result = await this.pool().query<{ count: string }>(`SELECT count(*)::text AS count FROM fis.tax_obligations`);
    return Number(result.rows[0]?.count ?? 0);
  }

  async createDraft(
    input: CreateTaxAssessmentPersistenceInput,
  ): Promise<{ aggregate: TaxAssessmentAggregate; idempotent: boolean }> {
    const existing = await this.findByIdempotency(input.unitId, input.idempotencyKey);
    if (existing) {
      return { aggregate: existing, idempotent: true };
    }
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const assessmentId = randomUUID();
      const inserted = await client.query<TaxAssessmentRow>(
        `INSERT INTO fis.tax_assessments (
           id, unit_id, tax_calculation_id, tax_rule_id, tax_rule_version_id, tax_component,
           period_key, currency_code, assessed_amount, supersedes_assessment_id, idempotency_key,
           created_by_identity_id, updated_by_identity_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
         RETURNING ${ASSESSMENT_RETURNING}`,
        [
          assessmentId,
          input.unitId,
          input.taxCalculationId,
          input.taxRuleId,
          input.taxRuleVersionId,
          input.taxComponent,
          input.periodKey,
          input.currencyCode,
          input.assessedAmount,
          input.supersedesAssessmentId ?? null,
          input.idempotencyKey,
          input.actorIdentityId,
        ],
      );
      await this.insertEvent(client, assessmentId, TAX_ASSESSMENT_EVENTS.Created, {
        taxCalculationId: input.taxCalculationId,
        periodKey: input.periodKey,
        assessedAmount: input.assessedAmount,
      }, input.actorIdentityId);
      await client.query('COMMIT');
      return {
        aggregate: { assessment: inserted.rows[0]!, obligation: null, events: await this.listEvents(assessmentId) },
        idempotent: false,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const raced = await this.findByIdempotency(input.unitId, input.idempotencyKey);
        if (raced) {
          return { aggregate: raced, idempotent: true };
        }
        throw new TaxAssessmentError('TAX_ASSESSMENT_DUPLICATE');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async finalize(
    input: FinalizeTaxAssessmentPersistenceInput,
  ): Promise<{ aggregate: TaxAssessmentAggregate; idempotent: boolean }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<TaxAssessmentRow>(
        `SELECT ${ASSESSMENT_RETURNING} FROM fis.tax_assessments WHERE id = $1 FOR UPDATE`,
        [input.assessmentId],
      );
      const assessment = locked.rows[0];
      if (!assessment) {
        throw new TaxAssessmentError('TAX_ASSESSMENT_NOT_FOUND');
      }
      if (assessment.status === TAX_ASSESSMENT_STATUSES.Finalized) {
        const obligation = await this.findObligationWithClient(client, assessment.id);
        await client.query('COMMIT');
        return {
          aggregate: { assessment, obligation, events: await this.listEvents(assessment.id) },
          idempotent: true,
        };
      }
      if (assessment.status !== TAX_ASSESSMENT_STATUSES.Draft) {
        throw new TaxAssessmentError('TAX_ASSESSMENT_INVALID_TRANSITION');
      }

      const obligationId = randomUUID();
      const obligation = await client.query<TaxObligationRow>(
        `INSERT INTO fis.tax_obligations (
           id, tax_assessment_id, unit_id, tax_rule_id, tax_component, period_key,
           currency_code, amount, origin_calculation_id, created_by_identity_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${OBLIGATION_RETURNING}`,
        [
          obligationId,
          assessment.id,
          assessment.unit_id,
          assessment.tax_rule_id,
          assessment.tax_component,
          assessment.period_key,
          assessment.currency_code,
          assessment.assessed_amount,
          assessment.tax_calculation_id,
          input.actorIdentityId,
        ],
      );
      this.failures?.consume(TAX_PAYABLE_FAILURE_STAGES.AfterObligationInsert);
      const updated = await client.query<TaxAssessmentRow>(
        `UPDATE fis.tax_assessments
         SET status = $2,
             finalized_at = NOW(),
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $3
         WHERE id = $1
         RETURNING ${ASSESSMENT_RETURNING}`,
        [assessment.id, TAX_ASSESSMENT_STATUSES.Finalized, input.actorIdentityId],
      );
      await this.insertEvent(client, assessment.id, TAX_ASSESSMENT_EVENTS.Finalized, {
        obligationId,
        amount: assessment.assessed_amount,
        periodKey: assessment.period_key,
        taxComponent: assessment.tax_component,
      }, input.actorIdentityId);
      await client.query('COMMIT');
      return {
        aggregate: {
          assessment: updated.rows[0]!,
          obligation: obligation.rows[0]!,
          events: await this.listEvents(assessment.id),
        },
        idempotent: false,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const raced = await this.findById(input.assessmentId);
        if (raced?.assessment.status === TAX_ASSESSMENT_STATUSES.Finalized) {
          return { aggregate: raced, idempotent: true };
        }
        throw new TaxAssessmentError('TAX_ASSESSMENT_DUPLICATE');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async markAdjusted(assessmentId: string, reason: string, actorIdentityId: string): Promise<TaxAssessmentRow> {
    const result = await this.pool().query<TaxAssessmentRow>(
      `UPDATE fis.tax_assessments
       SET status = $2,
           cancel_reason = $3,
           row_version = row_version + 1,
           updated_at = NOW(),
           updated_by_identity_id = $4
       WHERE id = $1
       RETURNING ${ASSESSMENT_RETURNING}`,
      [assessmentId, TAX_ASSESSMENT_STATUSES.Adjusted, reason, actorIdentityId],
    );
    if (!result.rows[0]) {
      throw new TaxAssessmentError('TAX_ASSESSMENT_NOT_FOUND');
    }
    const client = await this.pool().connect();
    try {
      await this.insertEvent(client, assessmentId, TAX_ASSESSMENT_EVENTS.Adjusted, { reason }, actorIdentityId);
    } finally {
      client.release();
    }
    return result.rows[0];
  }

  async markCancelled(assessmentId: string, reason: string, actorIdentityId: string): Promise<TaxAssessmentRow> {
    const result = await this.pool().query<TaxAssessmentRow>(
      `UPDATE fis.tax_assessments
       SET status = $2,
           cancelled_at = NOW(),
           cancel_reason = $3,
           row_version = row_version + 1,
           updated_at = NOW(),
           updated_by_identity_id = $4
       WHERE id = $1
       RETURNING ${ASSESSMENT_RETURNING}`,
      [assessmentId, TAX_ASSESSMENT_STATUSES.Cancelled, reason, actorIdentityId],
    );
    if (!result.rows[0]) {
      throw new TaxAssessmentError('TAX_ASSESSMENT_NOT_FOUND');
    }
    const client = await this.pool().connect();
    try {
      await this.insertEvent(client, assessmentId, TAX_ASSESSMENT_EVENTS.Cancelled, { reason }, actorIdentityId);
    } finally {
      client.release();
    }
    return result.rows[0];
  }

  async cancelObligation(input: CancelTaxObligationPersistenceInput): Promise<TaxObligationRow> {
    const existing = await this.findObligationById(input.obligationId);
    if (!existing) {
      throw new TaxAssessmentError('TAX_OBLIGATION_NOT_FOUND');
    }
    if (existing.status === TAX_OBLIGATION_STATUSES.Cancelled) {
      return existing;
    }
    const result = await this.pool().query<TaxObligationRow>(
      `UPDATE fis.tax_obligations
       SET status = $2,
           cancelled_at = NOW(),
           cancel_reason = $3
       WHERE id = $1
       RETURNING ${OBLIGATION_RETURNING}`,
      [input.obligationId, TAX_OBLIGATION_STATUSES.Cancelled, input.reason],
    );
    return result.rows[0]!;
  }

  async attachPayableSnapshot(input: AttachPayableSnapshotInput): Promise<TaxObligationRow> {
    const result = await this.pool().query<TaxObligationRow>(
      `UPDATE fis.tax_obligations
       SET payable_id = $2,
           payable_principal_snapshot = $3
       WHERE id = $1
       RETURNING ${OBLIGATION_RETURNING}`,
      [input.obligationId, input.payableId, input.payablePrincipal],
    );
    if (!result.rows[0]) {
      throw new TaxAssessmentError('TAX_OBLIGATION_NOT_FOUND');
    }
    return result.rows[0];
  }

  private async findObligationWithClient(
    client: PoolClient,
    assessmentId: string,
  ): Promise<TaxObligationRow | null> {
    const result = await client.query<TaxObligationRow>(
      `SELECT ${OBLIGATION_RETURNING}
       FROM fis.tax_obligations
       WHERE tax_assessment_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [assessmentId],
    );
    return result.rows[0] ?? null;
  }

  private async insertEvent(
    client: PoolClient,
    assessmentId: string,
    eventType: string,
    payload: Record<string, unknown>,
    actorIdentityId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO fis.tax_assessment_events (tax_assessment_id, event_type, payload, actor_identity_id)
       VALUES ($1, $2::fis.tax_assessment_event_type, $3::jsonb, $4)`,
      [assessmentId, eventType, payload, actorIdentityId],
    );
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

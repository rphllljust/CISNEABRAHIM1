import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  resolveApprovedMeasurementRevenueEvidence,
  type ApprovedMeasurementRevenueEvidence,
  type ApprovedMeasurementRevenueRow,
} from '../domain/approved-measurement-revenue';
import {
  OPERATIONAL_COST_ENTRY_RETURNING,
  type OperationalCostEntryRow,
  type RecordOperationalCostPersistenceInput,
  type RecordOperationalCostPersistenceResult,
} from './operational-cost.repository.types';

function isOperationalCostKeyViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return (
    pgError.code === '23505' &&
    pgError.constraint === 'operational_cost_entries_idempotency_key_uidx'
  );
}

function isOperationalCostDuplicateViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return (
    pgError.code === '23505' &&
    pgError.constraint === 'operational_cost_entries_execution_category_kind_uidx'
  );
}

@Injectable()
export class OperationalCostRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async listByServiceOrder(serviceOrderId: string): Promise<OperationalCostEntryRow[]> {
    const result = await this.pool().query<OperationalCostEntryRow>(
      `SELECT ${OPERATIONAL_COST_ENTRY_RETURNING}
       FROM so.operational_cost_entries
       WHERE service_order_id = $1
       ORDER BY recorded_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  async findApprovedMeasurementRevenueEvidence(
    serviceOrderId: string,
  ): Promise<ApprovedMeasurementRevenueEvidence> {
    const result = await this.pool().query<ApprovedMeasurementRevenueRow>(
      `SELECT NULLIF(UPPER(TRIM(mi.pricing_line_snapshot->>'currencyCode')), '') AS currency_code,
              SUM(mi.line_amount)::text AS total_revenue,
              COUNT(*) FILTER (WHERE mi.line_amount IS NULL)::integer AS missing_amount_count
         FROM msr.measurements m
         JOIN msr.measurement_items mi ON mi.measurement_id = m.id
        WHERE m.service_order_id = $1
          AND m.status = 'APPROVED'::msr.measurement_status
        GROUP BY 1
        ORDER BY 1`,
      [serviceOrderId],
    );
    return resolveApprovedMeasurementRevenueEvidence(result.rows);
  }

  /** Legacy read contract; never sum currencies that have no common authority. */
  async findApprovedMeasurementRevenue(serviceOrderId: string): Promise<string | null> {
    const evidence = await this.findApprovedMeasurementRevenueEvidence(serviceOrderId);
    return evidence.amount;
  }

  async recordCost(
    input: RecordOperationalCostPersistenceInput,
  ): Promise<RecordOperationalCostPersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      if (input.idempotencyKey) {
        const existing = await client.query<OperationalCostEntryRow>(
          `SELECT ${OPERATIONAL_COST_ENTRY_RETURNING}
           FROM so.operational_cost_entries
           WHERE idempotency_key = $1 AND service_order_id = $2`,
          [input.idempotencyKey, input.serviceOrderId],
        );
        if (existing.rows[0]) {
          await client.query('COMMIT');
          return { outcome: 'idempotent', payload: { entry: existing.rows[0] } };
        }
      }

      const locked = await client.query<{ row_version: number; status: string }>(
        `SELECT row_version, status::text AS status
         FROM so.service_orders
         WHERE id = $1
         FOR UPDATE`,
        [input.serviceOrderId],
      );
      const current = locked.rows[0];
      if (!current || current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }

      if (input.sourceExecutionEntryId) {
        const executionEntry = await client.query<{ id: string }>(
          `SELECT id
           FROM so.execution_entries
           WHERE id = $1 AND service_order_id = $2`,
          [input.sourceExecutionEntryId, input.serviceOrderId],
        );
        if (!executionEntry.rows[0]) {
          await client.query('ROLLBACK');
          return { outcome: 'execution_entry_not_found' };
        }
      }

      const inserted = await client.query<OperationalCostEntryRow>(
        `INSERT INTO so.operational_cost_entries (
           service_order_id, origin, source_execution_entry_id, category, cost_kind,
           description, amount, currency_code, quantity_value, quantity_unit_code,
           origin_context, actor_identity_id, idempotency_key
         ) VALUES (
           $1, $2::so.operational_cost_origin, $3, $4::so.operational_cost_category,
           $5::so.operational_cost_kind, $6, $7::numeric, $8, $9::numeric, $10,
           $11::jsonb, $12, $13
         )
         RETURNING ${OPERATIONAL_COST_ENTRY_RETURNING}`,
        [
          input.serviceOrderId,
          input.origin,
          input.sourceExecutionEntryId,
          input.category,
          input.costKind,
          input.description,
          input.amount,
          input.currencyCode,
          input.quantityValue,
          input.quantityUnitCode,
          JSON.stringify(input.originContext),
          input.actorIdentityId,
          input.idempotencyKey,
        ],
      );
      const entry = inserted.rows[0];
      if (!entry) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const bumped = await client.query<{ row_version: number }>(
        `UPDATE so.service_orders
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1
         RETURNING row_version`,
        [input.serviceOrderId, input.actorIdentityId],
      );

      await client.query('COMMIT');
      return {
        outcome: 'success',
        entry,
        rowVersion: bumped.rows[0]?.row_version ?? input.rowVersion + 1,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isOperationalCostKeyViolation(error) && input.idempotencyKey) {
        // Replay only when the key belongs to THIS service order; a key used by
        // another order surfaces as a conflict, never as a read-back of the
        // other order's cost entry (idempotency-key IDOR).
        const existing = await this.pool().query<OperationalCostEntryRow>(
          `SELECT ${OPERATIONAL_COST_ENTRY_RETURNING}
           FROM so.operational_cost_entries
           WHERE idempotency_key = $1 AND service_order_id = $2`,
          [input.idempotencyKey, input.serviceOrderId],
        );
        if (existing.rows[0]) {
          return { outcome: 'idempotent', payload: { entry: existing.rows[0] } };
        }
        return { outcome: 'idempotency_key_conflict' };
      }
      if (isOperationalCostDuplicateViolation(error)) {
        return { outcome: 'duplicate_cost_entry' };
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  findStoredCommandIdempotency,
  storeCommandIdempotency,
} from '../../infrastructure/database/command-idempotency';
import { classifyRowVersion, isOptimisticVersionConflict } from '../../infrastructure/database/optimistic-lock';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import { OutboxDomainEventWriter } from '../../platform/outbox/services/outbox-domain-event.writer';
import { MEASUREMENT_HISTORY_EVENTS } from '../domain/measurement';
import { MEASUREMENT_ITEM_RETURNING, MEASUREMENT_RETURNING } from './measurements-sql.constants';
import {
  measurementHistoryEventForTransition,
  measurementTransitionSql,
} from './measurements-transition.helpers';
import type {
  AuthorizeAdjustmentInput,
  AuthorizeAdjustmentResult,
  CreateMeasurementPersistenceInput,
  CreateMeasurementPersistenceResult,
  ExecutionQuantityEntryRow,
  MeasurementAdjustmentRow,
  MeasurementCommandIdempotencyRow,
  MeasurementHistoryEventRow,
  MeasurementItemPersistenceDraft,
  MeasurementItemRow,
  MeasurementRow,
  MeasurementTransitionInput,
  MeasurementTransitionResult,
  PricingModelRow,
  RegenerateMeasurementItemsInput,
  RegenerateMeasurementItemsResult,
  UnitOfMeasureRow,
  UpdateMeasurementItemInput,
  UpdateMeasurementItemResult,
} from './measurements.repository.types';

@Injectable()
export class MeasurementsRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly outboxWriter: OutboxDomainEventWriter,
    @Optional() @Inject(FAULT_INJECTION_PORT) private readonly faultInjection?: FaultInjectionPort,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(measurementId: string): Promise<MeasurementRow | null> {
    const result = await this.pool().query<MeasurementRow>(
      `SELECT ${MEASUREMENT_RETURNING} FROM msr.measurements WHERE id = $1`,
      [measurementId],
    );
    return result.rows[0] ?? null;
  }

  async findByServiceOrderId(serviceOrderId: string): Promise<MeasurementRow | null> {
    const result = await this.pool().query<MeasurementRow>(
      `SELECT ${MEASUREMENT_RETURNING}
       FROM msr.measurements
       WHERE service_order_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  async findActiveByServiceOrderId(serviceOrderId: string): Promise<MeasurementRow | null> {
    const result = await this.pool().query<MeasurementRow>(
      `SELECT ${MEASUREMENT_RETURNING}
       FROM msr.measurements
       WHERE service_order_id = $1
         AND status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED')
       LIMIT 1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  async listItems(measurementId: string): Promise<MeasurementItemRow[]> {
    const result = await this.pool().query<MeasurementItemRow>(
      `SELECT ${MEASUREMENT_ITEM_RETURNING}
       FROM msr.measurement_items
       WHERE measurement_id = $1
       ORDER BY line_number ASC`,
      [measurementId],
    );
    return result.rows;
  }

  async listAdjustments(measurementId: string): Promise<MeasurementAdjustmentRow[]> {
    const result = await this.pool().query<MeasurementAdjustmentRow>(
      `SELECT id, measurement_id, measurement_item_id,
              adjustment_quantity::text AS adjustment_quantity,
              unit_code, reason, authorized_by_identity_id, created_at
       FROM msr.measurement_adjustments
       WHERE measurement_id = $1
       ORDER BY created_at ASC`,
      [measurementId],
    );
    return result.rows;
  }

  async sumAdjustmentsForItem(itemId: string): Promise<string> {
    const result = await this.pool().query<{ total: string | null }>(
      `SELECT COALESCE(SUM(adjustment_quantity), 0)::text AS total
       FROM msr.measurement_adjustments
       WHERE measurement_item_id = $1`,
      [itemId],
    );
    return result.rows[0]?.total ?? '0';
  }

  async listHistoryEvents(measurementId: string): Promise<MeasurementHistoryEventRow[]> {
    const result = await this.pool().query<MeasurementHistoryEventRow>(
      `SELECT id, measurement_id, event_type, payload, actor_identity_id, occurred_at
       FROM msr.measurement_history_events
       WHERE measurement_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [measurementId],
    );
    return result.rows;
  }

  async findIdempotency(
    measurementId: string,
    commandName: string,
    idempotencyKey: string,
  ): Promise<MeasurementCommandIdempotencyRow | null> {
    const client = await this.pool().connect();
    try {
      return await this.findIdempotencyInClient(client, measurementId, commandName, idempotencyKey);
    } finally {
      client.release();
    }
  }

  async loadPricingModels(serviceDefinitionVersionId: string): Promise<PricingModelRow[]> {
    const result = await this.pool().query<PricingModelRow>(
      `SELECT pricing_model_code::text AS model_code,
              sale_price_amount::text AS sale_price,
              internal_cost_amount::text AS internal_cost,
              COALESCE(currency_code, 'BRL') AS currency_code
       FROM cat.service_pricing_models
       WHERE service_definition_version_id = $1
       ORDER BY sort_order ASC, pricing_model_code ASC`,
      [serviceDefinitionVersionId],
    );
    return result.rows;
  }

  async loadUnitOfMeasure(unitCode: string): Promise<UnitOfMeasureRow | null> {
    const result = await this.pool().query<UnitOfMeasureRow>(
      `SELECT code, decimal_scale
       FROM cat.units_of_measure
       WHERE code = $1`,
      [unitCode],
    );
    return result.rows[0] ?? null;
  }

  async listExecutionQuantityEntries(serviceOrderId: string): Promise<ExecutionQuantityEntryRow[]> {
    const result = await this.pool().query<ExecutionQuantityEntryRow>(
      `SELECT id, entry_type::text AS entry_type,
              quantity_value::text AS quantity_value,
              quantity_unit_code, recorded_at
       FROM so.execution_entries
       WHERE service_order_id = $1
         AND entry_type = 'QUANTITY'
         AND quantity_value IS NOT NULL
       ORDER BY recorded_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  async listApprovedMeasurementExecutionEntryIds(serviceOrderId: string): Promise<string[]> {
    const result = await this.pool().query<{ source_execution_entry_id: string }>(
      `SELECT DISTINCT mi.source_execution_entry_id
       FROM msr.measurement_items mi
       INNER JOIN msr.measurements m ON m.id = mi.measurement_id
       WHERE m.service_order_id = $1
         AND m.status = 'APPROVED'`,
      [serviceOrderId],
    );
    return result.rows.map((row) => row.source_execution_entry_id);
  }

  async createMeasurement(
    input: CreateMeasurementPersistenceInput,
  ): Promise<CreateMeasurementPersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `SELECT id FROM msr.measurements
         WHERE service_order_id = $1
           AND status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED')
         LIMIT 1`,
        [input.serviceOrderId],
      );
      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'already_exists' };
      }

      const inserted = await client.query<MeasurementRow>(
        `INSERT INTO msr.measurements (
           service_order_id, unit_id, commercial_reference_snapshot,
           created_by_identity_id, updated_by_identity_id
         ) VALUES ($1, $2, $3::jsonb, $4, $4)
         RETURNING ${MEASUREMENT_RETURNING}`,
        [
          input.serviceOrderId,
          input.unitId,
          JSON.stringify(input.commercialReferenceSnapshot),
          input.actorIdentityId,
        ],
      );
      const measurement = inserted.rows[0]!;

      for (const [index, item] of input.items.entries()) {
        await this.insertMeasurementItem(client, measurement.id, index + 1, item);
      }

      await client.query(
        `INSERT INTO msr.measurement_history_events
           (measurement_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          measurement.id,
          MEASUREMENT_HISTORY_EVENTS.Created,
          JSON.stringify({ itemCount: input.items.length }),
          input.actorIdentityId,
        ],
      );

      await client.query('COMMIT');
      return { outcome: 'success', measurement };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async regenerateItems(input: RegenerateMeasurementItemsInput): Promise<RegenerateMeasurementItemsResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const locked = await client.query<{ row_version: number; status: string }>(
        `SELECT row_version, status::text AS status
         FROM msr.measurements
         WHERE id = $1
         FOR UPDATE`,
        [input.measurementId],
      );
      const current = locked.rows[0];
      if (!current || isOptimisticVersionConflict(classifyRowVersion(current, input.rowVersion))) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }
      if (current.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return { outcome: 'not_editable' };
      }

      await client.query(`DELETE FROM msr.measurement_adjustments WHERE measurement_id = $1`, [
        input.measurementId,
      ]);
      await client.query(`DELETE FROM msr.measurement_items WHERE measurement_id = $1`, [
        input.measurementId,
      ]);

      for (const [index, item] of input.items.entries()) {
        await this.insertMeasurementItem(client, input.measurementId, index + 1, item);
      }

      const updated = await client.query<{ row_version: number }>(
        `UPDATE msr.measurements
         SET updated_by_identity_id = $2,
             updated_at = NOW(),
             row_version = row_version + 1
         WHERE id = $1
         RETURNING row_version`,
        [input.measurementId, input.actorIdentityId],
      );

      await client.query(
        `INSERT INTO msr.measurement_history_events
           (measurement_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          input.measurementId,
          MEASUREMENT_HISTORY_EVENTS.Regenerated,
          JSON.stringify({ itemCount: input.items.length }),
          input.actorIdentityId,
        ],
      );

      await client.query('COMMIT');
      return { outcome: 'success', rowVersion: updated.rows[0]!.row_version };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateItemMeasuredQuantity(
    input: UpdateMeasurementItemInput,
  ): Promise<UpdateMeasurementItemResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const locked = await client.query<{ row_version: number; status: string }>(
        `SELECT row_version, status::text AS status
         FROM msr.measurements
         WHERE id = $1
         FOR UPDATE`,
        [input.measurementId],
      );
      const current = locked.rows[0];
      if (!current || isOptimisticVersionConflict(classifyRowVersion(current, input.rowVersion))) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }
      if (current.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return { outcome: 'not_editable' };
      }

      const updatedItem = await client.query<MeasurementItemRow>(
        `UPDATE msr.measurement_items
         SET measured_quantity = $3,
             line_amount = $4,
             updated_at = NOW()
         WHERE id = $2
           AND measurement_id = $1
         RETURNING ${MEASUREMENT_ITEM_RETURNING}`,
        [input.measurementId, input.itemId, input.measuredQuantity, input.lineAmount],
      );
      if (!updatedItem.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'item_not_found' };
      }

      const updated = await client.query<{ row_version: number }>(
        `UPDATE msr.measurements
         SET updated_by_identity_id = $2,
             updated_at = NOW(),
             row_version = row_version + 1
         WHERE id = $1
         RETURNING row_version`,
        [input.measurementId, input.actorIdentityId],
      );

      await client.query(
        `INSERT INTO msr.measurement_history_events
           (measurement_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          input.measurementId,
          MEASUREMENT_HISTORY_EVENTS.ItemUpdated,
          JSON.stringify({ itemId: input.itemId, measuredQuantity: input.measuredQuantity }),
          input.actorIdentityId,
        ],
      );

      await client.query('COMMIT');
      return {
        outcome: 'success',
        item: updatedItem.rows[0],
        rowVersion: updated.rows[0]!.row_version,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async authorizeAdjustment(input: AuthorizeAdjustmentInput): Promise<AuthorizeAdjustmentResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const locked = await client.query<{ row_version: number; status: string }>(
        `SELECT row_version, status::text AS status
         FROM msr.measurements
         WHERE id = $1
         FOR UPDATE`,
        [input.measurementId],
      );
      const current = locked.rows[0];
      if (!current || isOptimisticVersionConflict(classifyRowVersion(current, input.rowVersion))) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }
      if (current.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return { outcome: 'not_editable' };
      }

      const item = await client.query(
        `SELECT id FROM msr.measurement_items
         WHERE id = $1 AND measurement_id = $2`,
        [input.itemId, input.measurementId],
      );
      if (!item.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'item_not_found' };
      }

      const inserted = await client.query<MeasurementAdjustmentRow>(
        `INSERT INTO msr.measurement_adjustments (
           measurement_id, measurement_item_id, adjustment_quantity, unit_code,
           reason, authorized_by_identity_id
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, measurement_id, measurement_item_id,
                   adjustment_quantity::text AS adjustment_quantity,
                   unit_code, reason, authorized_by_identity_id, created_at`,
        [
          input.measurementId,
          input.itemId,
          input.adjustmentQuantity,
          input.unitCode,
          input.reason,
          input.actorIdentityId,
        ],
      );

      const updated = await client.query<{ row_version: number }>(
        `UPDATE msr.measurements
         SET updated_by_identity_id = $2,
             updated_at = NOW(),
             row_version = row_version + 1
         WHERE id = $1
         RETURNING row_version`,
        [input.measurementId, input.actorIdentityId],
      );

      await client.query(
        `INSERT INTO msr.measurement_history_events
           (measurement_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          input.measurementId,
          MEASUREMENT_HISTORY_EVENTS.AdjustmentAuthorized,
          JSON.stringify({
            itemId: input.itemId,
            adjustmentQuantity: input.adjustmentQuantity,
          }),
          input.actorIdentityId,
        ],
      );

      await client.query('COMMIT');
      return {
        outcome: 'success',
        adjustment: inserted.rows[0]!,
        rowVersion: updated.rows[0]!.row_version,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async transitionMeasurement(input: MeasurementTransitionInput): Promise<MeasurementTransitionResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      if (input.idempotencyKey) {
        const existing = await this.findIdempotencyInClient(
          client,
          input.measurementId,
          input.commandName,
          input.idempotencyKey,
        );
        if (existing) {
          await client.query('COMMIT');
          const rowVersion = existing.response_payload['rowVersion'];
          return {
            outcome: 'success',
            rowVersion: typeof rowVersion === 'number' ? rowVersion : input.rowVersion,
          };
        }
      }

      const locked = await client.query<{ row_version: number; status: string }>(
        `SELECT row_version, status::text AS status
         FROM msr.measurements
         WHERE id = $1
         FOR UPDATE`,
        [input.measurementId],
      );
      const current = locked.rows[0];
      if (!current || isOptimisticVersionConflict(classifyRowVersion(current, input.rowVersion))) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }
      if (current.status !== input.currentStatus) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const transitionSql = measurementTransitionSql(input.transition);
      const params: unknown[] = [
        input.measurementId,
        input.rowVersion,
        input.nextStatus,
        input.actorIdentityId,
        input.currentStatus,
      ];
      if (input.transition === 'reject') {
        params.push(input.rejectionReason ?? null);
      }

      const updated = await client.query<{ row_version: number }>(
        `UPDATE msr.measurements
         SET status = $3::msr.measurement_status,
             ${transitionSql},
             updated_by_identity_id = $4,
             updated_at = NOW(),
             row_version = row_version + 1
         WHERE id = $1
           AND row_version = $2
           AND status = $5::msr.measurement_status
         RETURNING row_version`,
        params,
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      if (input.transition === 'approve') {
        await maybeInjectFault(this.faultInjection, FAULT_HOOKS.MeasurementApproveAfterMutationBeforeHistory);
      }
      await client.query(
        `INSERT INTO msr.measurement_history_events
           (measurement_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          input.measurementId,
          measurementHistoryEventForTransition(input.transition),
          JSON.stringify({
            fromStatus: input.currentStatus,
            toStatus: input.nextStatus,
            rejectionReason: input.rejectionReason ?? null,
          }),
          input.actorIdentityId,
        ],
      );

      const nextRowVersion = updated.rows[0]?.row_version;
      if (input.idempotencyKey && nextRowVersion !== undefined) {
        await storeCommandIdempotency(client, {
          tableFqn: 'msr.measurement_command_idempotency',
          columns: {
            measurement_id: input.measurementId,
            command_name: input.commandName,
            idempotency_key: input.idempotencyKey,
            response_payload: { rowVersion: nextRowVersion },
          },
          jsonPayloadColumns: ['response_payload'],
        });
      }

      const measurement = await client.query<{
        id: string;
        service_order_id: string;
        unit_id: string;
        submitted_at: string | null;
        decided_at: string | null;
      }>(
        `SELECT id, service_order_id, unit_id, submitted_at, decided_at
         FROM msr.measurements
         WHERE id = $1`,
        [input.measurementId],
      );
      const row = measurement.rows[0];
      if (row?.submitted_at && input.transition === 'submit') {
        await this.outboxWriter.appendMeasurementSubmitted(client, {
          measurementId: row.id,
          serviceOrderId: row.service_order_id,
          unitId: row.unit_id,
          submittedAt: row.submitted_at,
        });
      }
      if (row?.decided_at && input.transition === 'approve') {
        await maybeInjectFault(this.faultInjection, FAULT_HOOKS.MeasurementApproveBeforeOutbox);
        await this.outboxWriter.appendMeasurementApproved(client, {
          measurementId: row.id,
          serviceOrderId: row.service_order_id,
          unitId: row.unit_id,
          approvedAt: row.decided_at,
        });
      }

      await client.query('COMMIT');
      return { outcome: 'success', rowVersion: updated.rows[0].row_version };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Insere UM item de medição, com a ORIGEM e as TRÊS QUANTIDADES.
   *
   * Um único lugar escreve item porque existem dois comandos que o fazem
   * (criação e regeneração). Duas cópias do INSERT divergiriam na primeira vez
   * que uma coluna nova aparecesse — e a divergência seria silenciosa: a
   * regeneração gravaria item sem origem, ou sem planejado, e nada reprovaria.
   */
  private async insertMeasurementItem(
    client: PoolClient,
    measurementId: string,
    lineNumber: number,
    item: MeasurementItemPersistenceDraft,
  ): Promise<void> {
    await client.query(
      `INSERT INTO msr.measurement_items (
         measurement_id, line_number, source_measurement_basis_id, source_basis_line_key,
         source_execution_entry_id, unit_code,
         planned_quantity, planned_unit_of_measure,
         actual_quantity, measured_quantity, unit_price, line_amount, pricing_line_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      [
        measurementId,
        lineNumber,
        item.sourceMeasurementBasisId,
        item.sourceBasisLineKey,
        item.sourceExecutionEntryId,
        item.unitCode,
        item.plannedQuantity,
        item.plannedUnitOfMeasure,
        item.actualQuantity,
        item.measuredQuantity,
        item.unitPrice,
        item.lineAmount,
        JSON.stringify(item.pricingLineSnapshot),
      ],
    );
  }

  private async findIdempotencyInClient(
    client: PoolClient,
    measurementId: string,
    commandName: string,
    idempotencyKey: string,
  ): Promise<MeasurementCommandIdempotencyRow | null> {
    return findStoredCommandIdempotency<MeasurementCommandIdempotencyRow>(client, {
      tableFqn: 'msr.measurement_command_idempotency',
      scopeColumn: 'measurement_id',
      scopeValue: measurementId,
      commandName,
      idempotencyKey,
      returning: 'id, measurement_id, command_name, idempotency_key, response_payload, created_at',
    });
  }

}

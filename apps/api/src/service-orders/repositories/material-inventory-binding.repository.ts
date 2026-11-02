import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';

/**
 * #193 / 2C: OS owns only so.material_inventory_bindings.
 * Inventory owns inv.*; its item/warehouse/unit consistency is enforced by
 * the existing cross-domain FKs from migration 0113. No stock movement here.
 */
export type MaterialInventoryBindingRow = {
  id: string;
  service_order_id: string;
  actual_id: string;
  unit_id: string;
  inventory_item_id: string;
  warehouse_id: string;
  quantity: string;
  unit_of_measure: string;
  source_kind: string;
  source_id: string;
  authorized_by_identity_id: string;
  authorized_at: Date;
  occurred_at: Date;
  idempotency_key: string;
};

export type BindMaterialInventoryInput = {
  serviceOrderId: string;
  actualId: string;
  inventoryItemId: string;
  warehouseId: string;
  unitId: string;
  actorIdentityId: string;
  rowVersion: number;
  idempotencyKey: string;
};

export type MaterialBindingFailure =
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'VERSION_CONFLICT'
  | 'INVALID_FACT'
  | 'INVALID_REFERENCE'
  | 'IDEMPOTENCY_CONFLICT';

export class MaterialBindingPersistenceError extends Error {
  constructor(readonly reason: MaterialBindingFailure) {
    super(reason);
    this.name = 'MaterialBindingPersistenceError';
  }
}

const RETURNING = `id, service_order_id, actual_id, unit_id, inventory_item_id,
  warehouse_id, quantity::text AS quantity, unit_of_measure, source_kind,
  source_id, authorized_by_identity_id, authorized_at, occurred_at, idempotency_key`;

@Injectable()
export class MaterialInventoryBindingRepository {
  constructor(private readonly database: DatabaseService) {}

  private pool(): Pool {
    const connection = this.database.getConnection();
    if (!connection) throw new Error('DATABASE_URL is not configured.');
    return connection.pool;
  }

  private async rollbackKeepingPrimaryCause(client: PoolClient): Promise<Error | undefined> {
    try {
      await client.query('ROLLBACK');
      return undefined;
    } catch (rollbackFailure) {
      return rollbackFailure instanceof Error ? rollbackFailure : new Error(String(rollbackFailure));
    }
  }

  /** Owned SO snapshot; Inventory movement data must be read exclusively via its port. */
  async findByActual(serviceOrderId: string, actualId: string): Promise<MaterialInventoryBindingRow | null> {
    const result = await this.pool().query<MaterialInventoryBindingRow>(
      `SELECT ${RETURNING} FROM so.material_inventory_bindings
       WHERE service_order_id = $1 AND actual_id = $2`,
      [serviceOrderId, actualId],
    );
    return result.rows[0] ?? null;
  }

  /** Owned SO bindings for already READ-authorized order IDs; no inv.* joins. */
  async findByServiceOrders(serviceOrderIds: string[]): Promise<MaterialInventoryBindingRow[]> {
    if (serviceOrderIds.length === 0) return [];
    const result = await this.pool().query<MaterialInventoryBindingRow>(
      `SELECT ${RETURNING} FROM so.material_inventory_bindings
       WHERE service_order_id = ANY($1::uuid[])
       ORDER BY authorized_at, actual_id`,
      [serviceOrderIds],
    );
    return result.rows;
  }

  async bind(input: BindMaterialInventoryInput): Promise<{ row: MaterialInventoryBindingRow; idempotent: boolean }> {
    const client = await this.pool().connect();
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');
      // Lock OS before the fact, so status/version and actual snapshot cannot race
      // an execution transition or a concurrent material-binding command.
      const order = await client.query<{ status: string; row_version: number; unit_id: string }>(
        `SELECT status::text AS status, row_version, unit_id
         FROM so.service_orders WHERE id = $1 FOR UPDATE`,
        [input.serviceOrderId],
      );
      if (!order.rows[0]) throw new MaterialBindingPersistenceError('NOT_FOUND');
      if (order.rows[0].unit_id !== input.unitId) {
        throw new MaterialBindingPersistenceError('INVALID_REFERENCE');
      }
      if (order.rows[0].status !== 'IN_EXECUTION') {
        throw new MaterialBindingPersistenceError('INVALID_STATE');
      }
      if (order.rows[0].row_version !== input.rowVersion) {
        throw new MaterialBindingPersistenceError('VERSION_CONFLICT');
      }

      const fact = await client.query<{
        actual_kind: string;
        actual_value: string;
        valid_scale: boolean;
      }>(
        `SELECT actual_kind::text AS actual_kind,
                actual_value::text AS actual_value,
                (actual_value = trunc(actual_value, 4)) AS valid_scale
         FROM so.execution_actuals
         WHERE id = $1 AND service_order_id = $2 FOR UPDATE`,
        [input.actualId, input.serviceOrderId],
      );
      if (
        !fact.rows[0] ||
        fact.rows[0].actual_kind !== 'MATERIAL_QUANTITY' ||
        !fact.rows[0].valid_scale ||
        Number(fact.rows[0].actual_value) <= 0
      ) {
        throw new MaterialBindingPersistenceError('INVALID_FACT');
      }

      const existing = await this.findExisting(client, input);
      if (existing) {
        this.assertSameBinding(existing, input);
        await client.query('COMMIT');
        return { row: existing, idempotent: true };
      }

      const inserted = await client.query<MaterialInventoryBindingRow>(
        `INSERT INTO so.material_inventory_bindings
          (service_order_id, actual_id, unit_id, inventory_item_id, warehouse_id,
           actual_kind, quantity, unit_of_measure, source_kind, source_id,
           authorized_by_identity_id, authorized_at, occurred_at, idempotency_key)
         SELECT a.service_order_id, a.id, $3, $4::uuid, $5::uuid,
                a.actual_kind, a.actual_value, a.unit_of_measure,
                'SERVICE_ORDER_EXECUTION_ACTUAL', a.id, $6::uuid, now(),
                a.occurred_at, $7
         FROM so.execution_actuals a
         WHERE a.id = $2 AND a.service_order_id = $1
         ON CONFLICT DO NOTHING
         RETURNING ${RETURNING}`,
        [
          input.serviceOrderId, input.actualId, input.unitId,
          input.inventoryItemId, input.warehouseId, input.actorIdentityId,
          input.idempotencyKey,
        ],
      );
      if (inserted.rows[0]) {
        await client.query('COMMIT');
        return { row: inserted.rows[0], idempotent: false };
      }

      // Unique constraint resolved a concurrent replay or a conflicting binding.
      const raced = await this.findExisting(client, input);
      if (!raced) throw new MaterialBindingPersistenceError('IDEMPOTENCY_CONFLICT');
      this.assertSameBinding(raced, input);
      await client.query('COMMIT');
      return { row: raced, idempotent: true };
    } catch (error) {
      evictWith = await this.rollbackKeepingPrimaryCause(client);
      if (error instanceof MaterialBindingPersistenceError) throw error;
      const code = (error as { code?: string })?.code;
      if (code === '23503') throw new MaterialBindingPersistenceError('INVALID_REFERENCE');
      if (code === '23505') throw new MaterialBindingPersistenceError('IDEMPOTENCY_CONFLICT');
      if (code === '23514' || code === '22003') throw new MaterialBindingPersistenceError('INVALID_FACT');
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  private async findExisting(
    client: PoolClient,
    input: BindMaterialInventoryInput,
  ): Promise<MaterialInventoryBindingRow | null> {
    const result = await client.query<MaterialInventoryBindingRow>(
      `SELECT ${RETURNING} FROM so.material_inventory_bindings
       WHERE actual_id = $1 OR idempotency_key = $2 FOR UPDATE`,
      [input.actualId, input.idempotencyKey],
    );
    if (result.rows.length > 1) throw new MaterialBindingPersistenceError('IDEMPOTENCY_CONFLICT');
    return result.rows[0] ?? null;
  }

  private assertSameBinding(row: MaterialInventoryBindingRow, input: BindMaterialInventoryInput): void {
    if (
      row.service_order_id !== input.serviceOrderId ||
      row.actual_id !== input.actualId ||
      row.unit_id !== input.unitId ||
      row.inventory_item_id !== input.inventoryItemId ||
      row.warehouse_id !== input.warehouseId ||
      row.authorized_by_identity_id !== input.actorIdentityId ||
      row.idempotency_key !== input.idempotencyKey
    ) {
      throw new MaterialBindingPersistenceError('IDEMPOTENCY_CONFLICT');
    }
  }
}

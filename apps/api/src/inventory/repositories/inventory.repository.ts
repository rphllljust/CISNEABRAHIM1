import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { publishedWindowsOverlap } from '../domain/costing';
import { InventoryError } from '../domain/inventory';
import type {
  CostingRuleRow,
  CostingRuleVersionRow,
  InventoryItemRow,
  PersistMovementInput,
  StockBalanceRow,
  StockMovementListRow,
  StockMovementRow,
  StockReservationListRow,
  StockReservationRow,
  WarehouseRow,
} from './inventory.repository.types';

const WAREHOUSE_RETURNING = `id, unit_id, code, name, status::text AS status`;
const ITEM_RETURNING = `
  id, unit_id, sku, name, status::text AS status,
  allows_negative_stock, costing_method_status::text AS costing_method_status
`;
const MOVEMENT_RETURNING = `
  id, unit_id, warehouse_id, inventory_item_id, movement_type::text AS movement_type,
  status::text AS status, quantity::text AS quantity, signed_quantity::text AS signed_quantity,
  counterpart_warehouse_id, transfer_group_id, transfer_leg::text AS transfer_leg,
  adjustment_effect::text AS adjustment_effect, reservation_id, reversal_of_movement_id,
  command_idempotency_key, idempotency_key, occurred_on::text AS occurred_on, description,
  unit_cost::text AS unit_cost, total_cost::text AS total_cost,
  costing_rule_version_id, origin_kind::text AS origin_kind
`;
const COSTING_RULE_RETURNING = `id, unit_id, code, name, status::text AS status`;
const COSTING_VERSION_RETURNING = `
  id, costing_rule_id, version_number, status::text AS status, method::text AS method,
  required_context, effective_from::text AS effective_from, effective_to::text AS effective_to,
  source_reference, row_version, published_at, published_by_identity_id
`;
const RESERVATION_RETURNING = `
  id, unit_id, warehouse_id, inventory_item_id, quantity::text AS quantity,
  status::text AS status, idempotency_key
`;

/**
 * Mesmas colunas de `MOVEMENT_RETURNING`, qualificadas por alias: necessária nas consultas de lista
 * que juntam depósito e item para trazer a referência humana sem ambiguidade de coluna.
 */
const MOVEMENT_RETURNING_ALIASED = `
  m.id, m.unit_id, m.warehouse_id, m.inventory_item_id, m.movement_type::text AS movement_type,
  m.status::text AS status, m.quantity::text AS quantity, m.signed_quantity::text AS signed_quantity,
  m.counterpart_warehouse_id, m.transfer_group_id, m.transfer_leg::text AS transfer_leg,
  m.adjustment_effect::text AS adjustment_effect, m.reservation_id, m.reversal_of_movement_id,
  m.command_idempotency_key, m.idempotency_key, m.occurred_on::text AS occurred_on, m.description,
  m.unit_cost::text AS unit_cost, m.total_cost::text AS total_cost,
  m.costing_rule_version_id, m.origin_kind::text AS origin_kind
`;

@Injectable()
export class InventoryRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findWarehouseById(id: string): Promise<WarehouseRow | null> {
    const result = await this.pool().query<WarehouseRow>(
      `SELECT ${WAREHOUSE_RETURNING} FROM inv.warehouses WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findMovementById(id: string): Promise<StockMovementRow | null> {
    const result = await this.pool().query<StockMovementRow>(
      `SELECT ${MOVEMENT_RETURNING} FROM inv.stock_movements WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findItemById(id: string): Promise<InventoryItemRow | null> {
    const result = await this.pool().query<InventoryItemRow>(
      `SELECT ${ITEM_RETURNING} FROM inv.inventory_items WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findMovementsByCommand(unitId: string, commandKey: string): Promise<StockMovementRow[]> {
    const result = await this.pool().query<StockMovementRow>(
      `SELECT ${MOVEMENT_RETURNING}
       FROM inv.stock_movements
       WHERE unit_id = $1 AND command_idempotency_key = $2
       ORDER BY created_at, transfer_leg`,
      [unitId, commandKey],
    );
    return result.rows;
  }

  async findReservationByIdempotency(
    unitId: string,
    idempotencyKey: string,
  ): Promise<StockReservationRow | null> {
    const result = await this.pool().query<StockReservationRow>(
      `SELECT ${RESERVATION_RETURNING}
       FROM inv.stock_reservations
       WHERE unit_id = $1 AND idempotency_key = $2`,
      [unitId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async findReservationById(id: string): Promise<StockReservationRow | null> {
    const result = await this.pool().query<StockReservationRow>(
      `SELECT ${RESERVATION_RETURNING} FROM inv.stock_reservations WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async getBalance(warehouseId: string, inventoryItemId: string): Promise<StockBalanceRow> {
    const result = await this.pool().query<StockBalanceRow>(
      `SELECT unit_id, warehouse_id, inventory_item_id,
              on_hand::text AS on_hand, reserved::text AS reserved, available::text AS available
       FROM inv.stock_balances
       WHERE warehouse_id = $1 AND inventory_item_id = $2`,
      [warehouseId, inventoryItemId],
    );
    return (
      result.rows[0] ?? {
        unit_id: '',
        warehouse_id: warehouseId,
        inventory_item_id: inventoryItemId,
        on_hand: '0.0000',
        reserved: '0.0000',
        available: '0.0000',
      }
    );
  }

  async listPostedMovements(
    warehouseId: string,
    inventoryItemId: string,
  ): Promise<StockMovementRow[]> {
    const result = await this.pool().query<StockMovementRow>(
      `SELECT ${MOVEMENT_RETURNING}
       FROM inv.stock_movements
       WHERE warehouse_id = $1 AND inventory_item_id = $2 AND status = 'POSTED'
       ORDER BY created_at`,
      [warehouseId, inventoryItemId],
    );
    return result.rows;
  }

  /**
   * Página de depósitos sob o MESMO predicado da contagem. Nada de junção: o depósito é
   * identificado pelo próprio código e nome.
   */
  async listWarehousePage(input: {
    whereClause: string;
    params: unknown[];
    limit: number;
    offset: number;
  }): Promise<WarehouseRow[]> {
    const result = await this.pool().query<WarehouseRow>(
      `SELECT ${WAREHOUSE_RETURNING}
       FROM inv.warehouses
       WHERE ${input.whereClause}
       ORDER BY code ASC, id ASC
       LIMIT $${input.params.length + 1}
       OFFSET $${input.params.length + 2}`,
      [...input.params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countWarehouseList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM inv.warehouses WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async listItemPage(input: {
    whereClause: string;
    params: unknown[];
    limit: number;
    offset: number;
  }): Promise<InventoryItemRow[]> {
    const result = await this.pool().query<InventoryItemRow>(
      `SELECT ${ITEM_RETURNING}
       FROM inv.inventory_items
       WHERE ${input.whereClause}
       ORDER BY sku ASC, id ASC
       LIMIT $${input.params.length + 1}
       OFFSET $${input.params.length + 2}`,
      [...input.params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countItemList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM inv.inventory_items WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  /**
   * Página de movimentos com depósito e item resolvidos como referência humana (código, nome,
   * SKU). É o que permite ler o histórico sem conhecer identificadores técnicos.
   */
  async listMovementPage(input: {
    whereClause: string;
    params: unknown[];
    limit: number;
    offset: number;
  }): Promise<StockMovementListRow[]> {
    const result = await this.pool().query<StockMovementListRow>(
      `SELECT ${MOVEMENT_RETURNING_ALIASED},
              w.code AS warehouse_code, w.name AS warehouse_name,
              i.sku AS item_sku, i.name AS item_name
       FROM inv.stock_movements m
       LEFT JOIN inv.warehouses w ON w.id = m.warehouse_id
       LEFT JOIN inv.inventory_items i ON i.id = m.inventory_item_id
       WHERE ${input.whereClause}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $${input.params.length + 1}
       OFFSET $${input.params.length + 2}`,
      [...input.params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countMovementList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM inv.stock_movements m
       LEFT JOIN inv.warehouses w ON w.id = m.warehouse_id
       LEFT JOIN inv.inventory_items i ON i.id = m.inventory_item_id
       WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async listReservationPage(input: {
    whereClause: string;
    params: unknown[];
    limit: number;
    offset: number;
  }): Promise<StockReservationListRow[]> {
    const result = await this.pool().query<StockReservationListRow>(
      `SELECT r.id, r.unit_id, r.warehouse_id, r.inventory_item_id, r.quantity::text AS quantity,
              r.status::text AS status, r.idempotency_key,
              w.code AS warehouse_code, w.name AS warehouse_name,
              i.sku AS item_sku, i.name AS item_name
       FROM inv.stock_reservations r
       LEFT JOIN inv.warehouses w ON w.id = r.warehouse_id
       LEFT JOIN inv.inventory_items i ON i.id = r.inventory_item_id
       WHERE ${input.whereClause}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $${input.params.length + 1}
       OFFSET $${input.params.length + 2}`,
      [...input.params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countReservationList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM inv.stock_reservations r
       LEFT JOIN inv.warehouses w ON w.id = r.warehouse_id
       LEFT JOIN inv.inventory_items i ON i.id = r.inventory_item_id
       WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async findCostingRuleById(id: string): Promise<CostingRuleRow | null> {
    const result = await this.pool().query<CostingRuleRow>(
      `SELECT ${COSTING_RULE_RETURNING} FROM inv.costing_rules WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findCostingVersionById(id: string): Promise<CostingRuleVersionRow | null> {
    const result = await this.pool().query<CostingRuleVersionRow>(
      `SELECT ${COSTING_VERSION_RETURNING} FROM inv.costing_rule_versions WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findPublishedCostingVersion(
    unitId: string,
    occurredOn: string,
  ): Promise<CostingRuleVersionRow | null> {
    const result = await this.pool().query<CostingRuleVersionRow>(
      `SELECT v.id, v.costing_rule_id, v.version_number, v.status::text AS status,
              v.method::text AS method, v.required_context,
              v.effective_from::text AS effective_from, v.effective_to::text AS effective_to,
              v.source_reference, v.row_version, v.published_at, v.published_by_identity_id
       FROM inv.costing_rule_versions v
       INNER JOIN inv.costing_rules r ON r.id = v.costing_rule_id
       WHERE r.unit_id = $1
         AND r.status = 'ACTIVE'
         AND v.status = 'PUBLISHED'
         AND v.effective_from <= $2::date
         AND (v.effective_to IS NULL OR v.effective_to >= $2::date)
       ORDER BY v.effective_from DESC, v.version_number DESC
       LIMIT 1`,
      [unitId, occurredOn],
    );
    return result.rows[0] ?? null;
  }

  async createCostingRule(input: {
    unitId: string;
    code: string;
    name: string;
    actorIdentityId: string;
  }): Promise<CostingRuleRow> {
    const result = await this.pool().query<CostingRuleRow>(
      `INSERT INTO inv.costing_rules (unit_id, code, name, created_by_identity_id, updated_by_identity_id)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING ${COSTING_RULE_RETURNING}`,
      [input.unitId, input.code, input.name, input.actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new InventoryError('INVENTORY_COSTING_RULE_NOT_CONFIGURED');
    }
    return row;
  }

  async createDraftCostingVersion(input: {
    costingRuleId: string;
    method: string;
    requiredContext: string[];
    effectiveFrom: string;
    effectiveTo: string | null;
    sourceReference: string;
    actorIdentityId: string;
  }): Promise<CostingRuleVersionRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM inv.costing_rules WHERE id = $1 FOR UPDATE`, [
        input.costingRuleId,
      ]);
      const next = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
         FROM inv.costing_rule_versions
         WHERE costing_rule_id = $1`,
        [input.costingRuleId],
      );
      const created = await client.query<CostingRuleVersionRow>(
        `INSERT INTO inv.costing_rule_versions (
           costing_rule_id, version_number, method, required_context, effective_from,
           effective_to, source_reference, created_by_identity_id, updated_by_identity_id
         ) VALUES (
           $1, $2, $3::inv.costing_method_status, $4::jsonb, $5::date, $6::date, $7, $8, $8
         )
         RETURNING ${COSTING_VERSION_RETURNING}`,
        [
          input.costingRuleId,
          next.rows[0]?.next ?? 1,
          input.method,
          JSON.stringify(input.requiredContext),
          input.effectiveFrom,
          input.effectiveTo,
          input.sourceReference,
          input.actorIdentityId,
        ],
      );
      await client.query('COMMIT');
      const row = created.rows[0];
      if (!row) {
        throw new InventoryError('INVENTORY_COSTING_RULE_NOT_CONFIGURED');
      }
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async publishCostingVersion(input: {
    versionId: string;
    rowVersion: number;
    actorIdentityId: string;
  }): Promise<CostingRuleVersionRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<CostingRuleVersionRow>(
        `SELECT ${COSTING_VERSION_RETURNING} FROM inv.costing_rule_versions WHERE id = $1 FOR UPDATE`,
        [input.versionId],
      );
      const version = current.rows[0];
      if (!version) {
        throw new InventoryError('INVENTORY_COSTING_RULE_NOT_CONFIGURED');
      }
      if (version.status === 'PUBLISHED') {
        throw new InventoryError('INVENTORY_COSTING_VERSION_IMMUTABLE');
      }
      if (version.row_version !== input.rowVersion) {
        throw new InventoryError('INVENTORY_NOT_FOUND');
      }
      await client.query(`SELECT id FROM inv.costing_rules WHERE id = $1 FOR UPDATE`, [
        version.costing_rule_id,
      ]);
      const published = await client.query<CostingRuleVersionRow>(
        `SELECT ${COSTING_VERSION_RETURNING}
         FROM inv.costing_rule_versions
         WHERE costing_rule_id = $1 AND status = 'PUBLISHED'`,
        [version.costing_rule_id],
      );
      for (const existing of published.rows) {
        if (
          publishedWindowsOverlap(
            { effectiveFrom: existing.effective_from, effectiveTo: existing.effective_to },
            { effectiveFrom: version.effective_from, effectiveTo: version.effective_to },
          )
        ) {
          throw new InventoryError('INVENTORY_COSTING_VERSION_OVERLAP');
        }
      }
      const updated = await client.query<CostingRuleVersionRow>(
        `UPDATE inv.costing_rule_versions
         SET status = 'PUBLISHED',
             published_at = NOW(),
             published_by_identity_id = $2,
             updated_at = NOW(),
             updated_by_identity_id = $2,
             row_version = row_version + 1
         WHERE id = $1 AND status = 'DRAFT' AND row_version = $3
         RETURNING ${COSTING_VERSION_RETURNING}`,
        [input.versionId, input.actorIdentityId, input.rowVersion],
      );
      await client.query('COMMIT');
      const row = updated.rows[0];
      if (!row) {
        throw new InventoryError('INVENTORY_COSTING_RULE_NOT_CONFIGURED');
      }
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listPostedSignedQuantities(warehouseId: string, inventoryItemId: string): Promise<string[]> {
    const result = await this.pool().query<{ signed_quantity: string }>(
      `SELECT signed_quantity::text AS signed_quantity
       FROM inv.stock_movements
       WHERE warehouse_id = $1 AND inventory_item_id = $2 AND status = 'POSTED'
       ORDER BY created_at`,
      [warehouseId, inventoryItemId],
    );
    return result.rows.map((row) => row.signed_quantity);
  }

  async countNegativeOnHand(): Promise<number> {
    const result = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM inv.stock_balances WHERE on_hand < 0`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async countMovementsByCommand(unitId: string, commandKey: string): Promise<number> {
    const result = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM inv.stock_movements
       WHERE unit_id = $1 AND command_idempotency_key = $2`,
      [unitId, commandKey],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async createWarehouse(input: {
    unitId: string;
    code: string;
    name: string;
    actorIdentityId: string;
  }): Promise<WarehouseRow> {
    const result = await this.pool().query<WarehouseRow>(
      `INSERT INTO inv.warehouses (unit_id, code, name, created_by_identity_id, updated_by_identity_id)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING ${WAREHOUSE_RETURNING}`,
      [input.unitId, input.code, input.name, input.actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new InventoryError('INVENTORY_NOT_FOUND');
    }
    return row;
  }

  async createItem(input: {
    unitId: string;
    sku: string;
    name: string;
    allowsNegativeStock: boolean;
    actorIdentityId: string;
  }): Promise<InventoryItemRow> {
    const result = await this.pool().query<InventoryItemRow>(
      `INSERT INTO inv.inventory_items (
         unit_id, sku, name, allows_negative_stock, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING ${ITEM_RETURNING}`,
      [input.unitId, input.sku, input.name, input.allowsNegativeStock, input.actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new InventoryError('INVENTORY_NOT_FOUND');
    }
    return row;
  }

  async postMovements(inputs: PersistMovementInput[]): Promise<StockMovementRow[]> {
    const existing = await this.findMovementsByCommand(
      inputs[0]?.unitId ?? '',
      inputs[0]?.commandIdempotencyKey ?? '',
    );
    if (existing.length > 0) {
      return existing;
    }
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const positions = uniquePositions(inputs);
      positions.sort(comparePosition);
      for (const position of positions) {
        await this.lockPosition(client, position.warehouseId, position.inventoryItemId);
      }
      const inserted: StockMovementRow[] = [];
      for (const input of inputs) {
        const row = await this.insertMovement(client, input);
        inserted.push(row);
      }
      await client.query('COMMIT');
      return inserted;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error) && inputs[0]) {
        const replay = await this.findMovementsByCommand(
          inputs[0].unitId,
          inputs[0].commandIdempotencyKey,
        );
        if (replay.length > 0) {
          return replay;
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async insertReservation(
    client: PoolClient,
    input: {
      unitId: string;
      warehouseId: string;
      inventoryItemId: string;
      quantity: string;
      idempotencyKey: string;
      sourceKind?: string | null;
      sourceId?: string | null;
      actorIdentityId: string;
    },
  ): Promise<StockReservationRow> {
    const created = await client.query<StockReservationRow>(
      `INSERT INTO inv.stock_reservations (
         unit_id, warehouse_id, inventory_item_id, quantity, idempotency_key,
         source_kind, source_id, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING ${RESERVATION_RETURNING}`,
      [
        input.unitId,
        input.warehouseId,
        input.inventoryItemId,
        input.quantity,
        input.idempotencyKey,
        input.sourceKind ?? null,
        input.sourceId ?? null,
        input.actorIdentityId,
      ],
    );
    const row = created.rows[0];
    if (!row) {
      throw new InventoryError('INVENTORY_NOT_FOUND');
    }
    return row;
  }

  async consumeReservation(
    client: PoolClient,
    reservationId: string,
    actorIdentityId: string,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE inv.stock_reservations
       SET status = 'CONSUMED', updated_at = NOW(), updated_by_identity_id = $2
       WHERE id = $1 AND status = 'ACTIVE'`,
      [reservationId, actorIdentityId],
    );
    if ((result.rowCount ?? 0) !== 1) {
      throw new InventoryError('INVENTORY_NOT_FOUND');
    }
  }

  async releaseReservation(input: {
    reservationId: string;
    actorIdentityId: string;
  }): Promise<StockReservationRow> {
    const result = await this.pool().query<StockReservationRow>(
      `UPDATE inv.stock_reservations
       SET status = 'RELEASED', updated_at = NOW(), updated_by_identity_id = $2
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING ${RESERVATION_RETURNING}`,
      [input.reservationId, input.actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new InventoryError('INVENTORY_NOT_FOUND');
    }
    return row;
  }

  async withLockedPositions<T>(
    positions: Array<{ warehouseId: string; inventoryItemId: string }>,
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const sorted = [...positions].sort(comparePosition);
      for (const position of sorted) {
        await this.lockPosition(client, position.warehouseId, position.inventoryItemId);
      }
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async insertMovement(client: PoolClient, input: PersistMovementInput): Promise<StockMovementRow> {
    const result = await client.query<StockMovementRow>(
      `INSERT INTO inv.stock_movements (
         unit_id, warehouse_id, inventory_item_id, movement_type, quantity, signed_quantity,
         counterpart_warehouse_id, transfer_group_id, transfer_leg, adjustment_effect,
         reservation_id, reversal_of_movement_id, command_idempotency_key, idempotency_key,
         source_kind, source_id, occurred_on, description, created_by_identity_id,
         unit_cost, total_cost, costing_rule_version_id, origin_kind
       ) VALUES (
         $1, $2, $3, $4::inv.stock_movement_type, $5, $6, $7, $8, $9::inv.transfer_leg,
         $10::inv.adjustment_effect, $11, $12, $13, $14, $15, $16, $17::date, $18, $19,
         $20, $21, $22, $23::inv.stock_origin_kind
       )
       RETURNING ${MOVEMENT_RETURNING}`,
      [
        input.unitId,
        input.warehouseId,
        input.inventoryItemId,
        input.movementType,
        input.quantity,
        input.signedQuantity,
        input.counterpartWarehouseId ?? null,
        input.transferGroupId ?? null,
        input.transferLeg ?? null,
        input.adjustmentEffect ?? null,
        input.reservationId ?? null,
        input.reversalOfMovementId ?? null,
        input.commandIdempotencyKey,
        input.idempotencyKey,
        input.sourceKind ?? null,
        input.sourceId ?? null,
        input.occurredOn,
        input.description,
        input.actorIdentityId,
        input.unitCost ?? null,
        input.totalCost ?? null,
        input.costingRuleVersionId ?? null,
        input.originKind ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new InventoryError('INVENTORY_NOT_FOUND');
    }
    return row;
  }

  async loadPositionInside(client: PoolClient, warehouseId: string, inventoryItemId: string) {
    const movements = await client.query<{ signed_quantity: string }>(
      `SELECT signed_quantity::text AS signed_quantity
       FROM inv.stock_movements
       WHERE warehouse_id = $1 AND inventory_item_id = $2 AND status = 'POSTED'`,
      [warehouseId, inventoryItemId],
    );
    const reserved = await client.query<{ quantity: string }>(
      `SELECT quantity::text AS quantity
       FROM inv.stock_reservations
       WHERE warehouse_id = $1 AND inventory_item_id = $2 AND status = 'ACTIVE'`,
      [warehouseId, inventoryItemId],
    );
    return {
      postedSignedQuantities: movements.rows.map((row) => row.signed_quantity),
      activeReservationQuantities: reserved.rows.map((row) => row.quantity),
    };
  }

  private async lockPosition(
    client: PoolClient,
    warehouseId: string,
    inventoryItemId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO inv.stock_position_locks (warehouse_id, inventory_item_id)
       VALUES ($1, $2)
       ON CONFLICT (warehouse_id, inventory_item_id) DO NOTHING`,
      [warehouseId, inventoryItemId],
    );
    await client.query(
      `SELECT warehouse_id
       FROM inv.stock_position_locks
       WHERE warehouse_id = $1 AND inventory_item_id = $2
       FOR UPDATE`,
      [warehouseId, inventoryItemId],
    );
  }
}

function uniquePositions(inputs: PersistMovementInput[]) {
  const seen = new Map<string, { warehouseId: string; inventoryItemId: string }>();
  for (const input of inputs) {
    const key = `${input.warehouseId}:${input.inventoryItemId}`;
    seen.set(key, { warehouseId: input.warehouseId, inventoryItemId: input.inventoryItemId });
  }
  return [...seen.values()];
}

function comparePosition(
  left: { warehouseId: string; inventoryItemId: string },
  right: { warehouseId: string; inventoryItemId: string },
): number {
  return `${left.warehouseId}:${left.inventoryItemId}`.localeCompare(
    `${right.warehouseId}:${right.inventoryItemId}`,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

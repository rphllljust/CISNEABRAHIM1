import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateIdentityAndAuthorizationTables,
  truncateInventoryTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { STOCK_MOVEMENT_TYPES } from './domain/inventory';
import { INVENTORY_ERROR_CODES } from './errors/inventory-error-codes';
import { InventoryHttpException } from './errors/inventory-http.exception';
import { InventoryModule } from './inventory.module';
import { InventoryAccessService } from './services/inventory-access.service';
import { InventoryRepository } from './repositories/inventory.repository';

const UNIT = 'unit-inv-a';

async function grantInventoryAdmin(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.InventoryItemManage,
    AUTHZ_ACTIONS.InventoryItemList,
    AUTHZ_ACTIONS.InventoryWarehouseManage,
    AUTHZ_ACTIONS.InventoryWarehouseList,
    AUTHZ_ACTIONS.InventoryMove,
    AUTHZ_ACTIONS.InventoryMovementList,
    AUTHZ_ACTIONS.InventoryReserve,
    AUTHZ_ACTIONS.InventoryReservationList,
    AUTHZ_ACTIONS.InventoryRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.InventoryStock,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Inventory core PostgreSQL integration', () => {
  let pool: Pool;
  let inventory: InventoryAccessService;
  let repository: InventoryRepository;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for inventory integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, InventoryModule],
    }).compile();
    inventory = module.get(InventoryAccessService);
    repository = module.get(InventoryRepository);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateInventoryTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`inv-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantInventoryAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedStock(actor: { identityId: string; sessionId: string }) {
    const origin = await inventory.createWarehouse(actor, {
      unitId: UNIT,
      code: 'WH-ORIGIN',
      name: 'Origin warehouse',
    });
    const destination = await inventory.createWarehouse(actor, {
      unitId: UNIT,
      code: 'WH-DEST',
      name: 'Destination warehouse',
    });
    const item = await inventory.createItem(actor, {
      unitId: UNIT,
      sku: 'SKU-QTY-1',
      name: 'Quantity-controlled item',
    });
    return { origin, destination, item };
  }

  it('lists warehouses, items, movements and reservations with human references', async () => {
    const actor = await seedActor();
    const { origin, destination, item } = await seedStock(actor);
    await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '25.0000',
      occurredOn: '2026-09-02',
      description: 'Recebimento inicial',
      idempotencyKey: `in-${crypto.randomUUID()}`,
    });
    await inventory.reserve(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      quantity: '5.0000',
      idempotencyKey: `res-${crypto.randomUUID()}`,
    });

    const warehousePage = await inventory.listWarehouses(actor, { limit: 1, offset: 0 });
    expect(warehousePage.total).toBe(2);
    expect(warehousePage.totalPages).toBe(2);
    expect(warehousePage.items[0]).toMatchObject({ code: 'WH-DEST' });

    const searchedWarehouse = await inventory.listWarehouses(actor, {
      limit: 20,
      offset: 0,
      q: 'Origin',
    });
    expect(searchedWarehouse.items.map((row) => row.id)).toEqual([origin.id]);

    const itemPage = await inventory.listItems(actor, { limit: 20, offset: 0, q: 'SKU-QTY-1' });
    expect(itemPage.total).toBe(1);
    expect(itemPage.items[0]?.id).toBe(item.id);

    const movements = await inventory.listMovements(actor, { limit: 20, offset: 0 });
    expect(movements.total).toBe(1);
    // A linha identifica depósito e item por código/nome/SKU, nunca por identificador técnico.
    expect(movements.items[0]).toMatchObject({
      warehouseCode: 'WH-ORIGIN',
      warehouseName: 'Origin warehouse',
      itemSku: 'SKU-QTY-1',
      description: 'Recebimento inicial',
      status: 'POSTED',
    });

    const byWarehouse = await inventory.listMovements(actor, {
      limit: 20,
      offset: 0,
      warehouseId: destination.id,
    });
    expect(byWarehouse.total).toBe(0);
    const byItem = await inventory.listMovements(actor, {
      limit: 20,
      offset: 0,
      inventoryItemId: item.id,
    });
    expect(byItem.total).toBe(1);
    const byType = await inventory.listMovements(actor, { limit: 20, offset: 0, movementType: 'OUT' });
    expect(byType.total).toBe(0);
    const bySearch = await inventory.listMovements(actor, { limit: 20, offset: 0, q: 'WH-ORIGIN' });
    expect(bySearch.total).toBe(1);

    const reservations = await inventory.listReservations(actor, { limit: 20, offset: 0, status: 'ACTIVE' });
    expect(reservations.total).toBe(1);
    expect(reservations.items[0]).toMatchObject({
      warehouseCode: 'WH-ORIGIN',
      itemSku: 'SKU-QTY-1',
      status: 'ACTIVE',
    });
  });

  it('denies the inventory lists without the list grants', async () => {
    const actor = await seedActor();
    await seedStock(actor);
    await inventory.listWarehouses(actor, { limit: 20, offset: 0 });

    const outsider = await seedActor(false);
    for (const call of [
      () => inventory.listWarehouses(outsider, { limit: 20, offset: 0 }),
      () => inventory.listItems(outsider, { limit: 20, offset: 0 }),
      () => inventory.listMovements(outsider, { limit: 20, offset: 0 }),
      () => inventory.listReservations(outsider, { limit: 20, offset: 0 }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: INVENTORY_ERROR_CODES.DENIED });
    }

    // Somente `read` não autoriza listar.
    const reader = await seedActor(false);
    await insertGrant(pool, {
      identityId: reader.identityId,
      action: AUTHZ_ACTIONS.InventoryRead,
      resourceType: AUTHZ_RESOURCE_TYPES.InventoryStock,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: reader.identityId,
    });
    await expect(inventory.listItems(reader, { limit: 20, offset: 0 })).rejects.toMatchObject({
      code: INVENTORY_ERROR_CODES.DENIED,
    });
  });

  it('posts entry and exit without writing a physical asset or allowing a default negative balance', async () => {
    const actor = await seedActor();
    const { origin, item } = await seedStock(actor);
    const inbound = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '100.0000',
      occurredOn: '2026-09-01',
      description: 'Receipt',
      idempotencyKey: `in-${crypto.randomUUID()}`,
    });
    expect(inbound.balance.onHand).toBe('100');
    const outbound = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.Out,
      quantity: '30.0000',
      occurredOn: '2026-09-01',
      description: 'Issue',
      idempotencyKey: `out-${crypto.randomUUID()}`,
    });
    expect(outbound.balance.onHand).toBe('70');
    await expect(
      inventory.postStock(actor, {
        unitId: UNIT,
        warehouseId: origin.id,
        inventoryItemId: item.id,
        movementType: STOCK_MOVEMENT_TYPES.Out,
        quantity: '80.0000',
        occurredOn: '2026-09-01',
        description: 'Overdraw',
        idempotencyKey: `over-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: INVENTORY_ERROR_CODES.INSUFFICIENT_STOCK });
    expect(await repository.countNegativeOnHand()).toBe(0);
    const assets = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ast.physical_assets`,
    );
    expect(assets.rows[0]?.count).toBe('0');
  });

  it('transfers atomically and rolls back a failed destination so origin is unchanged', async () => {
    const actor = await seedActor();
    const { origin, destination, item } = await seedStock(actor);
    await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '40.0000',
      occurredOn: '2026-09-01',
      description: 'Receipt',
      idempotencyKey: `tin-${crypto.randomUUID()}`,
    });
    const transferred = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.Transfer,
      quantity: '15.0000',
      occurredOn: '2026-09-01',
      description: 'Transfer',
      destinationWarehouseId: destination.id,
      idempotencyKey: `xfer-${crypto.randomUUID()}`,
    });
    expect(transferred.movements).toHaveLength(2);
    expect(transferred.balance.onHand).toBe('25');
    const dest = await inventory.getBalance(actor, destination.id, item.id);
    expect(dest.onHand).toBe('15');
    await expect(
      inventory.postStock(actor, {
        unitId: UNIT,
        warehouseId: origin.id,
        inventoryItemId: item.id,
        movementType: STOCK_MOVEMENT_TYPES.Transfer,
        quantity: '5.0000',
        occurredOn: '2026-09-01',
        description: 'Bad dest',
        destinationWarehouseId: crypto.randomUUID(),
        idempotencyKey: `bad-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: INVENTORY_ERROR_CODES.NOT_FOUND });
    const originAfter = await inventory.getBalance(actor, origin.id, item.id);
    expect(originAfter.onHand).toBe('25');
  });

  it('reserves available quantity, consumes it on exit, and reverses a movement', async () => {
    const actor = await seedActor();
    const { origin, item } = await seedStock(actor);
    const inboundKey = `rin-${crypto.randomUUID()}`;
    await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '20.0000',
      occurredOn: '2026-09-01',
      description: 'Receipt',
      idempotencyKey: inboundKey,
    });
    const reserved = await inventory.reserve(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      quantity: '8.0000',
      idempotencyKey: `res-${crypto.randomUUID()}`,
    });
    const afterReserve = await inventory.getBalance(actor, origin.id, item.id);
    expect(afterReserve.reserved).toBe('8');
    expect(afterReserve.available).toBe('12');
    await expect(
      inventory.postStock(actor, {
        unitId: UNIT,
        warehouseId: origin.id,
        inventoryItemId: item.id,
        movementType: STOCK_MOVEMENT_TYPES.Out,
        quantity: '15.0000',
        occurredOn: '2026-09-01',
        description: 'Blocked by reservation',
        idempotencyKey: `block-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: INVENTORY_ERROR_CODES.INSUFFICIENT_STOCK });
    const consumeKey = `cons-${crypto.randomUUID()}`;
    const consumed = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.Out,
      quantity: '8.0000',
      occurredOn: '2026-09-01',
      description: 'Consume reservation',
      reservationId: reserved.id,
      idempotencyKey: consumeKey,
    });
    expect(consumed.balance.onHand).toBe('12');
    expect(consumed.balance.reserved).toBe('0');
    const reversed = await inventory.reverse(actor, consumeKey, UNIT, `rev-${consumeKey}`);
    expect(reversed.balance.onHand).toBe('20');
    expect(item.allowsNegativeStock).toBe(false);
    expect(await repository.countNegativeOnHand()).toBe(0);
  });

  it('does not let concurrent withdrawals consume more than available and is idempotent', async () => {
    const actor = await seedActor();
    const { origin, item } = await seedStock(actor);
    await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '100.0000',
      occurredOn: '2026-09-01',
      description: 'Receipt',
      idempotencyKey: `cin-${crypto.randomUUID()}`,
    });
    const results = await Promise.allSettled([
      inventory.postStock(actor, {
        unitId: UNIT,
        warehouseId: origin.id,
        inventoryItemId: item.id,
        movementType: STOCK_MOVEMENT_TYPES.Out,
        quantity: '60.0000',
        occurredOn: '2026-09-01',
        description: 'A',
        idempotencyKey: `a-${crypto.randomUUID()}`,
      }),
      inventory.postStock(actor, {
        unitId: UNIT,
        warehouseId: origin.id,
        inventoryItemId: item.id,
        movementType: STOCK_MOVEMENT_TYPES.Out,
        quantity: '60.0000',
        occurredOn: '2026-09-01',
        description: 'B',
        idempotencyKey: `b-${crypto.randomUUID()}`,
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const balance = await inventory.getBalance(actor, origin.id, item.id);
    expect(balance.onHand).toBe('40');
    expect(await repository.countNegativeOnHand()).toBe(0);
    const key = `dup-${crypto.randomUUID()}`;
    const first = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.Out,
      quantity: '5.0000',
      occurredOn: '2026-09-01',
      description: 'Dup',
      idempotencyKey: key,
    });
    const second = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.Out,
      quantity: '5.0000',
      occurredOn: '2026-09-01',
      description: 'Dup',
      idempotencyKey: key,
    });
    expect(second.idempotent).toBe(true);
    expect(second.movements[0]?.id).toBe(first.movements[0]?.id);
    expect(await repository.countMovementsByCommand(UNIT, key)).toBe(1);
  });

  it('reconciles the stock read model to posted movements and denies unauthorized moves', async () => {
    const admin = await seedActor(true);
    const stranger = await seedActor(false);
    const { origin, item } = await seedStock(admin);
    await inventory.postStock(admin, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '11.0000',
      occurredOn: '2026-09-01',
      description: 'Receipt',
      idempotencyKey: `rec-${crypto.randomUUID()}`,
    });
    const reconciled = await inventory.reconcile(admin, origin.id, item.id);
    expect(reconciled.matches).toBe(true);
    await expect(
      inventory.postStock(stranger, {
        unitId: UNIT,
        warehouseId: origin.id,
        inventoryItemId: item.id,
        movementType: STOCK_MOVEMENT_TYPES.Out,
        quantity: '1.0000',
        occurredOn: '2026-09-01',
        description: 'Denied',
        idempotencyKey: `deny-${crypto.randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(InventoryHttpException);
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [item.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['security:inventory:move']),
    );
    expect(() => inventory.valueStock()).toThrowError('INVENTORY_COST_METHOD_NOT_DECIDED');
  });
});

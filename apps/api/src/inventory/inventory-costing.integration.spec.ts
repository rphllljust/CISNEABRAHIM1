import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateAccountingTables,
  truncateIdentityAndAuthorizationTables,
  truncateInventoryTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountingModule } from '../accounting/accounting.module';
import { ACCOUNT_CLASSES } from '../accounting/domain/ledger';
import { POSTING_EVENTS, POSTING_ORIGINS } from '../accounting/domain/posting';
import { AccountingAccessService } from '../accounting/services/accounting-access.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { ADJUSTMENT_EFFECTS, STOCK_MOVEMENT_TYPES } from './domain/inventory';
import { STOCK_ORIGINS } from './domain/costing';
import { INVENTORY_ERROR_CODES } from './errors/inventory-error-codes';
import { InventoryModule } from './inventory.module';
import { EconomicPostingService } from '../accounting/services/economic-posting.service';
import { InventoryAccessService } from './services/inventory-access.service';
import { InventoryAccountingIntegrationService } from './services/inventory-accounting-integration.service';
import { InventoryRepository } from './repositories/inventory.repository';

const UNIT = 'unit-inv-cost';

async function grantAll(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.InventoryItemManage,
    AUTHZ_ACTIONS.InventoryWarehouseManage,
    AUTHZ_ACTIONS.InventoryMove,
    AUTHZ_ACTIONS.InventoryReserve,
    AUTHZ_ACTIONS.InventoryRead,
    AUTHZ_ACTIONS.InventoryCostingRuleManage,
    AUTHZ_ACTIONS.InventoryCostingRulePublish,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.InventoryStock,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
  for (const action of [
    AUTHZ_ACTIONS.AccountingChartManage,
    AUTHZ_ACTIONS.AccountingPeriodOpen,
    AUTHZ_ACTIONS.AccountingPeriodClose,
    AUTHZ_ACTIONS.AccountingJournalDraft,
    AUTHZ_ACTIONS.AccountingJournalPost,
    AUTHZ_ACTIONS.AccountingJournalReverse,
    AUTHZ_ACTIONS.AccountingJournalRead,
    AUTHZ_ACTIONS.AccountingJournalList,
    AUTHZ_ACTIONS.AccountingPostingRuleManage,
    AUTHZ_ACTIONS.AccountingPostingRulePublish,
    AUTHZ_ACTIONS.AccountingPostingRequest,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Inventory costing and accounting PostgreSQL', () => {
  let pool: Pool;
  let inventory: InventoryAccessService;
  let accounting: AccountingAccessService;
  let integration: InventoryAccountingIntegrationService;
  let economicPosting: EconomicPostingService;
  let repository: InventoryRepository;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for inventory costing integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, InventoryModule, AccountingModule],
    }).compile();
    inventory = module.get(InventoryAccessService);
    accounting = module.get(AccountingAccessService);
    integration = module.get(InventoryAccountingIntegrationService);
    economicPosting = module.get(EconomicPostingService);
    repository = module.get(InventoryRepository);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateInventoryTables(pool);
    await truncateAccountingTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`invc-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantAll(pool, identityId);
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
      sku: 'SKU-COST-1',
      name: 'Cost-controlled item',
    });
    const rule = await inventory.createCostingRule(actor, {
      unitId: UNIT,
      code: 'UNDECIDED-DEFAULT',
      name: 'Undecided costing strategy',
    });
    const draft = await inventory.createCostingRuleVersion(actor, rule.id, {
      method: 'UNDECIDED',
      effectiveFrom: '2026-01-01',
      sourceReference: 'TEST-INVENTORY-COSTING',
    });
    const published = await inventory.publishCostingRuleVersion(actor, draft.id, {
      rowVersion: draft.rowVersion,
    });
    return { origin, destination, item, rule, published };
  }

  async function seedLedger(actor: { identityId: string; sessionId: string }) {
    const chart = await accounting.createChart(actor, {
      unitId: UNIT,
      code: `COA-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Inventory posting chart',
    });
    const debit = await accounting.createAccount(actor, chart.id, {
      code: '1.3.10',
      name: 'Inventory',
      class: ACCOUNT_CLASSES.Asset,
    });
    const credit = await accounting.createAccount(actor, chart.id, {
      code: '2.1.10',
      name: 'Inventory counterpart',
      class: ACCOUNT_CLASSES.Liability,
    });
    await accounting.createPeriod(actor, {
      chartId: chart.id,
      unitId: UNIT,
      code: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    return { chart, debit, credit };
  }

  async function publishEventRule(
    actor: { identityId: string; sessionId: string },
    debitAccountId: string,
    creditAccountId: string,
  ) {
    const rule = await accounting.createPostingRule(actor, {
      unitId: UNIT,
      code: `INV-${crypto.randomUUID().slice(0, 6)}`,
      name: 'Inventory movement posted',
      originKind: POSTING_ORIGINS.Inventory,
      eventKind: POSTING_EVENTS.InventoryMovementPosted,
    });
    const draft = await accounting.createPostingRuleVersion(actor, rule.id, {
      debitAccountId,
      creditAccountId,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceReference: 'TEST-INVENTORY-POSTING',
    });
    return accounting.publishPostingRuleVersion(actor, draft.id, { rowVersion: draft.rowVersion });
  }

  async function countPostedJournals() {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acc.journal_entries WHERE status = 'POSTED'`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /**
   * F1.2 — DRENA A OUTBOX DA MOVIMENTAÇÃO.
   *
   * O estoque NÃO contabiliza mais durante `postStock`: ele publica o FATO econômico na
   * outbox, na mesma transação da movimentação. Quem contabiliza é o consumidor da
   * outbox, de forma retentável e observável. Então "existe journal?" só pode ser
   * respondido DEPOIS de entregar o evento.
   *
   * Isto não enfraquece a asserção — torna explícito o contrato novo. O que se prova
   * continua sendo o mesmo: a movimentação gera UM journal, a origem é INVENTORY, e o
   * inventário nunca escreve em `acc.*`.
   */
  async function drainOutbox(sourceId: string): Promise<void> {
    const events = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM evt.outbox_events
        WHERE aggregate_id = $1::uuid AND event_type = 'INVENTORY_MOVEMENT_POSTED'`,
      [sourceId],
    );
    for (const row of events.rows) {
      await economicPosting.consume(row.payload);
    }
  }

  it('posts entry, exit, transfer, adjustment and reversal with explicit cost and version', async () => {
    const actor = await seedActor();
    const { origin, destination, item, published } = await seedStock(actor);
    const inbound = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '20.0000',
      unitCost: '5.0000',
      occurredOn: '2026-09-01',
      description: 'Receipt',
      idempotencyKey: `in-${crypto.randomUUID()}`,
    });
    expect(inbound.movements[0]?.unitCost).toBe('5');
    expect(inbound.movements[0]?.totalCost).toBe('100');
    expect(inbound.movements[0]?.costingRuleVersionId).toBe(published.id);
    expect(inbound.movements[0]?.originKind).toBe(STOCK_ORIGINS.Receipt);
    expect(inbound.balance.onHand).toBe('20');

    const outbound = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.Out,
      quantity: '4.0000',
      unitCost: '5.0000',
      occurredOn: '2026-09-01',
      description: 'Issue',
      idempotencyKey: `out-${crypto.randomUUID()}`,
    });
    expect(outbound.movements[0]?.originKind).toBe(STOCK_ORIGINS.Issue);
    expect(outbound.movements[0]?.totalCost).toBe('20');
    expect(outbound.balance.onHand).toBe('16');

    const transferred = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.Transfer,
      quantity: '6.0000',
      unitCost: '5.0000',
      occurredOn: '2026-09-01',
      description: 'Transfer',
      destinationWarehouseId: destination.id,
      idempotencyKey: `xfer-${crypto.randomUUID()}`,
    });
    expect(transferred.movements).toHaveLength(2);
    expect(transferred.movements.every((row) => row.originKind === STOCK_ORIGINS.Transfer)).toBe(true);
    expect(transferred.movements.every((row) => row.totalCost === '30')).toBe(true);

    const adjusted = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.Adjustment,
      quantity: '1.0000',
      unitCost: '5.0000',
      adjustmentEffect: ADJUSTMENT_EFFECTS.Increase,
      occurredOn: '2026-09-01',
      description: 'Adjustment',
      idempotencyKey: `adj-${crypto.randomUUID()}`,
    });
    expect(adjusted.movements[0]?.originKind).toBe(STOCK_ORIGINS.Adjustment);

    const outboundKey = outbound.movements[0]!.commandIdempotencyKey;
    const reversed = await inventory.reverse(actor, outboundKey, UNIT, `rev-${outboundKey}`);
    expect(reversed.movements[0]?.originKind).toBe(STOCK_ORIGINS.Reversal);
    expect(reversed.movements[0]?.unitCost).toBe('5');
    expect(reversed.movements[0]?.totalCost).toBe('20');
    expect(reversed.movements[0]?.costingRuleVersionId).toBe(published.id);

    const stock = await inventory.reconcile(actor, origin.id, item.id);
    expect(stock.matches).toBe(true);
    const cost = await inventory.reconcileCost(actor, origin.id, item.id);
    expect(cost.matches).toBe(true);
    expect(cost.movementCount).toBeGreaterThan(0);
  });

  it('refuses FIFO/LIFO/average versions and keeps published versions immutable', async () => {
    const actor = await seedActor();
    const { rule, published } = await seedStock(actor);
    await expect(
      inventory.createCostingRuleVersion(actor, rule.id, {
        method: 'FIFO',
        effectiveFrom: '2026-10-01',
        sourceReference: 'INVENTED-FIFO',
      }),
    ).rejects.toMatchObject({ code: INVENTORY_ERROR_CODES.COST_METHOD_NOT_DECIDED });
    await expect(
      inventory.createCostingRuleVersion(actor, rule.id, {
        method: 'LIFO',
        effectiveFrom: '2026-10-01',
        sourceReference: 'INVENTED-LIFO',
      }),
    ).rejects.toMatchObject({ code: INVENTORY_ERROR_CODES.COST_METHOD_NOT_DECIDED });
    await expect(
      inventory.publishCostingRuleVersion(actor, published.id, { rowVersion: published.rowVersion }),
    ).rejects.toMatchObject({ code: INVENTORY_ERROR_CODES.COSTING_VERSION_IMMUTABLE });
    await expect(
      pool.query(`UPDATE inv.costing_rule_versions SET source_reference = 'mutated' WHERE id = $1`, [
        published.id,
      ]),
    ).rejects.toThrow(/INVENTORY_COSTING_VERSION_IMMUTABLE/);
  });

  it('does not let concurrent withdrawals overdraw and treats duplicate commands as one movement', async () => {
    const actor = await seedActor();
    const { origin, item } = await seedStock(actor);
    await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '100.0000',
      unitCost: '2.0000',
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
        unitCost: '2.0000',
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
        unitCost: '2.0000',
        occurredOn: '2026-09-01',
        description: 'B',
        idempotencyKey: `b-${crypto.randomUUID()}`,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const key = `dup-${crypto.randomUUID()}`;
    const first = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.Out,
      quantity: '5.0000',
      unitCost: '2.0000',
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
      unitCost: '2.0000',
      occurredOn: '2026-09-01',
      description: 'Dup',
      idempotencyKey: key,
    });
    expect(second.idempotent).toBe(true);
    expect(second.movements[0]?.id).toBe(first.movements[0]?.id);
    expect(await repository.countMovementsByCommand(UNIT, key)).toBe(1);
    expect(await inventory.reconcileCost(actor, origin.id, item.id)).toMatchObject({ matches: true });
  });

  it('posts StockMovementPosted through the accounting port without inventory writing acc.*', async () => {
    const actor = await seedActor();
    const { origin, item } = await seedStock(actor);
    const { debit, credit } = await seedLedger(actor);
    await publishEventRule(actor, debit.id, credit.id);
    const inbound = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '8.0000',
      unitCost: '10.0000',
      occurredOn: '2026-09-01',
      description: 'Receipt',
      idempotencyKey: `acc-${crypto.randomUUID()}`,
    });
    // O fato já está publicado; a contabilização acontece na entrega da outbox.
    await drainOutbox(inbound.movements[0]!.id);
    expect(await countPostedJournals()).toBe(1);
    const retried = await integration.postPostedMovement(actor, inbound.movements[0]!.id);
    expect(retried?.idempotent).toBe(true);
    const journal = await accounting.getJournal(actor, retried!.journalEntryId);
    expect(journal.balanced).toBe(true);
    expect(journal.debitTotal).toBe(journal.creditTotal);
    const requests = await pool.query<{ origin_kind: string; count: string }>(
      `SELECT origin_kind::text AS origin_kind, COUNT(*)::text AS count
       FROM acc.accounting_posting_requests
       GROUP BY origin_kind`,
    );
    expect(requests.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ origin_kind: 'INVENTORY', count: '1' })]),
    );
    const source = await pool.query<{ source_kind: string }>(
      `SELECT source_kind::text AS source_kind FROM acc.journal_entries WHERE id = $1`,
      [retried!.journalEntryId],
    );
    expect(source.rows[0]?.source_kind).toBe('INVENTORY');
  });

  it('does not create a journal when no accounting rule exists and rejects silent movement edits', async () => {
    const actor = await seedActor();
    const { origin, item } = await seedStock(actor);
    const inbound = await inventory.postStock(actor, {
      unitId: UNIT,
      warehouseId: origin.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '3.0000',
      unitCost: '4.0000',
      occurredOn: '2026-09-01',
      description: 'Receipt',
      idempotencyKey: `norule-${crypto.randomUUID()}`,
    });
    expect(await countPostedJournals()).toBe(0);
    await expect(
      pool.query(`UPDATE inv.stock_movements SET quantity = 1 WHERE id = $1`, [
        inbound.movements[0]!.id,
      ]),
    ).rejects.toThrow(/INVENTORY_MOVEMENT_IMMUTABLE/);
    expect(() => inventory.valueStock()).toThrowError('INVENTORY_COST_METHOD_NOT_DECIDED');
  });
});

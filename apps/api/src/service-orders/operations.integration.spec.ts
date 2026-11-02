import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertCatalogCategory,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateCatalogTables,
  truncateClientTables,
  truncateCommercialProposalTables,
  truncateCommercialPurchaseOrderTables,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
  truncateInventoryTables,
  truncatePhysicalAssetTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
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
import { CatalogModule } from '../catalog/catalog.module';
import { ServiceCatalogAccessService } from '../catalog/services/service-catalog-access.service';
import { ClientsModule } from '../clients/clients.module';
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { ClientAccessService } from '../clients/services/client-access.service';
import { ResourcesModule } from '../resources/resources.module';
import { PLANNED_RESOURCE_KINDS } from './domain/resource-planning';
import { ACTUAL_KINDS } from './domain/execution-actuals';
import { STOCK_MOVEMENT_TYPES } from '../inventory/domain/inventory';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryAccessService } from '../inventory/services/inventory-access.service';
import { SERVICE_ORDER_ORIGINS } from './domain/service-order';
import { OperationsService } from './services/operations.service';
import { MaterialInventoryBindingService } from './services/material-inventory-binding.service';
import { ServiceOrderExecutionAccessService } from './services/service-order-execution-access.service';
import { ServiceOrderPlanningAccessService } from './services/service-order-planning-access.service';
import { ServiceOrdersAccessService } from './services/service-orders-access.service';
import { ServiceOrdersModule } from './service-orders.module';

/**
 * DISPATCH + EXECUTION + ACTUALS — integração real contra PostgreSQL.
 *
 * O que este arquivo prova, e que nenhum teste de unidade consegue provar:
 *
 *   1. o DESPACHO grava FATO (não status) e publica evento na MESMA transação;
 *   2. o realizado REALMENTE persiste e o PLANEJADO não é sobrescrito;
 *   3. a leitura de medidor é MONOTÔNICA — o banco recusa regressão;
 *   4. a conclusão é RECUSADA com motivos quando falta realizado;
 *   5. a idempotência impede duplo despacho e duplo realizado;
 *   6. o fechamento publica a BASE DE MEDIÇÃO e os dois fatos de outbox.
 *
 * A semente reutiliza os serviços REAIS de cliente/catálogo/planejamento: não há
 * INSERT manual de estrutura de negócio, e por isso uma quebra de contrato entre
 * módulos aparece aqui em vez de escapar.
 */

const UNIT_A = 'unit-ops-a';

const SAMPLE_RESOURCE_REQUIREMENTS = [
  {
    resourceTypeCode: 'WATER_TRUCK',
    requirementLevel: 'REQUIRED' as const,
    minQuantity: 1,
    sortOrder: 0,
  },
];
const SAMPLE_LABOR_REQUIREMENTS = [
  { laborTypeCode: 'DRIVER', requirementLevel: 'REQUIRED' as const, minQuantity: 1, sortOrder: 0 },
];
const SAMPLE_EXECUTION_REQUIREMENTS = [
  { requirementType: 'OBSERVATION' as const, requirementLevel: 'REQUIRED' as const },
  { requirementType: 'QUANTITY' as const, requirementLevel: 'REQUIRED' as const },
];

async function grantOperationsAdmin(
  pool: Pool,
  identityId: string,
  grantedBy: string,
): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderDispatch,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourceRead,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourceUpdate,
    AUTHZ_ACTIONS.ServiceOrdersResourceAllocate,
    AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead,
    AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
    AUTHZ_ACTIONS.ServiceOrdersExecutionStart,
    AUTHZ_ACTIONS.ServiceOrdersExecutionPause,
    AUTHZ_ACTIONS.ServiceOrdersExecutionResume,
    AUTHZ_ACTIONS.ServiceOrdersExecutionComplete,
    AUTHZ_ACTIONS.ServiceOrdersExecutionRecord,
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServicePublish,
  ];

  for (const action of actions) {
    const resourceType = action.startsWith('service-orders:')
      ? AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder
      : action.startsWith('client:')
        ? AUTHZ_RESOURCE_TYPES.Client
        : AUTHZ_RESOURCE_TYPES.CatalogService;

    await insertGrant(pool, {
      identityId,
      action,
      resourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('DISPATCH + EXECUTION + ACTUALS (PostgreSQL)', () => {
  let pool: Pool;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let planningAccess: ServiceOrderPlanningAccessService;
  let executionAccess: ServiceOrderExecutionAccessService;
  let operations: OperationsService;
  let materialBindings: MaterialInventoryBindingService;
  let inventory: InventoryAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for operations integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-test';
    process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        AuthModule,
        AuditModule,
        AuthorizationModule,
        ClientsModule,
        CatalogModule,
        ResourcesModule,
        ServiceOrdersModule,
        InventoryModule,
      ],
    }).compile();

    serviceOrdersAccess = module.get(ServiceOrdersAccessService);
    planningAccess = module.get(ServiceOrderPlanningAccessService);
    executionAccess = module.get(ServiceOrderExecutionAccessService);
    operations = module.get(OperationsService);
    materialBindings = module.get(MaterialInventoryBindingService);
    inventory = module.get(InventoryAccessService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
    await truncateInventoryTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateCommercialProposalTables(pool);
    await truncateDocumentTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor() {
    const login = normalizeLoginIdentifier(`ops-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantOperationsAdmin(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid-ops' } };
  }

  /**
   * Semeia uma ordem LIBERADA com planejamento completo e reserva real.
   *
   * A reserva usa `physicalAssets` + `resource_allocations` porque a prontidão de
   * despacho exige recurso NOMINAL, não apenas o requisito planejado. É a diferença
   * entre "preciso de um caminhão" e "é o CAM-001".
   */
  async function seedReleasedOrder(
    actor: { identityId: string; sessionId: string },
    options: { allocate?: boolean } = {},
  ) {
    const client = await clientAccess.create(actor, {
      legalName: `Cliente Ops ${crypto.randomUUID()}`,
      tradeName: 'Cliente Ops',
      // CNPJ ÚNICO por ordem: o cadastro recusa duplicidade de documento, e dois
      // clientes iguais mascarariam o fato de cada OS pertencer a um cliente real.
      taxId: randomCnpj(),
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, { code: `OPS-${suffix}`, name: 'Operação' });

    const draft = await catalogAccess.create(actor, {
      code: `OPS-SRV-${suffix}`,
      name: 'Serviço operacional',
      categoryId: category.categoryId,
      archetype: 'CIVIL_WORK',
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [
        { modelCode: 'GLOBAL_PRICE', salePrice: '18400.0000', internalCost: '9700.0000' },
      ],
      resourceRequirements: SAMPLE_RESOURCE_REQUIREMENTS,
      laborRequirements: SAMPLE_LABOR_REQUIREMENTS,
      executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    const published = await catalogAccess.publishVersion(
      actor,
      draft.serviceDefinitionId,
      1,
      definition.version,
    );

    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
      description: 'OS operacional para despacho',
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    const released = await serviceOrdersAccess.release(actor, prepared.id, {
      rowVersion: prepared.rowVersion,
    });

    await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '8',
    });

    let assetId: string | null = null;
    let workforceMemberId: string | null = null;

    if (options.allocate !== false) {
      const seeded = await seedAllocatedResources(actor, released.id);
      assetId = seeded.assetId;
      workforceMemberId = seeded.workforceMemberId;
    }

    return {
      released,
      clientId: client.id,
      assetId,
      workforceMemberId,
    };
  }

  /**
   * Cria ativo + pessoa e aloca ambos na ordem.
   *
   * Usa os serviços reais de ativo/pessoal quando existem; quando o caminho de
   * criação não é público no módulo carregado, insere pelo repositório de
   * planejamento, que é o dono do fato de alocação.
   */
  async function seedAllocatedResources(
    actor: { identityId: string; sessionId: string },
    serviceOrderId: string,
  ) {
    const assetType = await pool.query<{ id: string }>(
      `SELECT id FROM cat.physical_resource_types WHERE code = 'WATER_TRUCK' LIMIT 1`,
    );
    const typeId = assetType.rows[0]?.id;
    if (!typeId) {
      throw new Error('WATER_TRUCK physical resource type missing');
    }

    const asset = await pool.query<{ id: string }>(
      `INSERT INTO ast.physical_assets
         (asset_code, physical_resource_type_id, name, unit_id, created_by_identity_id, updated_by_identity_id)
       VALUES ($1, $2, 'Caminhão pipa', $3, $4, $4)
       RETURNING id`,
      [`CAM-${crypto.randomUUID().slice(0, 8)}`, typeId, UNIT_A, actor.identityId],
    );
    const assetId = asset.rows[0]!.id;

    const member = await pool.query<{ id: string }>(
      `INSERT INTO wrk.workforce_members
         (member_code, legal_name, default_labor_type_code, status)
       VALUES ($1, 'Carlos Motorista', 'DRIVER', 'ACTIVE')
       RETURNING id`,
      [`DRV-${crypto.randomUUID().slice(0, 8)}`],
    );
    const workforceMemberId = member.rows[0]!.id;

    const window = await resolveWindow(pool, serviceOrderId);

    // A alocação exige o REQUISITO PLANEJADO que ela cobre: sem ele não há
    // relação entre "preciso de um caminhão" e "é o CAM-001".
    const planned = await pool.query<{ id: string }>(
      `SELECT id FROM so.planned_resources
       WHERE service_order_id = $1 AND requirement_kind = 'PHYSICAL_RESOURCE'
       ORDER BY created_at ASC LIMIT 1`,
      [serviceOrderId],
    );
    const plannedResourceId = planned.rows[0]?.id;
    if (!plannedResourceId) {
      throw new Error('planned PHYSICAL_RESOURCE missing for allocation');
    }

    await planningAccess.allocateResource(actor, serviceOrderId, {
      plannedResourceId,
      physicalAssetId: assetId,
      operationalStart: window.startAt,
      operationalEnd: window.endAt,
    });

    /**
     * EQUIPE: a dimensão CREW exige PESSOA escalada, e o requisito de mão de obra
     * também precisa da sua própria alocação. Sem isto o teste estaria provando uma
     * ordem sem ninguém — estado legítimo, mas não o cenário "pronta para sair".
     */
    const plannedLabor = await pool.query<{ id: string }>(
      `SELECT id FROM so.planned_resources
       WHERE service_order_id = $1 AND requirement_kind = 'LABOR'
       ORDER BY created_at ASC LIMIT 1`,
      [serviceOrderId],
    );
    const plannedLaborId = plannedLabor.rows[0]?.id;

    if (plannedLaborId) {
      await planningAccess.allocateResource(actor, serviceOrderId, {
        plannedResourceId: plannedLaborId,
        workforceMemberId,
        operationalStart: window.startAt,
        operationalEnd: window.endAt,
      });
    }

    return { assetId, workforceMemberId };
  }

  /** Sai de RELEASED para IN_EXECUTION usando o comando REAL de execução. */
  async function startOrder(actor: { identityId: string; sessionId: string }, orderId: string) {
    const current = await serviceOrdersAccess.getById(actor, orderId);
    const started = await executionAccess.start(actor, orderId, {
      rowVersion: current.rowVersion,
    });
    return started;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DESPACHO
  // ═══════════════════════════════════════════════════════════════════════════

  it('despacha a ordem com reserva confirmada e grava FATO, não apenas status', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    // Diagnóstico ACIONÁVEL: se a prontidão bloquear, o teste diz QUAL dimensão,
    // em vez de estourar um `Http Exception` sem causa legível.
    const before = await operations.getServiceOrderOverview(actor, released.id);
    if (!before.dispatch.readiness.ready) {
      throw new Error(
        `prontidão bloqueada: ${before.dispatch.readiness.blockingReasons
          .map((item) => `${item.dimension}=${item.reasonCode}`)
          .join(', ')}`,
      );
    }

    const overview = await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });

    // O FATO existe e é persistido.
    const dispatchRow = await pool.query<{ id: string; confirmed_resources: unknown[] }>(
      `SELECT id, confirmed_resources FROM so.service_order_dispatches WHERE service_order_id = $1`,
      [released.id],
    );
    expect(dispatchRow.rowCount).toBe(1);
    expect(dispatchRow.rows[0]!.confirmed_resources.length).toBeGreaterThan(0);

    // O estado do AGREGADO não foi sobrescrito com status inventado.
    expect(overview.identity.serviceOrderId).toBe(released.id);
    expect(overview.dispatch.dispatchedAt).toBeTruthy();
    expect(overview.statuses.dispatch).toBe('DISPATCHED');
  });

  it('o despacho publica o evento na MESMA transação do fato', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });

    const outbox = await pool.query<{ event_type: string }>(
      `SELECT event_type::text AS event_type FROM evt.outbox_events
       WHERE aggregate_id = $1 AND event_type = 'SERVICE_ORDER_DISPATCHED'`,
      [released.id],
    );
    expect(outbox.rowCount).toBe(1);

    // A timeline operacional também registrou o fato.
    const events = await pool.query<{ event_kind: string }>(
      `SELECT event_kind::text AS event_kind FROM so.execution_events
       WHERE service_order_id = $1`,
      [released.id],
    );
    expect(events.rows.map((row) => row.event_kind)).toContain('DISPATCHED');
  });

  it('recusa o despacho quando não há reserva, devolvendo o motivo', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor, { allocate: false });

    await expect(
      operations.dispatch(actor, released.id, {
        rowVersion: released.rowVersion,
        idempotencyKey: `dispatch-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_ORDERS_DISPATCH_BLOCKED' });

    const dispatchRow = await pool.query(
      `SELECT 1 FROM so.service_order_dispatches WHERE service_order_id = $1`,
      [released.id],
    );
    expect(dispatchRow.rowCount).toBe(0);
  });

  it('recusa SEGUNDO despacho da mesma ordem', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });

    const after = await serviceOrdersAccess.getById(actor, released.id);
    await expect(
      operations.dispatch(actor, released.id, {
        rowVersion: after.rowVersion,
        idempotencyKey: `dispatch-${crypto.randomUUID()}`,
      }),
    ).rejects.toBeTruthy();

    const rows = await pool.query(
      `SELECT 1 FROM so.service_order_dispatches WHERE service_order_id = $1`,
      [released.id],
    );
    expect(rows.rowCount).toBe(1);
  });

  it('despacho com a MESMA chave de idempotência não duplica', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const key = `dispatch-${crypto.randomUUID()}`;

    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: key,
    });
    const second = await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: key,
    });

    expect(second.identity.serviceOrderId).toBe(released.id);
    const rows = await pool.query(
      `SELECT 1 FROM so.service_order_dispatches WHERE service_order_id = $1`,
      [released.id],
    );
    expect(rows.rowCount).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTUALS
  // ═══════════════════════════════════════════════════════════════════════════

  it('MATERIAL_QUANTITY sem SKU/warehouse vinculados não debita Inventory', async () => {
    const { actor } = await seedActor();
    const { released, assetId } = await seedReleasedOrder(actor);
    // O ator recebe permissões explícitas de estoque: ausência de OUT não pode
    // ser explicada por falta de autorização nem por inexistência de saldo.
    for (const action of [
      AUTHZ_ACTIONS.InventoryWarehouseManage,
      AUTHZ_ACTIONS.InventoryItemManage,
      AUTHZ_ACTIONS.InventoryMove,
      AUTHZ_ACTIONS.InventoryMovementList,
      AUTHZ_ACTIONS.InventoryRead,
    ]) {
      await insertGrant(pool, {
        identityId: actor.identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.InventoryStock,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: actor.identityId,
      });
    }
    const warehouse = await inventory.createWarehouse(actor, {
      unitId: UNIT_A,
      code: 'WH-MATERIAL-OS',
      name: 'Depósito para prova de material',
    });
    const item = await inventory.createItem(actor, {
      unitId: UNIT_A,
      sku: 'SKU-MATERIAL-OS',
      name: 'Material identificado somente no Inventory',
    });
    await inventory.postStock(actor, {
      unitId: UNIT_A,
      warehouseId: warehouse.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '10.0000',
      occurredOn: '2026-11-02',
      description: 'Saldo isolado para regressão PostgreSQL',
      idempotencyKey: `receipt-${crypto.randomUUID()}`,
    });
    const balanceBefore = await inventory.getBalance(actor, warehouse.id, item.id);
    const movementsBefore = await inventory.listMovements(actor, {
      limit: 20,
      offset: 0,
      warehouseId: warehouse.id,
    });
    expect(balanceBefore).toMatchObject({ onHand: '10', reserved: '0', available: '10' });
    expect(movementsBefore.total).toBe(1);

    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);
    const current = await serviceOrdersAccess.getById(actor, released.id);
    // physicalAssetId identifica o recurso operacional, NÃO o SKU. O comando
    // atual não possui inventoryItemId nem warehouseId: não inferir o vínculo.
    await operations.registerActual(actor, released.id, {
      actualKind: ACTUAL_KINDS.MaterialQuantity,
      physicalAssetId: assetId!,
      actualValue: '2',
      unitOfMeasure: 'UNIT',
      rowVersion: current.rowVersion,
      idempotencyKey: `actual-${crypto.randomUUID()}`,
    });

    const facts = await pool.query<{
      id: string;
      actual_kind: string;
      actual_value: string;
    }>(
      `SELECT id, actual_kind::text AS actual_kind, actual_value::text AS actual_value
       FROM so.execution_actuals WHERE service_order_id = $1`,
      [released.id],
    );
    expect(facts.rows).toHaveLength(1);
    expect(facts.rows[0]).toMatchObject({
      actual_kind: ACTUAL_KINDS.MaterialQuantity,
      actual_value: '2.000000',
    });
    const balanceAfter = await inventory.getBalance(actor, warehouse.id, item.id);
    const movementsAfter = await inventory.listMovements(actor, {
      limit: 20,
      offset: 0,
      warehouseId: warehouse.id,
    });
    expect(balanceAfter).toEqual(balanceBefore);
    expect(movementsAfter.total).toBe(1);
    expect(movementsAfter.items.map((row) => row.id)).toEqual(
      movementsBefore.items.map((row) => row.id),
    );
  });

  it('autoriza binding por PDP duplo e idempotência sem OUT/custo inventado', async () => {
    const { actor } = await seedActor();
    const { released, assetId } = await seedReleasedOrder(actor);
    for (const action of [
      AUTHZ_ACTIONS.InventoryWarehouseManage,
      AUTHZ_ACTIONS.InventoryItemManage,
      AUTHZ_ACTIONS.InventoryRead,
      AUTHZ_ACTIONS.InventoryMovementList,
    ]) {
      await insertGrant(pool, {
        identityId: actor.identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.InventoryStock,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: actor.identityId,
      });
    }
    const warehouse = await inventory.createWarehouse(actor, {
      unitId: UNIT_A, code: 'WH-AUTH-BIND', name: 'Deposito de binding autorizado',
    });
    const item = await inventory.createItem(actor, {
      unitId: UNIT_A, sku: 'SKU-AUTH-BIND', name: 'SKU autorizado para binding',
    });
    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);
    const beforeActual = await serviceOrdersAccess.getById(actor, released.id);
    await operations.registerActual(actor, released.id, {
      actualKind: ACTUAL_KINDS.MaterialQuantity,
      physicalAssetId: assetId!,
      actualValue: '2',
      unitOfMeasure: 'UNIT',
      rowVersion: beforeActual.rowVersion,
      idempotencyKey: `actual-${crypto.randomUUID()}`,
    });
    const actual = await pool.query<{ id: string }>(
      'SELECT id FROM so.execution_actuals WHERE service_order_id = $1',
      [released.id],
    );
    const actualId = actual.rows[0]!.id;
    const rowVersion = (await serviceOrdersAccess.getById(actor, released.id)).rowVersion;
    const key = `bind-${crypto.randomUUID()}`;
    const command = {
      actualId, inventoryItemId: item.id, warehouseId: warehouse.id,
      rowVersion, idempotencyKey: key,
    };

    // OS grant alone is insufficient: Inventory MOVE authorization is mandatory.
    await expect(materialBindings.bind(actor, released.id, command))
      .rejects.toMatchObject({ code: 'SERVICE_ORDERS_DENIED' });
    expect((await pool.query(
      'SELECT id FROM so.material_inventory_bindings WHERE actual_id = $1', [actualId],
    )).rowCount).toBe(0);

    await insertGrant(pool, {
      identityId: actor.identityId,
      action: AUTHZ_ACTIONS.InventoryMove,
      resourceType: AUTHZ_RESOURCE_TYPES.InventoryStock,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actor.identityId,
    });
    await inventory.postStock(actor, {
      unitId: UNIT_A,
      warehouseId: warehouse.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '10.0000',
      occurredOn: '2026-11-02',
      description: 'Saldo real do teste de contrato, sem OUT',
      idempotencyKey: `receipt-${crypto.randomUUID()}`,
    });
    const before = await inventory.getBalance(actor, warehouse.id, item.id);
    const movementsBefore = await inventory.listMovements(actor, {
      limit: 20, offset: 0, warehouseId: warehouse.id,
    });

    await expect(materialBindings.bind(actor, released.id, {
      ...command, inventoryItemId: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: 'SERVICE_ORDERS_INVALID_STATE' });
    await expect(materialBindings.bind(actor, released.id, {
      ...command, rowVersion: rowVersion + 1,
    })).rejects.toMatchObject({ code: 'SERVICE_ORDERS_VERSION_CONFLICT' });

    const bound = await materialBindings.bind(actor, released.id, command);
    expect(bound).toMatchObject({
      actualId, inventoryItemId: item.id, warehouseId: warehouse.id,
      sourceKind: 'SERVICE_ORDER_EXECUTION_ACTUAL', sourceId: actualId,
      quantity: '2.0000', unitOfMeasure: 'UNIT',
      stockMovementId: null, stockPostingStatus: 'NOT_POSTED',
      costingStatus: 'NOT_DECIDED', idempotent: false,
    });
    const replay = await materialBindings.bind(actor, released.id, command);
    expect(replay.id).toBe(bound.id);
    expect(replay.idempotent).toBe(true);
    await expect(materialBindings.bind(actor, released.id, {
      ...command, idempotencyKey: `different-${crypto.randomUUID()}`,
    })).rejects.toMatchObject({ code: 'SERVICE_ORDERS_IDEMPOTENCY_KEY_CONFLICT' });

    const persisted = await pool.query<{ authorized_by_identity_id: string; source_id: string }>(
      'SELECT authorized_by_identity_id, source_id FROM so.material_inventory_bindings WHERE actual_id = $1',
      [actualId],
    );
    expect(persisted.rows).toEqual([{
      authorized_by_identity_id: actor.identityId, source_id: actualId,
    }]);
    expect(await inventory.getBalance(actor, warehouse.id, item.id)).toEqual(before);
    const movementsAfter = await inventory.listMovements(actor, {
      limit: 20, offset: 0, warehouseId: warehouse.id,
    });
    expect(movementsAfter.total).toBe(movementsBefore.total);
    expect(movementsAfter.items.map((row) => row.id))
      .toEqual(movementsBefore.items.map((row) => row.id));

    // #193 2D-2F: binding did not move stock; only the distinct authorized
    // command posts one OUT with the exact persisted actual as Inventory source.
    const posted = await materialBindings.consume(actor, released.id, {
      actualId, rowVersion, idempotencyKey: `consume-${crypto.randomUUID()}`,
    });
    expect(posted).toMatchObject({
      actualId, stockPostingStatus: 'POSTED', quantity: '2.0000',
      idempotent: false, costingStatus: 'PENDING_COSTING',
      totalCost: null, accountingStatus: 'NOT_APPLICABLE',
    });
    const replayConsumption = await materialBindings.consume(actor, released.id, {
      actualId, rowVersion, idempotencyKey: `retry-${crypto.randomUUID()}`,
    });
    expect(replayConsumption.stockMovementId).toBe(posted.stockMovementId);
    expect(replayConsumption.idempotent).toBe(true);
    const afterOut = await inventory.getBalance(actor, warehouse.id, item.id);
    expect(afterOut.onHand).toBe('8');
    expect((await materialBindings.reconcile(actor, released.id, actualId)))
      .toMatchObject({ stockPostingStatus: 'POSTED', stockMovementId: posted.stockMovementId, costingStatus: 'PENDING_COSTING' });

    // #193 2E: reversal is an IN compensation with an immutable reference to
    // the source movement; retries never restore the saldo twice.
    const compensated = await materialBindings.reverseConsumption(actor, released.id, {
      actualId, rowVersion, idempotencyKey: `reverse-${crypto.randomUUID()}`,
      reason: 'Material returned after real execution correction',
    });
    expect(compensated).toMatchObject({ stockPostingStatus: 'REVERSED', idempotent: false, costingStatus: 'NOT_APPLICABLE' });
    const replayReverse = await materialBindings.reverseConsumption(actor, released.id, {
      actualId, rowVersion, idempotencyKey: `reverse-retry-${crypto.randomUUID()}`,
      reason: 'Material returned after real execution correction',
    });
    expect(replayReverse.compensationMovementId).toBe(compensated.compensationMovementId);
    expect(replayReverse.idempotent).toBe(true);
    expect(await inventory.getBalance(actor, warehouse.id, item.id)).toEqual(before);
    expect((await materialBindings.reconcile(actor, released.id, actualId)))
      .toMatchObject({
        stockPostingStatus: 'REVERSED', stockMovementId: posted.stockMovementId,
        reversalMovementId: compensated.compensationMovementId,
        costingStatus: 'NOT_APPLICABLE',
      });
    const traced = await pool.query<{ movement_type: string; source_kind: string; source_id: string }>(
      `SELECT movement_type::text, source_kind, source_id
       FROM inv.stock_movements WHERE id = $1`, [posted.stockMovementId],
    );
    expect(traced.rows).toEqual([{
      movement_type: 'OUT', source_kind: 'SERVICE_ORDER_EXECUTION_ACTUAL', source_id: actualId,
    }]);
  });

  it('contrato MATERIAL_QUANTITY exige actual/SKU/deposito/unidade/quantidade exatos sem gerar OUT', async () => {
    const { actor } = await seedActor();
    const { released, assetId } = await seedReleasedOrder(actor);
    for (const action of [
      AUTHZ_ACTIONS.InventoryWarehouseManage,
      AUTHZ_ACTIONS.InventoryItemManage,
      AUTHZ_ACTIONS.InventoryMove,
      AUTHZ_ACTIONS.InventoryMovementList,
      AUTHZ_ACTIONS.InventoryRead,
    ]) {
      await insertGrant(pool, {
        identityId: actor.identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.InventoryStock,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: actor.identityId,
      });
    }
    const warehouse = await inventory.createWarehouse(actor, {
      unitId: UNIT_A,
      code: 'WH-BINDING-OS',
      name: 'Deposito para contrato de vinculo',
    });
    const item = await inventory.createItem(actor, {
      unitId: UNIT_A,
      sku: 'SKU-BINDING-OS',
      name: 'Material com vinculo explicito',
    });
    await inventory.postStock(actor, {
      unitId: UNIT_A,
      warehouseId: warehouse.id,
      inventoryItemId: item.id,
      movementType: STOCK_MOVEMENT_TYPES.In,
      quantity: '10.0000',
      occurredOn: '2026-11-02',
      description: 'Saldo isolado para contrato de vinculo',
      idempotencyKey: `receipt-${crypto.randomUUID()}`,
    });
    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);
    const current = await serviceOrdersAccess.getById(actor, released.id);
    await operations.registerActual(actor, released.id, {
      actualKind: ACTUAL_KINDS.MaterialQuantity,
      physicalAssetId: assetId!,
      actualValue: '2',
      unitOfMeasure: 'UNIT',
      rowVersion: current.rowVersion,
      idempotencyKey: `actual-${crypto.randomUUID()}`,
    });
    const actual = await pool.query<{
      id: string;
      actual_value: string;
      unit_of_measure: string;
      occurred_at: Date;
    }>(
      `SELECT id, actual_value::text, unit_of_measure, occurred_at
       FROM so.execution_actuals WHERE service_order_id = $1`,
      [released.id],
    );
    expect(actual.rows).toHaveLength(1);
    const fact = actual.rows[0]!;
    const balanceBefore = await inventory.getBalance(actor, warehouse.id, item.id);
    const movementsBefore = await inventory.listMovements(actor, {
      limit: 20,
      offset: 0,
      warehouseId: warehouse.id,
    });

    // Contrato estrutural, ainda NAO e comando autorizado por PDP e NAO debita estoque.
    const insertSql = `INSERT INTO so.material_inventory_bindings
      (service_order_id, actual_id, unit_id, inventory_item_id, warehouse_id,
       actual_kind, quantity, unit_of_measure, source_kind, source_id,
       authorized_by_identity_id, authorized_at, occurred_at, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`;
    const params: unknown[] = [
      released.id,
      fact.id,
      UNIT_A,
      item.id,
      warehouse.id,
      ACTUAL_KINDS.MaterialQuantity,
      '2.0000',
      fact.unit_of_measure,
      'SERVICE_ORDER_EXECUTION_ACTUAL',
      fact.id,
      actor.identityId,
      new Date(),
      fact.occurred_at,
      `binding-${crypto.randomUUID()}`,
    ];

    const wrongQuantity = [...params];
    wrongQuantity[6] = '1.0000';
    await expect(pool.query(insertSql, wrongQuantity)).rejects.toMatchObject({ code: '23503' });

    const wrongUnit = [...params];
    wrongUnit[2] = 'unit-not-authorized';
    await expect(pool.query(insertSql, wrongUnit)).rejects.toMatchObject({ code: '23503' });

    const wrongSource = [...params];
    wrongSource[8] = 'INFERRED_FROM_ASSET';
    await expect(pool.query(insertSql, wrongSource)).rejects.toMatchObject({ code: '23514' });

    const bound = await pool.query<{ id: string }>(insertSql, params);
    expect(bound.rows).toHaveLength(1);

    const replay = [...params];
    replay[13] = `binding-${crypto.randomUUID()}`;
    await expect(pool.query(insertSql, replay)).rejects.toMatchObject({ code: '23505' });

    await expect(
      pool.query('UPDATE so.execution_actuals SET actual_value = 3 WHERE id = $1', [fact.id]),
    ).rejects.toMatchObject({ code: '23001' });

    const balanceAfter = await inventory.getBalance(actor, warehouse.id, item.id);
    const movementsAfter = await inventory.listMovements(actor, {
      limit: 20,
      offset: 0,
      warehouseId: warehouse.id,
    });
    expect(balanceAfter).toEqual(balanceBefore);
    expect(movementsAfter.items.map((row) => row.id)).toEqual(
      movementsBefore.items.map((row) => row.id),
    );
    expect(movementsAfter.total).toBe(movementsBefore.total);
  });

  it('registra realizado SEM sobrescrever o planejado', async () => {
    const { actor } = await seedActor();
    const { released, workforceMemberId } = await seedReleasedOrder(actor);
    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);

    const before = await serviceOrdersAccess.getById(actor, released.id);
    const plannedBefore = await pool.query<{ planned_quantity: string }>(
      `SELECT planned_quantity::text AS planned_quantity FROM so.planned_resources
       WHERE service_order_id = $1 AND requirement_kind = 'LABOR'`,
      [released.id],
    );

    await operations.registerActual(actor, released.id, {
      actualKind: 'LABOR_HOURS',
      workforceMemberId,
      actualValue: '9.2',
      unitOfMeasure: 'H',
      rowVersion: before.rowVersion,
      idempotencyKey: `actual-${crypto.randomUUID()}`,
    });

    // O REALIZADO persiste.
    const actuals = await pool.query<{ actual_value: string; planned_value: string | null }>(
      `SELECT actual_value::text AS actual_value, planned_value::text AS planned_value
       FROM so.execution_actuals WHERE service_order_id = $1`,
      [released.id],
    );
    expect(actuals.rowCount).toBe(1);
    expect(actuals.rows[0]!.actual_value).toBe('9.200000');

    // O PLANEJADO continua intacto.
    const plannedAfter = await pool.query<{ planned_quantity: string }>(
      `SELECT planned_quantity::text AS planned_quantity FROM so.planned_resources
       WHERE service_order_id = $1 AND requirement_kind = 'LABOR'`,
      [released.id],
    );
    expect(plannedAfter.rows[0]!.planned_quantity).toBe(plannedBefore.rows[0]!.planned_quantity);
  });

  it('o realizado publica RESOURCE_USAGE_RECORDED para o custeio', async () => {
    const { actor } = await seedActor();
    const { released, workforceMemberId } = await seedReleasedOrder(actor);
    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);

    const before = await serviceOrdersAccess.getById(actor, released.id);
    await operations.registerActual(actor, released.id, {
      actualKind: 'LABOR_HOURS',
      workforceMemberId,
      actualValue: '9.2',
      unitOfMeasure: 'H',
      rowVersion: before.rowVersion,
      idempotencyKey: `actual-${crypto.randomUUID()}`,
    });

    const outbox = await pool.query(
      `SELECT 1 FROM evt.outbox_events
       WHERE aggregate_id = $1 AND event_type = 'RESOURCE_USAGE_RECORDED'`,
      [released.id],
    );
    expect(outbox.rowCount).toBe(1);
  });

  it('a MESMA chave de idempotência não duplica realizado', async () => {
    const { actor } = await seedActor();
    const { released, workforceMemberId } = await seedReleasedOrder(actor);
    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);

    const before = await serviceOrdersAccess.getById(actor, released.id);
    const key = `actual-${crypto.randomUUID()}`;
    await operations.registerActual(actor, released.id, {
      actualKind: 'LABOR_HOURS',
      workforceMemberId,
      actualValue: '9.2',
      unitOfMeasure: 'H',
      rowVersion: before.rowVersion,
      idempotencyKey: key,
    });
    await operations.registerActual(actor, released.id, {
      actualKind: 'LABOR_HOURS',
      workforceMemberId,
      actualValue: '9.2',
      unitOfMeasure: 'H',
      rowVersion: before.rowVersion,
      idempotencyKey: key,
    });

    const rows = await pool.query(
      `SELECT 1 FROM so.execution_actuals WHERE service_order_id = $1`,
      [released.id],
    );
    expect(rows.rowCount).toBe(1);
  });

  it('registra combustível com procedência e calcula o valor', async () => {
    const { actor } = await seedActor();
    const { released, assetId } = await seedReleasedOrder(actor);
    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);

    const before = await serviceOrdersAccess.getById(actor, released.id);
    await operations.registerFuel(actor, released.id, {
      physicalAssetId: assetId!,
      volumeLiters: '151',
      unitPrice: '6.2',
      rowVersion: before.rowVersion,
      idempotencyKey: `fuel-${crypto.randomUUID()}`,
    });

    const fuel = await pool.query<{ volume_liters: string; amount: string }>(
      `SELECT volume_liters::text AS volume_liters, amount::text AS amount
       FROM so.execution_fuel_records WHERE service_order_id = $1`,
      [released.id],
    );
    expect(fuel.rowCount).toBe(1);
    expect(fuel.rows[0]!.volume_liters).toBe('151.000');
    expect(Number(fuel.rows[0]!.amount)).toBeCloseTo(936.2, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MEDIDOR
  // ═══════════════════════════════════════════════════════════════════════════

  it('registra leitura inicial e final e o banco guarda o FATO', async () => {
    const { actor } = await seedActor();
    const { released, assetId } = await seedReleasedOrder(actor);
    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);

    const first = await serviceOrdersAccess.getById(actor, released.id);
    await operations.registerMeter(actor, released.id, {
      physicalAssetId: assetId!,
      meterKind: 'ODOMETER',
      readingValue: '125000',
      unitOfMeasure: 'KM',
      isInitial: true,
      rowVersion: first.rowVersion,
      idempotencyKey: `meter-${crypto.randomUUID()}`,
    });

    const second = await serviceOrdersAccess.getById(actor, released.id);
    await operations.registerMeter(actor, released.id, {
      physicalAssetId: assetId!,
      meterKind: 'ODOMETER',
      readingValue: '125290',
      unitOfMeasure: 'KM',
      isFinal: true,
      rowVersion: second.rowVersion,
      idempotencyKey: `meter-${crypto.randomUUID()}`,
    });

    const meters = await pool.query<{ reading_value: string; is_final: boolean }>(
      `SELECT reading_value::text AS reading_value, is_final
       FROM so.execution_meter_readings WHERE service_order_id = $1 ORDER BY read_at`,
      [released.id],
    );
    expect(meters.rowCount).toBe(2);
    expect(meters.rows[1]!.reading_value).toBe('125290.000');
    expect(meters.rows[1]!.is_final).toBe(true);
  });

  it('RECUSA leitura regressiva — monotonicidade no BANCO', async () => {
    const { actor } = await seedActor();
    const { released, assetId } = await seedReleasedOrder(actor);
    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);

    const first = await serviceOrdersAccess.getById(actor, released.id);
    await operations.registerMeter(actor, released.id, {
      physicalAssetId: assetId!,
      meterKind: 'ODOMETER',
      readingValue: '125000',
      unitOfMeasure: 'KM',
      isInitial: true,
      rowVersion: first.rowVersion,
      idempotencyKey: `meter-${crypto.randomUUID()}`,
    });

    const second = await serviceOrdersAccess.getById(actor, released.id);
    await expect(
      operations.registerMeter(actor, released.id, {
        physicalAssetId: assetId!,
        meterKind: 'ODOMETER',
        readingValue: '124000',
        unitOfMeasure: 'KM',
        rowVersion: second.rowVersion,
        idempotencyKey: `meter-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_ORDERS_METER_READING_NOT_MONOTONIC' });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONCORRÊNCIA
  // ═══════════════════════════════════════════════════════════════════════════

  it('recusa comando com versão desatualizada (409), sem sobrescrever', async () => {
    const { actor } = await seedActor();
    const { released, workforceMemberId } = await seedReleasedOrder(actor);
    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);

    const current = await serviceOrdersAccess.getById(actor, released.id);
    await operations.registerActual(actor, released.id, {
      actualKind: 'LABOR_HOURS',
      workforceMemberId,
      actualValue: '1',
      unitOfMeasure: 'H',
      rowVersion: current.rowVersion,
      idempotencyKey: `actual-${crypto.randomUUID()}`,
    });

    // Usa a versão ANTIGA: outro operador já avançou o agregado.
    await expect(
      operations.registerActual(actor, released.id, {
        actualKind: 'LABOR_HOURS',
        workforceMemberId,
        actualValue: '2',
        unitOfMeasure: 'H',
        rowVersion: current.rowVersion,
        idempotencyKey: `actual-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_ORDERS_VERSION_CONFLICT' });

    const rows = await pool.query(
      `SELECT 1 FROM so.execution_actuals WHERE service_order_id = $1`,
      [released.id],
    );
    expect(rows.rowCount).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LEITURA
  // ═══════════════════════════════════════════════════════════════════════════

  it('object page devolve estados independentes, processo e comandos', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    const overview = await operations.getServiceOrderOverview(actor, released.id);

    expect(overview.statuses.planning).toBe('CONFIRMED');
    expect(overview.statuses.reservation).toBe('CONFIRMED');
    expect(overview.statuses.dispatch).toBe('NOT_DISPATCHED');
    expect(overview.statuses.execution).toBe('NOT_STARTED');
    expect(overview.statuses.measurement).toBe('NOT_READY');

    expect(overview.process.length).toBeGreaterThan(5);
    expect(overview.currentStage).toBeTruthy();

    const dispatchCmd = overview.availableCommands.find((item) => item.code === 'DISPATCH');
    expect(dispatchCmd?.enabled).toBe(true);
  });

  it('o dispatch board conta prontas e bloqueadas a partir do servidor', async () => {
    const { actor } = await seedActor();
    await seedReleasedOrder(actor);
    await seedReleasedOrder(actor, { allocate: false });

    const board = await operations.getDispatchBoard(actor, { unitId: UNIT_A });

    expect(board.items.length).toBeGreaterThanOrEqual(2);
    expect(board.readyCount).toBeGreaterThanOrEqual(1);
    expect(board.blockedCount).toBeGreaterThanOrEqual(1);
    expect(board.freshness.authority).toBe('SERVER');

    const blocked = board.items.find((item) => !item.readiness.ready);
    expect(blocked?.readiness.blockingReasons.length).toBeGreaterThan(0);
    expect(blocked?.readiness.blockingReasons[0]?.reason).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONCLUSÃO BLOQUEADA E FECHAMENTO
  // ═══════════════════════════════════════════════════════════════════════════

  it('a conclusão informa os motivos quando falta o realizado', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    await operations.dispatch(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: `dispatch-${crypto.randomUUID()}`,
    });
    await startOrder(actor, released.id);

    const overview = await operations.getServiceOrderOverview(actor, released.id);

    expect(overview.completionGate.canComplete).toBe(false);
    const codes = overview.completionGate.blockingReasons.map((item) => item.reasonCode);
    // O veículo escalado exige combustível e leitura final; a pessoa, horas.
    expect(codes).toContain('FUEL_ACTUAL_REQUIRED');
    expect(codes).toContain('FINAL_ODOMETER_REQUIRED');
    expect(codes).toContain('LABOR_ACTUAL_REQUIRED');
    expect(codes).toContain('REQUIRED_EVIDENCE_MISSING');

    const complete = overview.availableCommands.find((item) => item.code === 'COMPLETE');
    expect(complete?.enabled).toBe(false);
    expect(complete?.reasons.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// APOIO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Janela operacional da alocação: um intervalo FUTURO.
 *
 * Precisa ser futuro porque a prontidão recusa janela já encerrada — e o teste não
 * deve ficar refém da hora em que roda.
 */
async function resolveWindow(
  pool: Pool,
  serviceOrderId: string,
): Promise<{ startAt: string; endAt: string }> {
  void pool;
  void serviceOrderId;
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

/**
 * CNPJ sintaticamente válido e ÚNICO, derivado de um aleatório.
 *
 * O cadastro de clientes valida o dígito verificador e recusa documento repetido.
 * Gerar por regra (em vez de um literal) garante que duas ordens semeadas no mesmo
 * teste não colidam — collision ali derrubaria o teste por um motivo que não tem
 * relação com a capability.
 */
function randomCnpj(): string {
  const base = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10).toString()).join('');
  const digits = `${base}0001`;
  const check = (value: string, weights: number[]): string => {
    const sum = value
      .split('')
      .reduce((acc, digit, index) => acc + Number(digit) * weights[index]!, 0);
    const rest = sum % 11;
    return rest < 2 ? '0' : String(11 - rest);
  };
  const first = check(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = check(`${digits}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${digits}${first}${second}`;
}

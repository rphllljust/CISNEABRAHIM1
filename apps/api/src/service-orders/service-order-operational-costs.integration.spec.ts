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
import { OPERATIONAL_COST_CATEGORIES, OPERATIONAL_COST_KINDS, OPERATIONAL_COST_ORIGINS } from './domain/operational-cost';
import { PLANNED_RESOURCE_KINDS } from './domain/resource-planning';
import { SERVICE_ORDER_ORIGINS } from './domain/service-order';
import { SERVICE_ORDERS_ERROR_CODES } from './errors/service-orders-error-codes';
import { ServiceOrdersModule } from './service-orders.module';
import { OperationalCostAccessService } from './services/operational-cost-access.service';
import { OperationsService } from './services/operations.service';
import { ServiceOrderExecutionAccessService } from './services/service-order-execution-access.service';
import { ServiceOrderPlanningAccessService } from './services/service-order-planning-access.service';
import { ServiceOrdersAccessService } from './services/service-orders-access.service';

const UNIT_A = 'unit-cost-a';
const TEST_CNPJ = '11222333000181';

const SAMPLE_RESOURCE_REQUIREMENTS = [
  {
    resourceTypeCode: 'WATER_TRUCK',
    requirementLevel: 'REQUIRED' as const,
    minQuantity: 1,
    sortOrder: 0,
  },
];

const SAMPLE_LABOR_REQUIREMENTS = [
  {
    laborTypeCode: 'DRIVER',
    requirementLevel: 'REQUIRED' as const,
    minQuantity: 1,
    sortOrder: 0,
  },
];

const SAMPLE_EXECUTION_REQUIREMENTS = [
  { requirementType: 'OBSERVATION' as const, requirementLevel: 'REQUIRED' as const },
  { requirementType: 'QUANTITY' as const, requirementLevel: 'REQUIRED' as const },
];

async function grantOperationalCostAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourceRead,
    AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
    AUTHZ_ACTIONS.ServiceOrdersExecutionStart,
    AUTHZ_ACTIONS.ServiceOrdersExecutionRecord,
    AUTHZ_ACTIONS.ServiceOrdersOperationalCostRead,
    AUTHZ_ACTIONS.ServiceOrdersOperationalCostRecord,
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

describe('Operational costs PostgreSQL integration', () => {
  let pool: Pool;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let planningAccess: ServiceOrderPlanningAccessService;
  let executionAccess: ServiceOrderExecutionAccessService;
  let operationalCostAccess: OperationalCostAccessService;
  let operations: OperationsService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for operational cost integration tests.');
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
      ],
    }).compile();

    serviceOrdersAccess = module.get(ServiceOrdersAccessService);
    planningAccess = module.get(ServiceOrderPlanningAccessService);
    executionAccess = module.get(ServiceOrderExecutionAccessService);
    operationalCostAccess = module.get(OperationalCostAccessService);
    operations = module.get(OperationsService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
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
    const login = normalizeLoginIdentifier(`cost-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantOperationalCostAdmin(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedReleasedOrder(actor: { identityId: string; sessionId: string }) {
    const client = await clientAccess.create(actor, {
      legalName: `Cliente Custo ${crypto.randomUUID()}`,
      tradeName: 'Cliente Custo',
      taxId: TEST_CNPJ,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, {
      code: `CAT-${suffix}`,
      name: 'Serviços',
    });
    const draft = await catalogAccess.create(actor, {
      code: `COST-SRV-${suffix}`,
      name: 'Serviço com custos',
      categoryId: category.categoryId,
      archetype: 'CIVIL_WORK',
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '1000.0000', internalCost: '800.0000' }],
      resourceRequirements: SAMPLE_RESOURCE_REQUIREMENTS,
      laborRequirements: SAMPLE_LABOR_REQUIREMENTS,
      executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    const published = await catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);

    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
      description: 'OS para custos operacionais',
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, { rowVersion: created.rowVersion });
    const released = await serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion });

    await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '1',
    });

    return { released };
  }

  it('publishes no invented BRL cost for physical execution without a cost entry', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const initial = await operations.getServiceOrderOverview(actor, released.id);
    expect(initial.economics).toEqual({ plannedRevenue: null, plannedCost: null, currencyCode: null });

    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordQuantity(actor, started.id, {
      rowVersion: started.rowVersion,
      quantityValue: '42.000000',
      unitCode: 'SERVICE',
    });
    const afterQuantity = await operations.getServiceOrderOverview(actor, started.id);
    expect(afterQuantity.economics.plannedCost).toBeNull();
    expect(afterQuantity.economics.currencyCode).toBeNull();
  });

  it('projects precise monetary estimates from the authorized ledger, not actual cost', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    await operationalCostAccess.recordCost(actor, released.id, {
      origin: OPERATIONAL_COST_ORIGINS.ServiceOrder,
      category: OPERATIONAL_COST_CATEGORIES.ThirdParty,
      costKind: OPERATIONAL_COST_KINDS.Estimated,
      amount: '500.0001',
      currencyCode: 'USD',
      rowVersion: released.rowVersion,
    });
    const overview = await operations.getServiceOrderOverview(actor, released.id);
    expect(overview.economics).toEqual({
      plannedRevenue: null,
      plannedCost: '500.0001',
      currencyCode: 'USD',
    });
  });

  it('does not leak cost amounts to an OS reader without operational-cost permission', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    await operationalCostAccess.recordCost(actor, released.id, {
      origin: OPERATIONAL_COST_ORIGINS.ServiceOrder,
      category: OPERATIONAL_COST_CATEGORIES.ThirdParty,
      costKind: OPERATIONAL_COST_KINDS.Estimated,
      amount: '150.0000',
      currencyCode: 'BRL',
      rowVersion: released.rowVersion,
    });
    const login = normalizeLoginIdentifier(`cost-reader-${crypto.randomUUID()}@cisne.invalid`);
    const { identityId } = await insertIdentity(pool, login, await hashPassword(AUTH_TEST_PASSWORD));
    await insertGrant(pool, {
      identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actor.identityId,
    });
    const reader = { identityId, sessionId: 'sid-cost-reader' };
    await expect(operationalCostAccess.listByServiceOrder(reader, released.id)).rejects.toBeDefined();
    const overview = await operations.getServiceOrderOverview(reader, released.id);
    expect(overview.economics).toEqual({ plannedRevenue: null, plannedCost: null, currencyCode: null });
  });

  it('records estimated cost at service order level with traceable origin', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    const recorded = await operationalCostAccess.recordCost(actor, released.id, {
      origin: OPERATIONAL_COST_ORIGINS.ServiceOrder,
      category: OPERATIONAL_COST_CATEGORIES.ThirdParty,
      costKind: OPERATIONAL_COST_KINDS.Estimated,
      description: 'Estimativa de subcontratado',
      amount: '500.0000',
      currencyCode: 'BRL',
      originContext: { vendorReference: 'FORN-001' },
      rowVersion: released.rowVersion,
    });

    expect(recorded.entry.origin).toBe(OPERATIONAL_COST_ORIGINS.ServiceOrder);
    expect(recorded.entry.category).toBe(OPERATIONAL_COST_CATEGORIES.ThirdParty);
    expect(recorded.entry.costKind).toBe(OPERATIONAL_COST_KINDS.Estimated);
    expect(recorded.entry.amount).toBe('500');
    expect(recorded.entry.originContext).toMatchObject({ vendorReference: 'FORN-001' });
  });

  it('records actual cost linked to execution entry and differentiates from estimate', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });

    await operationalCostAccess.recordCost(actor, started.id, {
      origin: OPERATIONAL_COST_ORIGINS.ServiceOrder,
      category: OPERATIONAL_COST_CATEGORIES.Fuel,
      costKind: OPERATIONAL_COST_KINDS.Estimated,
      amount: '200.0000',
      rowVersion: started.rowVersion,
    });
    const afterEstimate = await serviceOrdersAccess.getById(actor, started.id);

    const quantityEntry = await executionAccess.recordQuantity(actor, afterEstimate.id, {
      rowVersion: afterEstimate.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });
    const afterQuantity = await serviceOrdersAccess.getById(actor, started.id);
    const executionEntryId = quantityEntry.entry.id;

    await operationalCostAccess.recordCost(actor, afterQuantity.id, {
      origin: OPERATIONAL_COST_ORIGINS.Execution,
      sourceExecutionEntryId: executionEntryId,
      category: OPERATIONAL_COST_CATEGORIES.Fuel,
      costKind: OPERATIONAL_COST_KINDS.Actual,
      amount: '275.5000',
      quantityValue: '120.000000',
      quantityUnitCode: 'LITER',
      rowVersion: afterQuantity.rowVersion,
    });

    const bundle = await operationalCostAccess.listByServiceOrder(actor, started.id);
    expect(bundle.entries).toHaveLength(2);
    expect(bundle.summary.totalEstimatedCost).toBe('200');
    expect(bundle.summary.totalActualCost).toBe('275.5');
    expect(bundle.summary.disclaimer).toContain('not official accounting');
    expect(
      bundle.entries.find((entry) => entry.costKind === OPERATIONAL_COST_KINDS.Actual)?.sourceExecutionEntryId,
    ).toBe(executionEntryId);
  });

  it('rejects duplicate actual cost for the same execution entry and category', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    const quantityEntry = await executionAccess.recordQuantity(actor, started.id, {
      rowVersion: started.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });
    const afterQuantity = await serviceOrdersAccess.getById(actor, started.id);

    await operationalCostAccess.recordCost(actor, afterQuantity.id, {
      origin: OPERATIONAL_COST_ORIGINS.Execution,
      sourceExecutionEntryId: quantityEntry.entry.id,
      category: OPERATIONAL_COST_CATEGORIES.Travel,
      costKind: OPERATIONAL_COST_KINDS.Actual,
      amount: '80.0000',
      rowVersion: afterQuantity.rowVersion,
    });
    const latest = await serviceOrdersAccess.getById(actor, started.id);

    await expect(
      operationalCostAccess.recordCost(actor, latest.id, {
        origin: OPERATIONAL_COST_ORIGINS.Execution,
        sourceExecutionEntryId: quantityEntry.entry.id,
        category: OPERATIONAL_COST_CATEGORIES.Travel,
        costKind: OPERATIONAL_COST_KINDS.Actual,
        amount: '90.0000',
        rowVersion: latest.rowVersion,
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.OPERATIONAL_COST_DUPLICATE });
  });

  it('returns idempotent response for duplicate idempotency key', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const key = `cost-idem-${crypto.randomUUID()}`;

    const first = await operationalCostAccess.recordCost(actor, released.id, {
      origin: OPERATIONAL_COST_ORIGINS.ServiceOrder,
      category: OPERATIONAL_COST_CATEGORIES.Resource,
      costKind: OPERATIONAL_COST_KINDS.Estimated,
      amount: '150.0000',
      idempotencyKey: key,
      rowVersion: released.rowVersion,
    });
    const second = await operationalCostAccess.recordCost(actor, released.id, {
      origin: OPERATIONAL_COST_ORIGINS.ServiceOrder,
      category: OPERATIONAL_COST_CATEGORIES.Resource,
      costKind: OPERATIONAL_COST_KINDS.Estimated,
      amount: '150.0000',
      idempotencyKey: key,
      rowVersion: released.rowVersion,
    });

    expect(second.entry.id).toBe(first.entry.id);
  });

  it('rejects actual cost before execution starts', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    await expect(
      operationalCostAccess.recordCost(actor, released.id, {
        origin: OPERATIONAL_COST_ORIGINS.ServiceOrder,
        category: OPERATIONAL_COST_CATEGORIES.Labor,
        costKind: OPERATIONAL_COST_KINDS.Actual,
        amount: '100.0000',
        rowVersion: released.rowVersion,
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });
  });
});

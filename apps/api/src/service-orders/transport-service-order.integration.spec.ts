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
import { PhysicalAssetsAccessService } from '../resources/services/physical-assets-access.service';
import { PhysicalResourceTypesAccessService } from '../resources/services/physical-resource-types-access.service';
import { PLANNED_RESOURCE_KINDS } from './domain/resource-planning';
import { SERVICE_ORDER_ORIGINS, SERVICE_ORDER_STATUSES } from './domain/service-order';
import { TRANSPORT_SERVICE_ARCHETYPE } from './domain/transport-operations';
import { SERVICE_ORDERS_ERROR_CODES } from './errors/service-orders-error-codes';
import { ServiceOrdersModule } from './service-orders.module';
import { ServiceOrderExecutionAccessService } from './services/service-order-execution-access.service';
import { ServiceOrderPlanningAccessService } from './services/service-order-planning-access.service';
import { ServiceOrdersAccessService } from './services/service-orders-access.service';

const UNIT_A = 'unit-transport-a';
const TEST_CNPJ = '11222333000181';
const TEST_CNPJ_ALT = '19131243000197';
const TRIP_START = '2026-08-01T06:00:00.000Z';
const TRIP_END = '2026-08-01T14:00:00.000Z';
const ALLOC_START = '2026-08-01T06:00:00.000Z';
const ALLOC_END = '2026-08-01T10:00:00.000Z';
const TRANSPORT_ROUTE = {
  origin: 'Patio Central',
  destination: 'Silo Cliente',
};

async function grantTransportOps(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const grants: Array<{ action: string; resourceType: string }> = [
    { action: AUTHZ_ACTIONS.ClientCreate, resourceType: AUTHZ_RESOURCE_TYPES.Client },
    { action: AUTHZ_ACTIONS.ClientRead, resourceType: AUTHZ_RESOURCE_TYPES.Client },
    { action: AUTHZ_ACTIONS.CatalogServiceCreate, resourceType: AUTHZ_RESOURCE_TYPES.CatalogService },
    { action: AUTHZ_ACTIONS.CatalogServiceRead, resourceType: AUTHZ_RESOURCE_TYPES.CatalogService },
    { action: AUTHZ_ACTIONS.CatalogServicePublish, resourceType: AUTHZ_RESOURCE_TYPES.CatalogService },
    { action: AUTHZ_ACTIONS.ResourcesAssetCreate, resourceType: AUTHZ_RESOURCE_TYPES.ResourcesAsset },
    { action: AUTHZ_ACTIONS.ResourcesAssetRead, resourceType: AUTHZ_RESOURCE_TYPES.ResourcesAsset },
    { action: AUTHZ_ACTIONS.ResourcesAssetList, resourceType: AUTHZ_RESOURCE_TYPES.ResourcesAsset },
    { action: AUTHZ_ACTIONS.ResourcesResourceTypeRead, resourceType: AUTHZ_RESOURCE_TYPES.ResourcesResourceType },
    { action: AUTHZ_ACTIONS.ResourcesResourceTypeList, resourceType: AUTHZ_RESOURCE_TYPES.ResourcesResourceType },
    { action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderUpdate, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderCancel, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersPlannedResourceUpdate, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersResourceAllocate, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersResourceReallocate, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersExecutionStart, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersExecutionRead, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersExecutionRecord, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersExecutionComplete, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
  ];
  for (const grant of grants) {
    await insertGrant(pool, {
      identityId,
      action: grant.action,
      resourceType: grant.resourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Transport service orders (operational specialization)', () => {
  let pool: Pool;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let planningAccess: ServiceOrderPlanningAccessService;
  let executionAccess: ServiceOrderExecutionAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  let assetsAccess: PhysicalAssetsAccessService;
  let resourceTypesAccess: PhysicalResourceTypesAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for transport integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
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
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    assetsAccess = module.get(PhysicalAssetsAccessService);
    resourceTypesAccess = module.get(PhysicalResourceTypesAccessService);
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
    const login = normalizeLoginIdentifier(`transport-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantTransportOps(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedReleasedTransportOrder(
    actor: { identityId: string; sessionId: string },
    taxId: string = TEST_CNPJ,
    location: Record<string, unknown> = TRANSPORT_ROUTE,
  ) {
    const client = await clientAccess.create(actor, {
      legalName: `Cliente Transporte ${crypto.randomUUID()}`,
      tradeName: 'Cliente Transporte',
      taxId,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, { code: `CAT-${suffix}`, name: 'Transporte' });
    const draft = await catalogAccess.create(actor, {
      code: `TRP-${suffix}`,
      name: 'Transporte de insumos trecho urbano',
      categoryId: category.categoryId,
      archetype: TRANSPORT_SERVICE_ARCHETYPE,
      measurementMode: 'BY_EVENT',
      measurementBasis: 'TRIP',
      allowedUnits: [{ unitCode: 'TRIP', isDefault: true, sortOrder: 0 }],
      pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '1200.0000', internalCost: '800.0000' }],
      resourceRequirements: [{ resourceTypeCode: 'TRUCK', requirementLevel: 'REQUIRED', minQuantity: 1, sortOrder: 0 }],
      laborRequirements: [],
      executionRequirements: [
        { requirementType: 'OBSERVATION', requirementLevel: 'REQUIRED' },
        { requirementType: 'QUANTITY', requirementLevel: 'REQUIRED' },
      ],
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    const published = await catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);
    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
      description: 'Transporte de fertilizantes',
      location,
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, { rowVersion: created.rowVersion });
    const released = await serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion });
    return { client, released };
  }

  async function createTruck(actor: { identityId: string; sessionId: string }, code: string) {
    const listed = await resourceTypesAccess.list(actor, { limit: 50, offset: 0 });
    const truck = listed.items.find((item) => item.code === 'TRUCK');
    if (!truck) throw new Error('TRUCK not found');
    const plateSuffix = code.replace(/[^A-Z0-9]/gi, '').slice(-4).padStart(4, '0');
    return assetsAccess.create(actor, {
      assetCode: code,
      resourceTypeId: truck.id,
      name: 'Caminhao transporte',
      unitId: UNIT_A,
      vehicle: {
        plate: `TRK-${plateSuffix}`,
        normalizedPlate: `TRK${plateSuffix}`,
        plateDisplay: `TRK-${plateSuffix}`,
      },
    });
  }

  it('requires scheduled window when planning transport physical resource', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedTransportOrder(actor);
    await expect(
      planningAccess.planResource(actor, released.id, {
        requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
        resourceTypeCode: 'TRUCK',
        plannedQuantity: '1',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.VALIDATION_FAILED });
  });

  it('requires origin and destination in location when planning transport', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedTransportOrder(actor, TEST_CNPJ, { city: 'Porto Velho' });
    await expect(
      planningAccess.planResource(actor, released.id, {
        requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
        resourceTypeCode: 'TRUCK',
        plannedQuantity: '1',
        operationalStart: TRIP_START,
        operationalEnd: TRIP_END,
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.VALIDATION_FAILED });
  });

  it('mobilizes truck within scheduled window and lists transport service orders', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedTransportOrder(actor);
    const truck = await createTruck(actor, `TRK-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'TRUCK',
      plannedQuantity: '1',
      operationalStart: TRIP_START,
      operationalEnd: TRIP_END,
    });
    const allocated = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: truck.id,
      operationalStart: ALLOC_START,
      operationalEnd: ALLOC_END,
    });
    expect(allocated.physicalAssetId).toBe(truck.id);
    const listed = await serviceOrdersAccess.list(actor, { limit: 20, offset: 0, archetype: TRANSPORT_SERVICE_ARCHETYPE });
    expect(listed.items.some((item) => item.id === released.id)).toBe(true);
  });

  it('denies overlapping truck allocation across transport orders', async () => {
    const { actor } = await seedActor();
    const { released: orderA } = await seedReleasedTransportOrder(actor);
    const { released: orderB } = await seedReleasedTransportOrder(actor, TEST_CNPJ_ALT);
    const truck = await createTruck(actor, `TRK-${crypto.randomUUID().slice(0, 6)}`);
    const planA = await planningAccess.planResource(actor, orderA.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'TRUCK',
      plannedQuantity: '1',
      operationalStart: TRIP_START,
      operationalEnd: TRIP_END,
    });
    const planB = await planningAccess.planResource(actor, orderB.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'TRUCK',
      plannedQuantity: '1',
      operationalStart: TRIP_START,
      operationalEnd: TRIP_END,
    });
    await planningAccess.allocateResource(actor, orderA.id, {
      plannedResourceId: planA.id,
      physicalAssetId: truck.id,
      operationalStart: ALLOC_START,
      operationalEnd: ALLOC_END,
    });
    await expect(
      planningAccess.allocateResource(actor, orderB.id, {
        plannedResourceId: planB.id,
        physicalAssetId: truck.id,
        operationalStart: ALLOC_START,
        operationalEnd: ALLOC_END,
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.ALLOCATION_CONFLICT });
  });

  it('preserves execution entries when replanning transport schedule during IN_EXECUTION', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedTransportOrder(actor);
    const truck = await createTruck(actor, `TRK-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'TRUCK',
      plannedQuantity: '1',
      operationalStart: TRIP_START,
      operationalEnd: TRIP_END,
    });
    await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: truck.id,
      operationalStart: ALLOC_START,
      operationalEnd: ALLOC_END,
    });
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Primeira viagem concluida com ticket de pesagem.',
    });
    const afterRecord = await serviceOrdersAccess.getById(actor, started.id);
    const entriesBefore = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM so.execution_entries WHERE service_order_id = $1`,
      [started.id],
    );

    await planningAccess.updatePlannedResource(actor, started.id, planned.id, {
      rowVersion: planned.rowVersion,
      operationalEnd: '2026-08-01T18:00:00.000Z',
      notes: 'Janela estendida para segunda viagem',
    });

    const entriesAfter = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM so.execution_entries WHERE service_order_id = $1`,
      [started.id],
    );
    expect(entriesAfter.rows[0]?.count).toBe(entriesBefore.rows[0]?.count);

    const execution = await executionAccess.getExecution(actor, afterRecord.id);
    expect(execution.entries).toHaveLength(1);
    expect(execution.entries[0]?.entryType).toBe('OBSERVATION');
  });

  it('blocks planning after transport order cancellation', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedTransportOrder(actor);
    const cancelled = await serviceOrdersAccess.cancel(actor, released.id, {
      rowVersion: released.rowVersion,
      cancellationReason: 'Viagem cancelada pelo cliente',
    });
    expect(cancelled.status).toBe(SERVICE_ORDER_STATUSES.Cancelled);
    await expect(
      planningAccess.planResource(actor, cancelled.id, {
        requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
        resourceTypeCode: 'TRUCK',
        plannedQuantity: '1',
        operationalStart: TRIP_START,
        operationalEnd: TRIP_END,
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });
  });

  it('records trip quantity during transport execution', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedTransportOrder(actor);
    const truck = await createTruck(actor, `TRK-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'TRUCK',
      plannedQuantity: '1',
      operationalStart: TRIP_START,
      operationalEnd: TRIP_END,
    });
    await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: truck.id,
      operationalStart: ALLOC_START,
      operationalEnd: ALLOC_END,
    });
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Duas viagens concluidas com ticket de pesagem.',
    });
    const afterObservation = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, afterObservation.id, {
      rowVersion: afterObservation.rowVersion,
      quantityValue: '2',
      unitCode: 'TRIP',
    });
    const execution = await executionAccess.getExecution(actor, afterObservation.id);
    const quantityEntry = execution.entries.find((entry) => entry.entryType === 'QUANTITY');
    expect(quantityEntry?.quantityValue).toBe('2');
    expect(quantityEntry?.quantityUnitCode).toBe('TRIP');
  });
});
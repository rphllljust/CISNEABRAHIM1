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
import { MeasurementsModule } from '../measurements/measurements.module';
import { MEASUREMENT_STATUSES } from '../measurements/domain/measurement';
import { MeasurementsAccessService } from '../measurements/services/measurements-access.service';
import { ResourcesModule } from '../resources/resources.module';
import { PhysicalAssetsAccessService } from '../resources/services/physical-assets-access.service';
import { PhysicalResourceTypesAccessService } from '../resources/services/physical-resource-types-access.service';
import { PLANNED_RESOURCE_KINDS } from './domain/resource-planning';
import { RENTAL_SERVICE_ARCHETYPE } from './domain/rental-operations';
import { SERVICE_ORDER_ORIGINS } from './domain/service-order';
import { SERVICE_ORDERS_ERROR_CODES } from './errors/service-orders-error-codes';
import { ServiceOrdersModule } from './service-orders.module';
import { ServiceOrderExecutionAccessService } from './services/service-order-execution-access.service';
import { ServiceOrderPlanningAccessService } from './services/service-order-planning-access.service';
import { ServiceOrdersAccessService } from './services/service-orders-access.service';

const UNIT_A = 'unit-rental-a';
const TEST_CNPJ = '11222333000181';
const TEST_CNPJ_ALT = '19131243000197';
const CONTRACT_START = '2026-07-01T08:00:00.000Z';
const CONTRACT_END = '2026-07-04T18:00:00.000Z';
const ALLOC_START = '2026-07-01T08:00:00.000Z';
const ALLOC_END = '2026-07-04T18:00:00.000Z';

async function grantRentalOps(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
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
    { action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersPlannedResourceUpdate, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersResourceAllocate, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersResourceReallocate, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersResourceRemoveAllocation, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersExecutionStart, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersExecutionRecord, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.ServiceOrdersExecutionComplete, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.MeasurementsMeasurementCreate, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.MeasurementsMeasurementSubmit, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.MeasurementsMeasurementReview, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
    { action: AUTHZ_ACTIONS.MeasurementsMeasurementApprove, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
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

describe('Rental service orders (operational specialization)', () => {
  let pool: Pool;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let planningAccess: ServiceOrderPlanningAccessService;
  let executionAccess: ServiceOrderExecutionAccessService;
  let measurementsAccess: MeasurementsAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  let assetsAccess: PhysicalAssetsAccessService;
  let resourceTypesAccess: PhysicalResourceTypesAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for rental integration tests.');
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
        MeasurementsModule,
      ],
    }).compile();
    serviceOrdersAccess = module.get(ServiceOrdersAccessService);
    planningAccess = module.get(ServiceOrderPlanningAccessService);
    executionAccess = module.get(ServiceOrderExecutionAccessService);
    measurementsAccess = module.get(MeasurementsAccessService);
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
    const login = normalizeLoginIdentifier(`rental-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantRentalOps(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedReleasedRentalOrder(
    actor: { identityId: string; sessionId: string },
    taxId: string = TEST_CNPJ,
  ) {
    const client = await clientAccess.create(actor, {
      legalName: `Cliente Locacao ${crypto.randomUUID()}`,
      tradeName: 'Cliente Locacao',
      taxId,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, { code: `CAT-${suffix}`, name: 'Locacao' });
    const draft = await catalogAccess.create(actor, {
      code: `RENT-${suffix}`,
      name: 'Locacao diaria de escavadeira',
      categoryId: category.categoryId,
      archetype: RENTAL_SERVICE_ARCHETYPE,
      measurementMode: 'BY_PERIOD',
      measurementBasis: 'TIME',
      allowedUnits: [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }],
      pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '2500.0000', internalCost: '1800.0000' }],
      resourceRequirements: [{ resourceTypeCode: 'EXCAVATOR', requirementLevel: 'REQUIRED', minQuantity: 1, sortOrder: 0 }],
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
      description: 'Locacao de escavadeira',
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, { rowVersion: created.rowVersion });
    const released = await serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion });
    return { client, released };
  }

  async function createExcavator(actor: { identityId: string; sessionId: string }, code: string) {
    const listed = await resourceTypesAccess.list(actor, { limit: 50, offset: 0 });
    const excavator = listed.items.find((item) => item.code === 'EXCAVATOR');
    if (!excavator) throw new Error('EXCAVATOR not found');
    return assetsAccess.create(actor, {
      assetCode: code,
      resourceTypeId: excavator.id,
      name: 'Escavadeira locacao',
      unitId: UNIT_A,
    });
  }

  it('requires contracted period when planning rental physical resource', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedRentalOrder(actor);
    await expect(
      planningAccess.planResource(actor, released.id, {
        requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
        resourceTypeCode: 'EXCAVATOR',
        plannedQuantity: '1',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.VALIDATION_FAILED });
  });

  it('mobilizes rental asset within contracted period and lists rental service orders', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedRentalOrder(actor);
    const excavator = await createExcavator(actor, `EXC-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'EXCAVATOR',
      plannedQuantity: '1',
      operationalStart: CONTRACT_START,
      operationalEnd: CONTRACT_END,
    });
    const allocated = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: excavator.id,
      operationalStart: ALLOC_START,
      operationalEnd: ALLOC_END,
    });
    expect(allocated.physicalAssetId).toBe(excavator.id);
    const listed = await serviceOrdersAccess.list(actor, { limit: 20, offset: 0, archetype: RENTAL_SERVICE_ARCHETYPE });
    expect(listed.items.some((item) => item.id === released.id)).toBe(true);
  });

  it('denies overlapping rental allocation on the same excavator', async () => {
    const { actor } = await seedActor();
    const { released: orderA } = await seedReleasedRentalOrder(actor);
    const { released: orderB } = await seedReleasedRentalOrder(actor, TEST_CNPJ_ALT);
    const excavator = await createExcavator(actor, `EXC-${crypto.randomUUID().slice(0, 6)}`);
    const planA = await planningAccess.planResource(actor, orderA.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'EXCAVATOR',
      plannedQuantity: '1',
      operationalStart: CONTRACT_START,
      operationalEnd: CONTRACT_END,
    });
    const planB = await planningAccess.planResource(actor, orderB.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'EXCAVATOR',
      plannedQuantity: '1',
      operationalStart: CONTRACT_START,
      operationalEnd: CONTRACT_END,
    });
    await planningAccess.allocateResource(actor, orderA.id, {
      plannedResourceId: planA.id,
      physicalAssetId: excavator.id,
      operationalStart: ALLOC_START,
      operationalEnd: ALLOC_END,
    });
    await expect(
      planningAccess.allocateResource(actor, orderB.id, {
        plannedResourceId: planB.id,
        physicalAssetId: excavator.id,
        operationalStart: ALLOC_START,
        operationalEnd: ALLOC_END,
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.ALLOCATION_CONFLICT });
  });

  it('extends rental contracted period and allocation on the same asset', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedRentalOrder(actor);
    const excavator = await createExcavator(actor, `EXC-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'EXCAVATOR',
      plannedQuantity: '1',
      operationalStart: CONTRACT_START,
      operationalEnd: CONTRACT_END,
    });
    const allocated = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: excavator.id,
      operationalStart: ALLOC_START,
      operationalEnd: '2026-07-03T18:00:00.000Z',
    });
    const extendedEnd = '2026-07-06T18:00:00.000Z';
    await planningAccess.updatePlannedResource(actor, released.id, planned.id, {
      rowVersion: planned.rowVersion,
      operationalEnd: extendedEnd,
    });
    const extended = await planningAccess.reallocateResource(actor, released.id, allocated.id, {
      rowVersion: allocated.rowVersion,
      physicalAssetId: excavator.id,
      operationalStart: ALLOC_START,
      operationalEnd: extendedEnd,
    });
    expect(new Date(extended.operationalEnd).toISOString()).toBe(extendedEnd);
    expect(extended.status).toBe('ACTIVE');
    const active = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM res.resource_allocations WHERE physical_asset_id = $1 AND status = 'ACTIVE'`,
      [excavator.id],
    );
    expect(active.rows[0]?.count).toBe('1');
  });

  it('returns rental asset, completes execution and records period measurement', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedRentalOrder(actor);
    const excavator = await createExcavator(actor, `EXC-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'EXCAVATOR',
      plannedQuantity: '1',
      operationalStart: CONTRACT_START,
      operationalEnd: CONTRACT_END,
    });
    const allocated = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: excavator.id,
      operationalStart: ALLOC_START,
      operationalEnd: ALLOC_END,
    });
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Equipamento mobilizado no cliente.',
    });
    const afterObservation = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, afterObservation.id, {
      rowVersion: afterObservation.rowVersion,
      quantityValue: '3',
      unitCode: 'DAY',
    });
    const returned = await planningAccess.removeAllocation(actor, released.id, allocated.id, {
      rowVersion: allocated.rowVersion,
    });
    expect(returned.status).toBe('REMOVED');
    const afterReturn = await serviceOrdersAccess.getById(actor, released.id);
    const completed = await executionAccess.complete(actor, afterReturn.id, {
      rowVersion: afterReturn.rowVersion,
    });
    const measurement = await measurementsAccess.create(actor, completed.id);
    const submitted = await measurementsAccess.submit(actor, completed.id, measurement.id, {
      rowVersion: measurement.rowVersion,
    });
    const reviewed = await measurementsAccess.startReview(actor, completed.id, measurement.id, {
      rowVersion: submitted.rowVersion,
    });
    const reviewerLogin = normalizeLoginIdentifier(`rental-reviewer-${crypto.randomUUID()}@cisne.invalid`);
    const reviewerPasswordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: reviewerId } = await insertIdentity(pool, reviewerLogin, reviewerPasswordHash);
    await grantRentalOps(pool, reviewerId, actor.identityId);
    const reviewer = { identityId: reviewerId, sessionId: 'sid-reviewer' };
    const approved = await measurementsAccess.approve(reviewer, completed.id, measurement.id, {
      rowVersion: reviewed.rowVersion,
    });
    expect(approved.status).toBe(MEASUREMENT_STATUSES.Approved);
  });
});
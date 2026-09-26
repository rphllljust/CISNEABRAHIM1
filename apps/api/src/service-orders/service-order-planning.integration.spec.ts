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
import { SECURITY_AUDIT_ACTIONS } from '../audit/types/security-audit.types';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/services/auth.service';
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
import {
  SERVICE_ORDER_HISTORY_EVENTS,
  SERVICE_ORDER_ORIGINS,
  SERVICE_ORDER_STATUSES,
} from './domain/service-order';
import { PLANNED_RESOURCE_KINDS } from './domain/resource-planning';
import { SERVICE_ORDER_LIST_FILTERS } from './domain/service-order-list.query';
import { SERVICE_ORDERS_ERROR_CODES } from './errors/service-orders-error-codes';
import { ServiceOrdersModule } from './service-orders.module';
import { ServiceOrderExecutionAccessService } from './services/service-order-execution-access.service';
import { ServiceOrdersAccessService } from './services/service-orders-access.service';
import { ServiceOrderPlanningAccessService } from './services/service-order-planning-access.service';

const UNIT_A = 'unit-plan-a';
const TEST_CNPJ = '11222333000181';
const TEST_CNPJ_ALT = '11222333000182';

const SAMPLE_RESOURCE_REQUIREMENTS = [
  {
    resourceTypeCode: 'WATER_TRUCK',
    requirementLevel: 'REQUIRED' as const,
    minQuantity: 2,
    sortOrder: 0,
  },
];

const SAMPLE_LABOR_REQUIREMENTS = [
  {
    laborTypeCode: 'DRIVER',
    requirementLevel: 'REQUIRED' as const,
    minQuantity: 2,
    sortOrder: 0,
  },
];

async function grantPlanningAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCancel,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourceRead,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourceUpdate,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourceRemove,
    AUTHZ_ACTIONS.ServiceOrdersResourceAllocate,
    AUTHZ_ACTIONS.ServiceOrdersResourceReallocate,
    AUTHZ_ACTIONS.ServiceOrdersResourceRemoveAllocation,
    AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead,
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServicePublish,
    AUTHZ_ACTIONS.ResourcesAssetCreate,
    AUTHZ_ACTIONS.ResourcesAssetRead,
    AUTHZ_ACTIONS.ResourcesAssetList,
    AUTHZ_ACTIONS.ResourcesAssetDeactivate,
    AUTHZ_ACTIONS.ResourcesResourceTypeRead,
    AUTHZ_ACTIONS.ResourcesResourceTypeList,
    AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
    AUTHZ_ACTIONS.ServiceOrdersExecutionStart,
    AUTHZ_ACTIONS.ServiceOrdersExecutionPause,
    AUTHZ_ACTIONS.ServiceOrdersExecutionRecord,
    AUTHZ_ACTIONS.ServiceOrdersExecutionComplete,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderReopen,
  ];

  for (const action of actions) {
    const resourceType = action.startsWith('service-orders:')
      ? AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder
      : action.startsWith('client:')
        ? AUTHZ_RESOURCE_TYPES.Client
        : action.startsWith('catalog:')
          ? AUTHZ_RESOURCE_TYPES.CatalogService
          : action.startsWith('resources:resource-type')
        ? AUTHZ_RESOURCE_TYPES.ResourcesResourceType
        : action.startsWith('resources:asset')
            ? AUTHZ_RESOURCE_TYPES.ResourcesAsset
            : AUTHZ_RESOURCE_TYPES.ResourcesResourceType;

    await insertGrant(pool, {
      identityId,
      action,
      resourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Service order planning and allocation PostgreSQL integration', () => {
  let pool: Pool;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let planningAccess: ServiceOrderPlanningAccessService;
  let executionAccess: ServiceOrderExecutionAccessService;
  let authService: AuthService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  let assetsAccess: PhysicalAssetsAccessService;
  let resourceTypesAccess: PhysicalResourceTypesAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for planning integration tests.');
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
    authService = module.get(AuthService);
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
    const login = normalizeLoginIdentifier(`plan-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantPlanningAdmin(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedReleasedOrder(
    actor: { identityId: string; sessionId: string },
    taxId: string = TEST_CNPJ,
  ) {
    const client = await clientAccess.create(actor, {
      legalName: `Cliente Plan ${crypto.randomUUID()}`,
      tradeName: 'Cliente Plan',
      taxId,
      contacts: [
        {
          name: 'Contato',
          purpose: CONTACT_PURPOSES.Operational,
          phone: '69999990000',
        },
      ],
    });

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, {
      code: `CAT-${suffix}`,
      name: 'Serviços',
    });
    const draft = await catalogAccess.create(actor, {
      code: `PLAN-SRV-${suffix}`,
      name: 'Serviço com recursos',
      categoryId: category.categoryId,
      archetype: 'CIVIL_WORK',
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [
        { modelCode: 'GLOBAL_PRICE', salePrice: '1000.0000', internalCost: '800.0000' },
      ],
      resourceRequirements: SAMPLE_RESOURCE_REQUIREMENTS,
      laborRequirements: SAMPLE_LABOR_REQUIREMENTS,
      executionRequirements: [
        { requirementType: 'OBSERVATION' as const, requirementLevel: 'REQUIRED' as const },
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
      description: 'OS para planejamento',
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    const released = await serviceOrdersAccess.release(actor, prepared.id, {
      rowVersion: prepared.rowVersion,
    });

    return { client, published, released };
  }

  async function seedReleasedOrderWithPlanning(actor: { identityId: string; sessionId: string }) {
    const { released } = await seedReleasedOrder(actor, TEST_CNPJ_ALT);
    await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '2',
    });
    await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '2',
    });
    const refreshed = await serviceOrdersAccess.getById(actor, released.id);
    return { released: refreshed };
  }

  async function waterTruckTypeId(actor: { identityId: string; sessionId: string }) {
    const listed = await resourceTypesAccess.list(actor, { limit: 50, offset: 0 });
    const type = listed.items.find((item) => item.code === 'WATER_TRUCK');
    if (!type) {
      throw new Error('WATER_TRUCK type not found');
    }
    return type.id;
  }

  async function createWaterTruck(
    actor: { identityId: string; sessionId: string },
    code: string,
  ) {
    const resourceTypeId = await waterTruckTypeId(actor);
    return assetsAccess.create(actor, {
      assetCode: code,
      resourceTypeId,
      name: `Pipa ${code}`,
      unitId: UNIT_A,
      vehicle: {
        plate: `ABC-${code.slice(-4)}`,
        normalizedPlate: `ABC${code.slice(-4)}`,
        plateDisplay: `ABC-${code.slice(-4)}`,
      },
    });
  }

  async function createEmployee(memberCode: string, laborTypeCode = 'DRIVER') {
    const login = normalizeLoginIdentifier(`${memberCode.toLowerCase()}-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    const member = await pool.query<{ id: string }>(
      `INSERT INTO wrk.workforce_members (
         member_code, legal_name, preferred_name, default_labor_type_code, identity_id
       )
       VALUES ($1, $2, $2, $3, $4)
       RETURNING id`,
      [memberCode, `Empregado ${memberCode}`, laborTypeCode, identityId],
    );
    return {
      identityId,
      login,
      actor: { identityId, sessionId: `sid-${memberCode}` },
      workforceMemberId: member.rows[0]!.id,
    };
  }

  async function grantEmployeeAssignedAccess(identityId: string, grantedBy: string): Promise<void> {
    for (const action of [
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
      AUTHZ_ACTIONS.ServiceOrdersExecutionStart,
      AUTHZ_ACTIONS.ServiceOrdersExecutionRecord,
      AUTHZ_ACTIONS.ServiceOrdersExecutionComplete,
    ]) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        scopeType: AUTHZ_SCOPES.Assigned,
        grantedByIdentityId: grantedBy,
      });
    }
  }

  it('plans physical resources and labor types without concrete assets', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    const physical = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '2',
    });
    const labor = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '2',
    });

    expect(physical.resourceTypeCode).toBe('WATER_TRUCK');
    expect(labor.laborTypeCode).toBe('DRIVER');

    const listed = await planningAccess.listPlannedResources(actor, released.id);
    expect(listed).toHaveLength(2);
  });

  it('allocates asset to planned resource and records history and audit', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });

    const allocated = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    expect(allocated.physicalAssetId).toBe(asset.id);
    expect(allocated.historyEvents.some((event) => event.eventType === 'ALLOCATE_RESOURCE')).toBe(
      true,
    );

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [released.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.ServiceOrdersResourceAllocate,
    );
  });

  it('denies allocation for inactive asset', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    await assetsAccess.deactivate(actor, asset.id, asset.version);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });

    await expect(
      planningAccess.allocateResource(actor, released.id, {
        plannedResourceId: planned.id,
        physicalAssetId: asset.id,
        operationalStart: '2026-06-01T08:00:00.000Z',
        operationalEnd: '2026-06-01T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.ASSET_INACTIVE });
  });

  it('denies incompatible resource type allocation', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const listed = await resourceTypesAccess.list(actor, { limit: 50, offset: 0 });
    const truckType = listed.items.find((item) => item.code === 'TRUCK');
    const truck = await assetsAccess.create(actor, {
      assetCode: `TR-${crypto.randomUUID().slice(0, 6)}`,
      resourceTypeId: truckType!.id,
      name: 'Caminhão comum',
      unitId: UNIT_A,
      vehicle: { plate: 'TRK-1234', normalizedPlate: 'TRK1234', plateDisplay: 'TRK-1234' },
    });
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });

    await expect(
      planningAccess.allocateResource(actor, released.id, {
        plannedResourceId: planned.id,
        physicalAssetId: truck.id,
        operationalStart: '2026-06-01T08:00:00.000Z',
        operationalEnd: '2026-06-01T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.RESOURCE_TYPE_MISMATCH });
  });

  it('allows same asset on non-overlapping intervals', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const plannedA = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    const plannedB = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });

    await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: plannedA.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });
    const second = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: plannedB.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T10:00:00.000Z',
      operationalEnd: '2026-06-01T12:00:00.000Z',
    });
    expect(second.physicalAssetId).toBe(asset.id);
  });

  it('denies allocation outside planned operational window', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T12:00:00.000Z',
    });

    await expect(
      planningAccess.allocateResource(actor, released.id, {
        plannedResourceId: planned.id,
        physicalAssetId: asset.id,
        operationalStart: '2026-06-01T12:00:00.000Z',
        operationalEnd: '2026-06-01T14:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.ALLOCATION_OUTSIDE_WINDOW });
  });

  it('prevents concurrent overlapping allocation on the same asset', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const plannedA = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    const plannedB = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });

    const payload = {
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    };

    const results = await Promise.allSettled([
      planningAccess.allocateResource(actor, released.id, {
        plannedResourceId: plannedA.id,
        ...payload,
      }),
      planningAccess.allocateResource(actor, released.id, {
        plannedResourceId: plannedB.id,
        ...payload,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const active = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM res.resource_allocations
       WHERE physical_asset_id = $1 AND status = 'ACTIVE'`,
      [asset.id],
    );
    expect(active.rows[0]?.count).toBe('1');
  });

  it('denies unauthorized planning (IDOR)', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const otherLogin = normalizeLoginIdentifier(`plan-deny-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: otherId } = await insertIdentity(pool, otherLogin, passwordHash);

    await expect(
      planningAccess.planResource(
        { identityId: otherId, sessionId: 'sid' },
        released.id,
        {
          requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
          resourceTypeCode: 'WATER_TRUCK',
          plannedQuantity: '1',
        },
      ),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.DENIED });
  });

  it('returns VERSION_CONFLICT on stale planned resource update', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    await planningAccess.updatePlannedResource(actor, released.id, planned.id, {
      rowVersion: planned.rowVersion,
      plannedQuantity: '2',
    });
    await expect(
      planningAccess.updatePlannedResource(actor, released.id, planned.id, {
        rowVersion: planned.rowVersion,
        plannedQuantity: '3',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.VERSION_CONFLICT });
  });

  it('removes allocation without deleting history', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    const allocated = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    const removed = await planningAccess.removeAllocation(actor, released.id, allocated.id, {
      rowVersion: allocated.rowVersion,
    });
    expect(removed.status).toBe('REMOVED');

    const history = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM res.resource_allocation_history_events
       WHERE resource_allocation_id = $1`,
      [allocated.id],
    );
    expect(Number(history.rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(2);
  });

  it('replans quantity and window while active allocations remain valid', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T14:00:00.000Z',
    });
    const allocated = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    const replanned = await planningAccess.updatePlannedResource(actor, released.id, planned.id, {
      rowVersion: planned.rowVersion,
      plannedQuantity: '2',
      operationalEnd: '2026-06-01T16:00:00.000Z',
    });

    expect(replanned.plannedQuantity).toBe('2.0000');
    const stillAllocated = await planningAccess.listAllocations(actor, released.id);
    expect(stillAllocated.some((item) => item.id === allocated.id && item.status === 'ACTIVE')).toBe(
      true,
    );
  });

  it('rejects shrinking planned window when active allocations would fall outside', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T14:00:00.000Z',
    });
    await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    await expect(
      planningAccess.updatePlannedResource(actor, released.id, planned.id, {
        rowVersion: planned.rowVersion,
        operationalEnd: '2026-06-01T09:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.ALLOCATION_OUTSIDE_WINDOW });
  });

  it('reallocates asset within planned window and preserves prior allocation history', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const assetA = await createWaterTruck(actor, `WT-A-${crypto.randomUUID().slice(0, 4)}`);
    const assetB = await createWaterTruck(actor, `WT-B-${crypto.randomUUID().slice(0, 4)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T14:00:00.000Z',
    });
    const allocated = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: assetA.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    const reallocated = await planningAccess.reallocateResource(actor, released.id, allocated.id, {
      rowVersion: allocated.rowVersion,
      physicalAssetId: assetB.id,
      operationalStart: '2026-06-01T10:00:00.000Z',
      operationalEnd: '2026-06-01T12:00:00.000Z',
    });

    expect(reallocated.physicalAssetId).toBe(assetB.id);
    expect(reallocated.historyEvents.some((event) => event.eventType === 'REALLOCATE_RESOURCE')).toBe(
      true,
    );

    const priorHistory = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM res.resource_allocation_history_events
       WHERE resource_allocation_id = $1`,
      [allocated.id],
    );
    expect(Number(priorHistory.rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(1);

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [released.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.ServiceOrdersResourceReallocate,
    );
  });

  it('rejects reallocation outside planned operational window', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const assetA = await createWaterTruck(actor, `WT-A-${crypto.randomUUID().slice(0, 4)}`);
    const assetB = await createWaterTruck(actor, `WT-B-${crypto.randomUUID().slice(0, 4)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T12:00:00.000Z',
    });
    const allocated = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: assetA.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    await expect(
      planningAccess.reallocateResource(actor, released.id, allocated.id, {
        rowVersion: allocated.rowVersion,
        physicalAssetId: assetB.id,
        operationalStart: '2026-06-01T11:00:00.000Z',
        operationalEnd: '2026-06-01T13:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.ALLOCATION_OUTSIDE_WINDOW });
  });

  it('rejects planning mutations in incompatible service order states', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      description: 'Rascunho sem planejamento',
    });

    await expect(
      planningAccess.planResource(actor, created.id, {
        requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
        resourceTypeCode: 'WATER_TRUCK',
        plannedQuantity: '1',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    const { released: plannedReleased } = await seedReleasedOrderWithPlanning(actor);
    const started = await executionAccess.start(actor, plannedReleased.id, {
      rowVersion: plannedReleased.rowVersion,
    });
    const paused = await executionAccess.pause(actor, started.id, { rowVersion: started.rowVersion });
    expect(paused.status).toBe(SERVICE_ORDER_STATUSES.Paused);

    await expect(
      planningAccess.planResource(actor, paused.id, {
        requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
        resourceTypeCode: 'WATER_TRUCK',
        plannedQuantity: '1',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    const cancelled = await serviceOrdersAccess.cancel(actor, released.id, {
      rowVersion: released.rowVersion,
      cancellationReason: 'Cancelada para teste',
    });
    expect(cancelled.status).toBe(SERVICE_ORDER_STATUSES.Cancelled);
    await expect(
      planningAccess.planResource(actor, cancelled.id, {
        requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
        resourceTypeCode: 'WATER_TRUCK',
        plannedQuantity: '1',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });
  });

  it('allows replanning during IN_EXECUTION without overwriting execution facts', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrderWithPlanning(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });

    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Execução iniciada com planejamento vigente.',
    });
    const afterRecord = await serviceOrdersAccess.getById(actor, started.id);
    const entriesBefore = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM so.execution_entries WHERE service_order_id = $1`,
      [started.id],
    );

    const labor = (await planningAccess.listPlannedResources(actor, started.id)).find(
      (item) => item.laborTypeCode === 'DRIVER',
    );
    expect(labor).toBeDefined();
    await planningAccess.updatePlannedResource(actor, started.id, labor!.id, {
      rowVersion: labor!.rowVersion,
      plannedQuantity: '3',
      notes: 'Reforço operacional',
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

  it('clears the materialized completion fact when a completed order is reopened', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrderWithPlanning(actor);
    const started = await executionAccess.start(actor, released.id, {
      rowVersion: released.rowVersion,
    });
    const recorded = await executionAccess.recordObservation(actor, released.id, {
      rowVersion: started.rowVersion,
      text: 'Servico conferido no local antes da conclusao.',
    });
    await executionAccess.complete(actor, released.id, {
      rowVersion: recorded.rowVersion as number,
    });

    const completed = await serviceOrdersAccess.getById(actor, released.id);
    expect(completed.status).toBe(SERVICE_ORDER_STATUSES.Completed);
    expect(completed.completedAt).not.toBeNull();

    const reopened = await serviceOrdersAccess.reopen(actor, released.id, {
      rowVersion: completed.rowVersion,
      reopenReason: 'Retrabalho solicitado pelo cliente.',
    });

    expect(reopened.status).toBe(SERVICE_ORDER_STATUSES.InExecution);
    // A OS voltou a executar: nao pode continuar carregando o fato de conclusao,
    // sob pena de dashboard/produtividade contarem conclusao inexistente.
    expect(reopened.completedAt).toBeNull();
    expect(reopened.historyEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['COMPLETED', 'REOPENED']),
    );
  });

  it('releases active allocations when the service order is cancelled', async () => {
    const { actor } = await seedActor();
    const { released: cancelledOrder } = await seedReleasedOrder(actor, TEST_CNPJ);
    const { released: otherOrder } = await seedReleasedOrder(actor, TEST_CNPJ_ALT);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);

    const now = Date.now();
    const window = {
      operationalStart: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      operationalEnd: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    };

    const plannedCancelled = await planningAccess.planResource(actor, cancelledOrder.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    const allocation = await planningAccess.allocateResource(actor, cancelledOrder.id, {
      plannedResourceId: plannedCancelled.id,
      physicalAssetId: asset.id,
      ...window,
    });

    const cancelled = await serviceOrdersAccess.cancel(actor, cancelledOrder.id, {
      rowVersion: cancelledOrder.rowVersion,
      cancellationReason: 'Demanda cancelada pelo cliente antes da execução',
    });
    expect(cancelled.status).toBe(SERVICE_ORDER_STATUSES.Cancelled);

    // OS cancelada nao pode manter compromisso ativo sobre o ativo.
    const allocationRow = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM res.resource_allocations WHERE id = $1`,
      [allocation.id],
    );
    expect(allocationRow.rows[0]?.status).toBe('REMOVED');

    // O ativo fica livre para outra OS na mesma janela.
    const plannedOther = await planningAccess.planResource(actor, otherOrder.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    const reallocated = await planningAccess.allocateResource(actor, otherOrder.id, {
      plannedResourceId: plannedOther.id,
      physicalAssetId: asset.id,
      ...window,
    });
    expect(reallocated.physicalAssetId).toBe(asset.id);

    const events = await listTimelineEvents(cancelledOrder.id);
    const releasedEvents = events.filter(
      (event) => event.event_type === SERVICE_ORDER_HISTORY_EVENTS.AllocationRemoved,
    );
    expect(releasedEvents).toHaveLength(1);
    expect(releasedEvents[0]?.payload).toMatchObject({
      allocationId: allocation.id,
      reason: 'SERVICE_ORDER_CANCELLED',
    });
  });

  it('never leaves an active allocation on an order cancelled in the same instant', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });

    const now = Date.now();
    const window = {
      operationalStart: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      operationalEnd: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    };

    // Corrida real entre despachar e cancelar a mesma OS. A camada de servico
    // valida o estado fora da transacao; o invariante abaixo so se sustenta se
    // a alocacao reler o estado da OS dentro da propria transacao.
    await Promise.allSettled([
      planningAccess.allocateResource(actor, released.id, {
        plannedResourceId: planned.id,
        physicalAssetId: asset.id,
        ...window,
      }),
      serviceOrdersAccess.cancel(actor, released.id, {
        rowVersion: released.rowVersion,
        cancellationReason: 'Cancelada durante o despacho',
      }),
    ]);

    const order = await serviceOrdersAccess.getById(actor, released.id);
    const active = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM res.resource_allocations
       WHERE service_order_id = $1 AND status = 'ACTIVE'::res.resource_allocation_status`,
      [released.id],
    );

    if (order.status === SERVICE_ORDER_STATUSES.Cancelled) {
      expect(active.rows[0]?.count).toBe('0');
    } else {
      // O despacho venceu a corrida: a OS segue liberada e a alocacao e legitima.
      expect(order.status).toBe(SERVICE_ORDER_STATUSES.Released);
    }
  });

  it('blocks removing planned resource with active allocations', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    await expect(
      planningAccess.removePlannedResource(actor, released.id, planned.id, {
        rowVersion: planned.rowVersion,
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });
  });

  it('resolves concurrent planned resource updates deterministically', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '1',
    });

    const results = await Promise.allSettled([
      planningAccess.updatePlannedResource(actor, released.id, planned.id, {
        rowVersion: planned.rowVersion,
        plannedQuantity: '2',
      }),
      planningAccess.updatePlannedResource(actor, released.id, planned.id, {
        rowVersion: planned.rowVersion,
        plannedQuantity: '3',
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('reflects service order allocation in physical asset operational availability', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });

    const before = await assetsAccess.getById(actor, asset.id);
    expect(before.allocationStatus).toBe('AVAILABLE');
    expect(before.currentAllocation).toBeNull();

    await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    const after = await assetsAccess.getById(actor, asset.id);
    expect(after.lifecycleStatus).toBe('ACTIVE');
    expect(after.allocationStatus).toBe('ALLOCATED');
    expect(after.currentAllocation?.serviceOrderId).toBe(released.id);

    const summary = await assetsAccess.summary(actor, {});
    expect(summary.allocated).toBeGreaterThanOrEqual(1);

    const allocatedList = await assetsAccess.list(actor, {
      limit: 20,
      offset: 0,
      availability: 'ALLOCATED',
    });
    expect(allocatedList.items.some((item) => item.id === asset.id)).toBe(true);
  });

  it('assigns workforce member through LABOR allocation and resolves employee ASSIGNED access', async () => {
    const { actor: controlActor, identityId: controlIdentityId } = await seedActor();
    const employee = await createEmployee('EMP-DEV-001');
    const otherEmployee = await createEmployee('EMP-DEV-002');
    await grantEmployeeAssignedAccess(employee.identityId, controlIdentityId);
    await grantEmployeeAssignedAccess(otherEmployee.identityId, controlIdentityId);
    const employeeLogin = await authService.login(
      { login: employee.login, password: AUTH_TEST_PASSWORD },
      { clientKey: `employee-${employee.identityId}`, clientIp: '127.0.0.1' },
    );
    expect(employeeLogin.accessToken).toBeTruthy();
    const { released } = await seedReleasedOrder(controlActor);
    const { released: unassigned } = await seedReleasedOrder(controlActor, '99888777000166');
    const asset = await createWaterTruck(controlActor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const physical = await planningAccess.planResource(controlActor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '2',
    });
    const labor = await planningAccess.planResource(controlActor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '2',
    });

    const physicalAllocation = await planningAccess.allocateResource(controlActor, released.id, {
      plannedResourceId: physical.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });
    expect(physicalAllocation.physicalAssetId).toBe(asset.id);

    const laborAllocation = await planningAccess.allocateResource(controlActor, released.id, {
      plannedResourceId: labor.id,
      workforceMemberId: employee.workforceMemberId,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });
    expect(laborAllocation.workforceMemberId).toBe(employee.workforceMemberId);
    expect(laborAllocation.physicalAssetId).toBeNull();

    const assignedList = await serviceOrdersAccess.list(employee.actor, { limit: 20, offset: 0 });
    expect(assignedList.items.map((item) => item.id)).toContain(released.id);
    expect(assignedList.items.map((item) => item.id)).not.toContain(unassigned.id);

    const assignedDetail = await serviceOrdersAccess.getById(employee.actor, released.id);
    expect(assignedDetail.id).toBe(released.id);
    const started = await executionAccess.start(employee.actor, released.id, {
      rowVersion: assignedDetail.rowVersion,
    });
    expect(started.status).toBe(SERVICE_ORDER_STATUSES.InExecution);

    await expect(serviceOrdersAccess.getById(employee.actor, unassigned.id)).rejects.toMatchObject({
      code: SERVICE_ORDERS_ERROR_CODES.DENIED,
    });
    await expect(serviceOrdersAccess.getById(otherEmployee.actor, released.id)).rejects.toMatchObject({
      code: SERVICE_ORDERS_ERROR_CODES.DENIED,
    });
    await expect(
      serviceOrdersAccess.cancel(employee.actor, released.id, {
        rowVersion: started.rowVersion,
        cancellationReason: 'Tentativa administrativa indevida',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.DENIED });
  });

  it('records allocation history with resource, service order, period and actor', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);
    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });

    const allocated = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    const allocateEvent = allocated.historyEvents.find((event) => event.eventType === 'ALLOCATE_RESOURCE');
    expect(allocateEvent).toBeDefined();
    expect(allocateEvent?.payload).toMatchObject({
      serviceOrderId: released.id,
      plannedResourceId: planned.id,
      physicalAssetId: asset.id,
      resourceTypeCode: 'WATER_TRUCK',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });
    expect(allocateEvent?.actorIdentityId).toBe(actor.identityId);

    const removed = await planningAccess.removeAllocation(actor, released.id, allocated.id, {
      rowVersion: allocated.rowVersion,
    });
    const removeEvent = removed.historyEvents.find((event) => event.eventType === 'REMOVE_ALLOCATION');
    expect(removeEvent?.payload).toMatchObject({
      serviceOrderId: released.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });
    expect(removeEvent?.actorIdentityId).toBe(actor.identityId);
  });

  it('prevents concurrent overlapping allocation across different service orders', async () => {
    const { actor } = await seedActor();
    const { released: orderA } = await seedReleasedOrder(actor, TEST_CNPJ);
    const { released: orderB } = await seedReleasedOrder(actor, TEST_CNPJ_ALT);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);

    const plannedA = await planningAccess.planResource(actor, orderA.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    const plannedB = await planningAccess.planResource(actor, orderB.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });

    const payload = {
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    };

    const results = await Promise.allSettled([
      planningAccess.allocateResource(actor, orderA.id, {
        plannedResourceId: plannedA.id,
        ...payload,
      }),
      planningAccess.allocateResource(actor, orderB.id, {
        plannedResourceId: plannedB.id,
        ...payload,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      rejected.every(
        (result) =>
          result.status === 'rejected' &&
          'code' in (result.reason as { code?: string }) &&
          (result.reason as { code: string }).code === SERVICE_ORDERS_ERROR_CODES.ALLOCATION_CONFLICT,
      ),
    ).toBe(true);

    const active = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM res.resource_allocations
       WHERE physical_asset_id = $1 AND status = 'ACTIVE'`,
      [asset.id],
    );
    expect(active.rows[0]?.count).toBe('1');
  });

  async function grantServiceOrderListAccess(identityId: string, grantedBy: string): Promise<void> {
    await insertGrant(pool, {
      identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }

  async function listTimelineEvents(serviceOrderId: string) {
    const result = await pool.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload
       FROM so.service_order_history_events
       WHERE service_order_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  it('records the programming phase in the service order timeline', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const asset = await createWaterTruck(actor, `WT-${crypto.randomUUID().slice(0, 6)}`);

    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '2',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T12:00:00.000Z',
    });
    const allocation = await planningAccess.allocateResource(actor, released.id, {
      plannedResourceId: planned.id,
      physicalAssetId: asset.id,
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    const afterPlanning = await listTimelineEvents(released.id);
    const plannedAdded = afterPlanning.find(
      (event) => event.event_type === SERVICE_ORDER_HISTORY_EVENTS.PlannedResourceAdded,
    );
    expect(plannedAdded).toBeDefined();
    expect(plannedAdded?.payload).toMatchObject({
      plannedResourceId: planned.id,
      requirementKind: 'PHYSICAL_RESOURCE',
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '2.0000',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T12:00:00.000Z',
    });

    const allocated = afterPlanning.find(
      (event) => event.event_type === SERVICE_ORDER_HISTORY_EVENTS.ResourceAllocated,
    );
    expect(allocated).toBeDefined();
    expect(allocated?.payload).toMatchObject({
      allocationId: allocation.id,
      physicalAssetId: asset.id,
      plannedResourceId: planned.id,
      resourceTypeCode: 'WATER_TRUCK',
    });

    await planningAccess.removeAllocation(actor, released.id, allocation.id, {
      rowVersion: allocation.rowVersion,
    });

    const afterRemoval = await listTimelineEvents(released.id);
    const removed = afterRemoval.find(
      (event) => event.event_type === SERVICE_ORDER_HISTORY_EVENTS.AllocationRemoved,
    );
    expect(removed).toBeDefined();
    expect(removed?.payload).toMatchObject({ allocationId: allocation.id });

    const lifecycleEvents = afterRemoval.map((event) => event.event_type);
    expect(lifecycleEvents).toContain('CREATED');
    expect(lifecycleEvents).toContain('PREPARED');
    expect(lifecycleEvents).toContain('RELEASED');
    expect(lifecycleEvents.indexOf('PLANNED_RESOURCE_ADDED')).toBeGreaterThan(
      lifecycleEvents.indexOf('RELEASED'),
    );
  });

  it('records only the changed fields when replanning', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '1',
      operationalStart: '2026-06-01T08:00:00.000Z',
      operationalEnd: '2026-06-01T10:00:00.000Z',
    });

    await planningAccess.updatePlannedResource(actor, released.id, planned.id, {
      rowVersion: planned.rowVersion,
      plannedQuantity: '3',
    });

    const events = await listTimelineEvents(released.id);
    const updated = events.filter(
      (event) => event.event_type === SERVICE_ORDER_HISTORY_EVENTS.PlannedResourceUpdated,
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]?.payload).toMatchObject({
      plannedResourceId: planned.id,
      plannedQuantity: '3.0000',
      changedFields: ['plannedQuantity'],
    });
  });

  it('does not write a timeline event for a no-op replan', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '1',
    });

    const current = await planningAccess.listPlannedResources(actor, released.id);
    const row = current.find((item) => item.id === planned.id);
    await planningAccess.updatePlannedResource(actor, released.id, planned.id, {
      rowVersion: row!.rowVersion,
      plannedQuantity: '1',
    });

    const events = await listTimelineEvents(released.id);
    expect(
      events.filter(
        (event) => event.event_type === SERVICE_ORDER_HISTORY_EVENTS.PlannedResourceUpdated,
      ),
    ).toHaveLength(0);
  });

  it('removes the planned resource from the timeline when unplanned', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    const planned = await planningAccess.planResource(actor, released.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
      resourceTypeCode: 'WATER_TRUCK',
      plannedQuantity: '1',
    });
    await planningAccess.removePlannedResource(actor, released.id, planned.id, {
      rowVersion: planned.rowVersion,
    });

    const events = await listTimelineEvents(released.id);
    const removedEvent = events.find(
      (event) => event.event_type === SERVICE_ORDER_HISTORY_EVENTS.PlannedResourceRemoved,
    );
    expect(removedEvent).toBeDefined();
    expect(removedEvent?.payload).toMatchObject({
      plannedResourceId: planned.id,
      status: 'REMOVED',
    });
  });

  it('projects the assigned member and the deadline in the dispatch list', async () => {
    const { actor, identityId } = await seedActor();
    await grantServiceOrderListAccess(identityId, identityId);
    const { released: plainOrder } = await seedReleasedOrder(actor, TEST_CNPJ);
    const { released: assignedOrder } = await seedReleasedOrder(actor, TEST_CNPJ_ALT);
    const employee = await createEmployee(`EMP-${crypto.randomUUID().slice(0, 6)}`);

    const plannedLabor = await planningAccess.planResource(actor, assignedOrder.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '1',
    });
    const operationalEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await planningAccess.allocateResource(actor, assignedOrder.id, {
      plannedResourceId: plannedLabor.id,
      workforceMemberId: employee.workforceMemberId,
      operationalStart: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      operationalEnd,
    });

    const listed = await serviceOrdersAccess.list(actor, { limit: 50, offset: 0 });
    const assignedRow = listed.items.find((item) => item.id === assignedOrder.id);
    const plainRow = listed.items.find((item) => item.id === plainOrder.id);

    expect(assignedRow?.assignedWorkforceMember).toMatchObject({
      id: employee.workforceMemberId,
    });
    expect(assignedRow?.assignedWorkforceMember?.memberCode).toContain('EMP-');
    // O prazo vem do kernel so.deadline_for: mesmo instante da janela alocada.
    expect(assignedRow?.deadlineAt).toEqual(new Date(operationalEnd));

    // Sem alocacao ativa nao ha responsavel nem prazo: a lista nao inventa dado.
    expect(plainRow?.assignedWorkforceMember).toBeNull();
    expect(plainRow?.deadlineAt).toBeNull();
  });

  it('segments the operational list by assignment and scheduling', async () => {
    const { actor, identityId } = await seedActor();
    await grantServiceOrderListAccess(identityId, identityId);
    const { released: plainOrder } = await seedReleasedOrder(actor, TEST_CNPJ);
    const { released: assignedOrder } = await seedReleasedOrder(actor, TEST_CNPJ_ALT);
    const employee = await createEmployee(`EMP-${crypto.randomUUID().slice(0, 6)}`);
    await grantEmployeeAssignedAccess(employee.identityId, identityId);

    const plannedLabor = await planningAccess.planResource(actor, assignedOrder.id, {
      requirementKind: PLANNED_RESOURCE_KINDS.Labor,
      laborTypeCode: 'DRIVER',
      plannedQuantity: '1',
    });
    const now = Date.now();
    await planningAccess.allocateResource(actor, assignedOrder.id, {
      plannedResourceId: plannedLabor.id,
      workforceMemberId: employee.workforceMemberId,
      operationalStart: new Date(now - 60 * 60 * 1000).toISOString(),
      operationalEnd: new Date(now + 60 * 60 * 1000).toISOString(),
    });

    const unassigned = await serviceOrdersAccess.list(actor, {
      filter: SERVICE_ORDER_LIST_FILTERS.Unassigned,
      limit: 50,
      offset: 0,
    });
    const unassignedIds = unassigned.items.map((item) => item.id);
    expect(unassignedIds).toContain(plainOrder.id);
    expect(unassignedIds).not.toContain(assignedOrder.id);

    const mine = await serviceOrdersAccess.list(employee.actor, {
      filter: SERVICE_ORDER_LIST_FILTERS.Mine,
      limit: 50,
      offset: 0,
    });
    const mineIds = mine.items.map((item) => item.id);
    expect(mineIds).toContain(assignedOrder.id);
    expect(mineIds).not.toContain(plainOrder.id);

    const unscheduled = await serviceOrdersAccess.list(actor, {
      filter: SERVICE_ORDER_LIST_FILTERS.Unscheduled,
      limit: 50,
      offset: 0,
    });
    const unscheduledIds = unscheduled.items.map((item) => item.id);
    expect(unscheduledIds).toContain(plainOrder.id);
    expect(unscheduledIds).not.toContain(assignedOrder.id);

    const today = await serviceOrdersAccess.list(actor, {
      filter: SERVICE_ORDER_LIST_FILTERS.ScheduledToday,
      limit: 50,
      offset: 0,
    });
    const todayIds = today.items.map((item) => item.id);
    expect(todayIds).toContain(assignedOrder.id);
    expect(todayIds).not.toContain(plainOrder.id);
  });

  it('keeps terminal orders out of the open dispatch segments', async () => {
    const { actor, identityId } = await seedActor();
    await grantServiceOrderListAccess(identityId, identityId);
    const { released } = await seedReleasedOrder(actor);

    await serviceOrdersAccess.cancel(actor, released.id, {
      rowVersion: released.rowVersion,
      cancellationReason: 'encerrado para teste de despacho',
    });

    for (const filter of [
      SERVICE_ORDER_LIST_FILTERS.Unassigned,
      SERVICE_ORDER_LIST_FILTERS.Unscheduled,
      SERVICE_ORDER_LIST_FILTERS.ScheduledToday,
    ]) {
      const listed = await serviceOrdersAccess.list(actor, { filter, limit: 50, offset: 0 });
      expect(listed.items.map((item) => item.id)).not.toContain(released.id);
    }
  });
});

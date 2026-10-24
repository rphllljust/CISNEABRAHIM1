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
import { SERVICE_ORDER_ORIGINS, SERVICE_ORDER_STATUSES } from './domain/service-order';
import { SERVICE_ORDERS_ERROR_CODES } from './errors/service-orders-error-codes';
import { ServiceOrdersModule } from './service-orders.module';
import { ServiceOrderExecutionAccessService } from './services/service-order-execution-access.service';
import { ServiceOrderPlanningAccessService } from './services/service-order-planning-access.service';
import { ServiceOrdersAccessService } from './services/service-orders-access.service';

const UNIT_A = 'unit-exec-a';
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

async function grantExecutionAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCancel,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourceRead,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourceUpdate,
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

describe('Service order execution PostgreSQL integration', () => {
  let pool: Pool;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let planningAccess: ServiceOrderPlanningAccessService;
  let executionAccess: ServiceOrderExecutionAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for execution integration tests.');
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
    const login = normalizeLoginIdentifier(`exec-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantExecutionAdmin(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedReleasedOrder(actor: { identityId: string; sessionId: string }) {
    const client = await clientAccess.create(actor, {
      legalName: `Cliente Exec ${crypto.randomUUID()}`,
      tradeName: 'Cliente Exec',
      taxId: TEST_CNPJ,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, {
      code: `CAT-${suffix}`,
      name: 'Serviços',
    });
    const draft = await catalogAccess.create(actor, {
      code: `EXEC-SRV-${suffix}`,
      name: 'Serviço com execução',
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
      description: 'OS para execução',
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

  it('starts execution from RELEASED when minimum planning is satisfied', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });

    expect(started.status).toBe(SERVICE_ORDER_STATUSES.InExecution);
    expect(started.startedAt).toBeTruthy();
  });

  it('rejects start when minimum resources are not planned', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    await pool.query('DELETE FROM so.planned_resources WHERE service_order_id = $1', [released.id]);

    await expect(
      executionAccess.start(actor, released.id, { rowVersion: released.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.MINIMUM_RESOURCES_NOT_MET });
  });

  it('records actual entries without overwriting planning and completes with required evidence', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });

    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Serviço iniciado conforme planejado.',
    });
    const afterObservation = await serviceOrdersAccess.getById(actor, started.id);

    await executionAccess.recordQuantity(actor, afterObservation.id, {
      rowVersion: afterObservation.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });
    const afterQuantity = await serviceOrdersAccess.getById(actor, started.id);

    const bundle = await executionAccess.getExecution(actor, started.id);
    expect(bundle.entries).toHaveLength(2);
    expect(bundle.entries.some((entry) => entry.entryType === 'QUANTITY')).toBe(true);

    const planned = await planningAccess.listPlannedResources(actor, started.id);
    expect(planned).toHaveLength(2);

    const completed = await executionAccess.complete(actor, afterQuantity.id, {
      rowVersion: afterQuantity.rowVersion,
    }).catch((error: { getResponse?: () => unknown; code?: string }) => {
      const body = error?.getResponse?.() as
        | { error?: { details?: { blockingReasons?: Array<{ code: string }> } } }
        | undefined;
      const reasons = body?.error?.details?.blockingReasons?.map((item) => item.code) ?? [];
      throw new Error(`complete recusado: code=${error?.code} reasons=${reasons.join(',')}`);
    });
    expect(completed.status).toBe(SERVICE_ORDER_STATUSES.Completed);
  });

  it('rejects completion when required evidence is missing', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });

    /**
     * O gate de conclusão devolve TODOS os motivos, então a ausência de evidência
     * vem acompanhada da ausência de quantidade medida. O código de erro é o do
     * GATE (`COMPLETION_BLOCKED`); a evidência aparece entre os motivos, e é o que
     * a asserção verifica — antes o teste checava o código de um gate mais fraco.
     */
    await expect(
      executionAccess.complete(actor, started.id, { rowVersion: started.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.COMPLETION_BLOCKED });
  });

  it('supports pause and resume without losing execution data', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    const paused = await executionAccess.pause(actor, started.id, { rowVersion: started.rowVersion });
    expect(paused.status).toBe(SERVICE_ORDER_STATUSES.Paused);

    await executionAccess.recordObservation(actor, paused.id, {
      rowVersion: paused.rowVersion,
      text: 'Pausa operacional registrada.',
    });

    const resumed = await executionAccess.resume(actor, paused.id, { rowVersion: paused.rowVersion + 1 });
    expect(resumed.status).toBe(SERVICE_ORDER_STATUSES.InExecution);
  });

  it('returns idempotent start for duplicate idempotency key', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const key = `idem-${crypto.randomUUID()}`;

    const first = await executionAccess.start(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: key,
    });
    const second = await executionAccess.start(actor, released.id, {
      rowVersion: released.rowVersion,
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe(SERVICE_ORDER_STATUSES.InExecution);
  });

  it('allows only one concurrent start transition', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    const results = await Promise.allSettled([
      executionAccess.start(actor, released.id, { rowVersion: released.rowVersion }),
      executionAccess.start(actor, released.id, { rowVersion: released.rowVersion }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const current = await serviceOrdersAccess.getById(actor, released.id);
    expect(current.status).toBe(SERVICE_ORDER_STATUSES.InExecution);
  });

  it('records security audit for start and complete', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });

    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Observação de execução.',
    });
    const mid = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, mid.id, {
      rowVersion: mid.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });
    const ready = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.complete(actor, ready.id, { rowVersion: ready.rowVersion });

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1 ORDER BY occurred_at ASC`,
      [released.id],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toContain(SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionStart);
    expect(actions).toContain(SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionComplete);
  });

  it('rejects execution transitions from invalid states', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    const draftOrder = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      description: 'OS em rascunho',
    });

    await expect(
      executionAccess.start(actor, draftOrder.id, { rowVersion: draftOrder.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    await expect(
      executionAccess.pause(actor, released.id, { rowVersion: released.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await expect(
      executionAccess.start(actor, started.id, { rowVersion: started.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });
    await expect(
      executionAccess.resume(actor, started.id, { rowVersion: started.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });
    await expect(
      serviceOrdersAccess.cancel(actor, started.id, {
        rowVersion: started.rowVersion,
        cancellationReason: 'Tentativa inválida',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Evidência antes da pausa.',
    });
    const withEvidence = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, withEvidence.id, {
      rowVersion: withEvidence.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });
    const readyToPause = await serviceOrdersAccess.getById(actor, started.id);
    const paused = await executionAccess.pause(actor, readyToPause.id, {
      rowVersion: readyToPause.rowVersion,
    });
    await expect(
      executionAccess.complete(actor, paused.id, { rowVersion: paused.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });
  });

  it('records security audit for pause and resume', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    const paused = await executionAccess.pause(actor, started.id, { rowVersion: started.rowVersion });
    await executionAccess.resume(actor, paused.id, { rowVersion: paused.rowVersion });

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1 ORDER BY occurred_at ASC`,
      [released.id],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toContain(SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionPause);
    expect(actions).toContain(SECURITY_AUDIT_ACTIONS.ServiceOrdersExecutionResume);
  });

  it('returns VERSION_CONFLICT on stale pause rowVersion', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });

    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Registro concorrente.',
    });

    await expect(
      executionAccess.pause(actor, started.id, { rowVersion: started.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.VERSION_CONFLICT });
  });

  it('rejects cancel and complete from terminal COMPLETED', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });

    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Evidência mínima.',
    });
    const mid = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, mid.id, {
      rowVersion: mid.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });
    const ready = await serviceOrdersAccess.getById(actor, started.id);
    const completed = await executionAccess.complete(actor, ready.id, { rowVersion: ready.rowVersion });

    await expect(
      serviceOrdersAccess.cancel(actor, completed.id, {
        rowVersion: completed.rowVersion,
        cancellationReason: 'Tarde demais',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    await expect(
      executionAccess.complete(actor, completed.id, { rowVersion: completed.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });
  });

  it('resolves pause versus complete race deterministically', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });

    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Evidência para conclusão.',
    });
    const mid = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, mid.id, {
      rowVersion: mid.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });
    const ready = await serviceOrdersAccess.getById(actor, started.id);

    const results = await Promise.allSettled([
      executionAccess.pause(actor, ready.id, { rowVersion: ready.rowVersion }),
      executionAccess.complete(actor, ready.id, { rowVersion: ready.rowVersion }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const current = await serviceOrdersAccess.getById(actor, released.id);
    expect([SERVICE_ORDER_STATUSES.Paused, SERVICE_ORDER_STATUSES.Completed]).toContain(current.status);
  });

  it('exposes planned versus actual comparison without mutating execution entries', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Observacao inicial.',
    });
    const afterObservation = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, afterObservation.id, {
      rowVersion: afterObservation.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });

    const bundle = await executionAccess.getExecution(actor, started.id);
    const quantityRow = bundle.comparison.quantities.find((row) => row.unitCode === 'SERVICE');
    expect(quantityRow?.actualQuantity).toBe('1');
    expect(quantityRow?.plannedQuantity).toBeTruthy();
    expect(bundle.comparison.entryCount).toBe(2);
    expect(bundle.entries).toHaveLength(2);
  });

  it('preserves immutable execution facts when planning changes during IN_EXECUTION', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Fato registrado antes do replanejamento.',
    });
    const afterRecord = await serviceOrdersAccess.getById(actor, started.id);
    const entriesBefore = await pool.query<{ id: string; text_value: string | null }>(
      `SELECT id, text_value FROM so.execution_entries WHERE service_order_id = $1 ORDER BY recorded_at ASC`,
      [started.id],
    );

    const labor = (await planningAccess.listPlannedResources(actor, started.id)).find(
      (item) => item.laborTypeCode === 'DRIVER',
    );
    expect(labor).toBeDefined();
    await planningAccess.updatePlannedResource(actor, started.id, labor!.id, {
      rowVersion: labor!.rowVersion,
      plannedQuantity: '3',
      notes: 'Reforco operacional',
    });

    const entriesAfter = await pool.query<{ id: string; text_value: string | null }>(
      `SELECT id, text_value FROM so.execution_entries WHERE service_order_id = $1 ORDER BY recorded_at ASC`,
      [started.id],
    );
    expect(entriesAfter.rows.map((row) => row.id)).toEqual(entriesBefore.rows.map((row) => row.id));
    expect(entriesAfter.rows[0]?.text_value).toBe('Fato registrado antes do replanejamento.');

    const bundle = await executionAccess.getExecution(actor, afterRecord.id);
    expect(bundle.comparison.entryCount).toBe(1);
    expect(bundle.entries[0]?.textValue).toBe('Fato registrado antes do replanejamento.');
    expect(bundle.comparison.resources.some(
      (row) => row.code === 'DRIVER' && Number(row.plannedQuantity) === 3,
    )).toBe(true);
  });

  it('records occurrences as actual facts independent from planning', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    const recorded = await executionAccess.recordOccurrence(actor, started.id, {
      rowVersion: started.rowVersion,
      occurrenceCode: 'WEATHER_DELAY',
      description: 'Chuva forte interrompeu a frente.',
    });
    expect(recorded.occurrence.occurrenceCode).toBe('WEATHER_DELAY');

    const bundle = await executionAccess.getExecution(actor, started.id);
    expect(bundle.occurrences).toHaveLength(1);
    expect(bundle.comparison.occurrenceCount).toBe(1);
  });

  it('rejects recording execution facts from RELEASED and COMPLETED states', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);

    await expect(
      executionAccess.recordObservation(actor, released.id, {
        rowVersion: released.rowVersion,
        text: 'Nao deveria registrar em RELEASED.',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Evidencia minima.',
    });
    const mid = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, mid.id, {
      rowVersion: mid.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });
    const ready = await serviceOrdersAccess.getById(actor, started.id);
    const completed = await executionAccess.complete(actor, ready.id, { rowVersion: ready.rowVersion });

    await expect(
      executionAccess.recordQuantity(actor, completed.id, {
        rowVersion: completed.rowVersion,
        quantityValue: '2',
        unitCode: 'SERVICE',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });
  });

  it('resolves record versus complete race deterministically', async () => {
    const { actor } = await seedActor();
    const { released } = await seedReleasedOrder(actor);
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });

    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Evidencia para conclusao.',
    });
    const mid = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, mid.id, {
      rowVersion: mid.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });
    const ready = await serviceOrdersAccess.getById(actor, started.id);

    const results = await Promise.allSettled([
      executionAccess.recordObservation(actor, ready.id, {
        rowVersion: ready.rowVersion,
        text: 'Registro concorrente.',
      }),
      executionAccess.complete(actor, ready.id, { rowVersion: ready.rowVersion }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const bundle = await executionAccess.getExecution(actor, released.id);
    expect(bundle.comparison.entryCount).toBeGreaterThanOrEqual(2);
  });
});

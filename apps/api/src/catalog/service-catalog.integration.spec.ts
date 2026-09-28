import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertCatalogCategory,
  insertGrant,
  insertIdentity,
  truncateCatalogTables,
  truncateIdentityAndAuthorizationTables,
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
import { CatalogModule } from './catalog.module';
import { CATALOG_ERROR_CODES } from './errors/catalog-error-codes';
import { CatalogHttpException } from './errors/catalog-http.exception';
import { ServiceCatalogAccessService } from './services/service-catalog-access.service';

const SAMPLE_UNITS = [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }];
const SAMPLE_PRICING_MODELS = [
  {
    modelCode: 'DAILY',
    salePrice: '1200.00',
    internalCost: '900.00',
  },
];
const SAMPLE_RESOURCE_REQUIREMENTS = [
  {
    resourceTypeCode: 'WATER_TRUCK',
    requirementLevel: 'REQUIRED' as const,
    minQuantity: 1,
    sortOrder: 0,
  },
];
const EMPTY_RESOURCE_REQUIREMENTS: [] = [];
const SAMPLE_LABOR_REQUIREMENTS = [
  {
    laborTypeCode: 'DRIVER',
    requirementLevel: 'REQUIRED' as const,
    minQuantity: 1,
    sortOrder: 0,
  },
];
const EMPTY_LABOR_REQUIREMENTS: [] = [];
const EMPTY_EXECUTION_REQUIREMENTS: [] = [];
const SAMPLE_EXECUTION_REQUIREMENTS = [
  { requirementType: 'PHOTO', requirementLevel: 'REQUIRED' as const, sortOrder: 0 },
];

async function grantCatalogAdmin(
  pool: Pool,
  identityId: string,
  grantedBy: string,
): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServiceList,
    AUTHZ_ACTIONS.CatalogServiceUpdate,
    AUTHZ_ACTIONS.CatalogServicePublish,
    AUTHZ_ACTIONS.CatalogServiceDeactivate,
    AUTHZ_ACTIONS.CatalogServiceActivate,
  ];
  for (const action of actions) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.CatalogService,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Service catalog PostgreSQL integration', () => {
  let pool: Pool;
  let catalogAccess: ServiceCatalogAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for service catalog integration tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);

    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, CatalogModule],
    }).compile();

    catalogAccess = module.get(ServiceCatalogAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(): Promise<{ identityId: string; categoryId: string }> {
    const login = normalizeLoginIdentifier(`catalog-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantCatalogAdmin(pool, identityId, identityId);
    const { categoryId } = await insertCatalogCategory(pool, { actorIdentityId: identityId });
    return { identityId, categoryId };
  }

  function createPayload(categoryId: string, code = 'LOCACAO_CAMINHAO_PIPA') {
    return {
      code,
      name: 'Locação Caminhão Pipa',
      categoryId,
      archetype: 'RENTAL',
      measurementMode: 'BY_PERIOD',
      measurementBasis: 'TIME',
      allowedUnits: SAMPLE_UNITS,
      pricingModels: SAMPLE_PRICING_MODELS,
    };
  }

  function draftUpdateBase(categoryId: string, lineageVersion: number) {
    return {
      lineageVersion,
      name: 'Locação Caminhão Pipa — Rascunho',
      categoryId,
      archetype: 'RENTAL',
      measurementMode: 'BY_PERIOD',
      measurementBasis: 'TIME',
      allowedUnits: SAMPLE_UNITS,
      resourceRequirements: EMPTY_RESOURCE_REQUIREMENTS,
      laborRequirements: EMPTY_LABOR_REQUIREMENTS,
      pricingModels: SAMPLE_PRICING_MODELS,
      executionRequirements: EMPTY_EXECUTION_REQUIREMENTS,
    };
  }

  function versionCreateBase(categoryId: string) {
    return {
      name: 'Locação Caminhão Pipa v2',
      categoryId,
      archetype: 'RENTAL',
      measurementMode: 'BY_PERIOD',
      measurementBasis: 'TIME',
      allowedUnits: SAMPLE_UNITS,
      resourceRequirements: EMPTY_RESOURCE_REQUIREMENTS,
      laborRequirements: EMPTY_LABOR_REQUIREMENTS,
      pricingModels: SAMPLE_PRICING_MODELS,
      executionRequirements: EMPTY_EXECUTION_REQUIREMENTS,
    };
  }

  it('creates, reads, updates draft, publishes, deactivates and reactivates', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, createPayload(categoryId));
    expect(created.status).toBe('DRAFT');
    expect(created.code).toBe('LOCACAO_CAMINHAO_PIPA');
    expect(created.version).toBe(1);

    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    expect(definition.code).toBe('LOCACAO_CAMINHAO_PIPA');
    expect(definition.version).toBe(1);

    const updated = await catalogAccess.updateDraft(actor, created.serviceDefinitionId, 1, draftUpdateBase(categoryId, definition.version));
    expect(updated.name).toBe('Locação Caminhão Pipa — Rascunho');

    const definitionAfterUpdate = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    const published = await catalogAccess.publishVersion(
      actor,
      created.serviceDefinitionId,
      1,
      definitionAfterUpdate.version,
    );
    expect(published.status).toBe('PUBLISHED');

    const afterPublish = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    expect(afterPublish.latestPublishedVersion).toBe(1);

    const deactivated = await catalogAccess.deactivate(
      actor,
      created.serviceDefinitionId,
      afterPublish.version,
      'Descontinuado',
    );
    expect(deactivated.status).toBe('INACTIVE');

    const reactivated = await catalogAccess.activate(
      actor,
      created.serviceDefinitionId,
      deactivated.version,
    );
    expect(reactivated.status).toBe('ACTIVE');
  });

  it('rejects duplicate service codes', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };
    const payload = createPayload(categoryId);

    await catalogAccess.create(actor, payload);

    await expect(catalogAccess.create(actor, { ...payload, name: 'Outro nome' })).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CODE_CONFLICT,
    });
  });

  it('rejects updating a published version', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, createPayload(categoryId));
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    const published = await catalogAccess.publishVersion(
      actor,
      created.serviceDefinitionId,
      1,
      definition.version,
    );
    expect(published.status).toBe('PUBLISHED');

    await expect(
      catalogAccess.updateDraft(actor, created.serviceDefinitionId, 1, {
        ...draftUpdateBase(categoryId, definition.version + 1),
        name: 'Tentativa inválida',
      }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.INVALID_STATE });
  });

  it('creates a new draft version from a published version', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, createPayload(categoryId));
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    await catalogAccess.publishVersion(actor, created.serviceDefinitionId, 1, definition.version);

    const version2 = await catalogAccess.createVersion(actor, created.serviceDefinitionId, {
      ...versionCreateBase(categoryId),
      sourceVersion: 1,
    });
    expect(version2.version).toBe(2);
    expect(version2.status).toBe('DRAFT');

    const versions = await catalogAccess.listVersions(actor, created.serviceDefinitionId);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('rejects invalid publish when allowed units are missing', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, createPayload(categoryId));
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);

    await pool.query(`DELETE FROM cat.service_allowed_units WHERE service_definition_version_id = $1`, [
      created.id,
    ]);

    await expect(
      catalogAccess.publishVersion(actor, created.serviceDefinitionId, 1, definition.version),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.INVALID_UNIT });
  });

  it('detects optimistic concurrency conflicts on draft update', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, createPayload(categoryId));
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);

    await catalogAccess.updateDraft(actor, created.serviceDefinitionId, 1, {
      ...draftUpdateBase(categoryId, definition.version),
      name: 'Primeira alteração',
    });

    await expect(
      catalogAccess.updateDraft(actor, created.serviceDefinitionId, 1, {
        ...draftUpdateBase(categoryId, definition.version),
        name: 'Alteração obsoleta',
      }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.VERSION_CONFLICT });
  });

  it('denies access without grants and rejects non-global scope', async () => {
    const admin = await seedActor();
    const employeeLogin = normalizeLoginIdentifier(`catalog-employee-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: employeeId } = await insertIdentity(pool, employeeLogin, passwordHash);

    const created = await catalogAccess.create(
      { identityId: admin.identityId, sessionId: 'sid' },
      createPayload(admin.categoryId),
    );

    await expect(
      catalogAccess.listDefinitions({ identityId: employeeId, sessionId: 'sid' }, { limit: 20, offset: 0 }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.DENIED });

    await insertGrant(pool, {
      identityId: employeeId,
      action: AUTHZ_ACTIONS.CatalogServiceRead,
      resourceType: AUTHZ_RESOURCE_TYPES.CatalogService,
      scopeType: AUTHZ_SCOPES.Client,
      resourceId: created.serviceDefinitionId,
      grantedByIdentityId: admin.identityId,
    });

    await expect(
      catalogAccess.getDefinition({ identityId: employeeId, sessionId: 'sid' }, created.serviceDefinitionId),
    ).rejects.toBeInstanceOf(CatalogHttpException);
  });

  it('returns not found for unknown definitions without leaking ORM fields', async () => {
    const { identityId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await expect(catalogAccess.getDefinition(actor, crypto.randomUUID())).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.NOT_FOUND,
    });

    const { identityId: categoryActor, categoryId } = await seedActor();
    const created = await catalogAccess.create(
      { identityId: categoryActor, sessionId: 'sid' },
      createPayload(categoryId),
    );
    const response = JSON.parse(JSON.stringify(created)) as Record<string, unknown>;
    expect(response).not.toHaveProperty('service_definition_id');
    expect(response).not.toHaveProperty('allowed_units');
    expect(response).toHaveProperty('allowedUnits');
  });

  it('lists definitions with pagination and stable ordering', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await catalogAccess.create(actor, createPayload(categoryId, 'SERVICE_ALPHA'));
    await catalogAccess.create(actor, createPayload(categoryId, 'SERVICE_BETA'));

    const page = await catalogAccess.listDefinitions(actor, { limit: 1, offset: 0 });
    expect(page.items).toHaveLength(1);
    expect(page.limit).toBe(1);
    expect(page.offset).toBe(0);

    const all = await catalogAccess.listDefinitions(actor, { limit: 20, offset: 0 });
    expect(all.items.map((item) => item.code)).toEqual(['SERVICE_ALPHA', 'SERVICE_BETA']);
  });

  it('projects the human NAME of the current version into the list, with category', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    // Nunca publicada: o nome vigente e o do DRAFT.
    const draftOnly = await catalogAccess.create(actor, createPayload(categoryId, 'SERVICE_DRAFT_ONLY'));
    const beforePublish = await catalogAccess.listDefinitions(actor, { limit: 20, offset: 0 });
    const draftRow = beforePublish.items.find((item) => item.code === 'SERVICE_DRAFT_ONLY');
    expect(draftRow?.name).toBe('Locação Caminhão Pipa');
    expect(draftRow?.nameVersion).toBe(1);
    expect(draftRow?.nameVersionStatus).toBe('DRAFT');
    expect(draftRow?.categoryCode).not.toBeNull();

    // Publicada: o nome passa a vir da versao ACTIVE — e a ACTIVE VENCE o DRAFT mais novo.
    const definition = await catalogAccess.getDefinition(actor, draftOnly.serviceDefinitionId);
    await catalogAccess.publishVersion(actor, draftOnly.serviceDefinitionId, 1, definition.version);
    await catalogAccess.createVersion(actor, draftOnly.serviceDefinitionId, versionCreateBase(categoryId));

    const afterPublish = await catalogAccess.listDefinitions(actor, { limit: 20, offset: 0 });
    const publishedRow = afterPublish.items.find((item) => item.code === 'SERVICE_DRAFT_ONLY');
    // O draft v2 (nome "... v2") existe e e MAIS NOVO, mas a versao vigente e a publicada v1.
    expect(publishedRow?.currentDraftVersion).toBe(2);
    expect(publishedRow?.latestPublishedVersion).toBe(1);
    expect(publishedRow?.name).toBe('Locação Caminhão Pipa');
    expect(publishedRow?.nameVersion).toBe(1);
    expect(publishedRow?.nameVersionStatus).toBe('PUBLISHED');
  });

  it('leaves name null when the definition has no ACTIVE and no DRAFT version', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, createPayload(categoryId, 'SERVICE_NO_VERSION'));
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    await catalogAccess.publishVersion(actor, created.serviceDefinitionId, 1, definition.version);
    // Sem ACTIVE (a publicada foi retirada) e sem DRAFT nao existe texto humano vigente.
    // A consistencia de RETIRED exige retired_at + retired_by_identity_id (CHECK do banco).
    await pool.query(
      `UPDATE cat.service_definition_versions
          SET status = 'RETIRED', retired_at = now(), retired_by_identity_id = $2
        WHERE id = $1`,
      [created.id, identityId],
    );

    const page = await catalogAccess.listDefinitions(actor, { limit: 20, offset: 0 });
    const row = page.items.find((item) => item.code === 'SERVICE_NO_VERSION');
    expect(row?.name).toBeNull();
    // A lista continua identificavel pelo code — a UI cai nele.
    expect(row?.code).toBe('SERVICE_NO_VERSION');
  });

  it('searches by NAME and by CODE, and does not list unlimited rows', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await catalogAccess.create(actor, { ...createPayload(categoryId, 'CNAE-7711000'), name: 'Locação de automóveis sem condutor' });
    await catalogAccess.create(actor, { ...createPayload(categoryId, 'SERVICE_TERRAPLENAGEM'), name: 'Terraplenagem' });

    const byName = await catalogAccess.listDefinitions(actor, { limit: 20, offset: 0, search: 'terraplenagem' });
    expect(byName.items.map((item) => item.code)).toEqual(['SERVICE_TERRAPLENAGEM']);
    expect(byName.items[0]?.name).toBe('Terraplenagem');

    const byCode = await catalogAccess.listDefinitions(actor, { limit: 20, offset: 0, search: 'CNAE-7711' });
    expect(byCode.items.map((item) => item.code)).toEqual(['CNAE-7711000']);

    // Busca parcial e case-insensitive por nome.
    const partial = await catalogAccess.listDefinitions(actor, { limit: 20, offset: 0, search: 'AUTOMÓVEIS' });
    expect(partial.items.map((item) => item.code)).toEqual(['CNAE-7711000']);

    // Sem termo, a pagina continua limitada pelo servidor.
    const all = await catalogAccess.listDefinitions(actor, { limit: 1, offset: 0 });
    expect(all.items).toHaveLength(1);
  });

  it('treats the search term as text, not as a LIKE pattern', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await catalogAccess.create(actor, createPayload(categoryId, 'SERVICE_WILDCARD'));

    // '%' nao pode virar curinga: sem escape isto devolveria a lista inteira.
    const wildcard = await catalogAccess.listDefinitions(actor, { limit: 20, offset: 0, search: '%' });
    expect(wildcard.items).toHaveLength(0);
  });

  it('rejects unknown unit codes on service definition create', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await expect(
      catalogAccess.create(actor, {
        ...createPayload(categoryId),
        allowedUnits: [{ unitCode: 'NOT_A_UNIT', isDefault: true }],
      }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.INVALID_UNIT });
  });

  it('keeps historical published versions valid when a unit is later deactivated', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, createPayload(categoryId));
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    await catalogAccess.publishVersion(actor, created.serviceDefinitionId, 1, definition.version);

    const day = await pool.query<{ id: string; version: number }>(
      `SELECT id, version FROM cat.units_of_measure WHERE code = 'DAY'`,
    );
    const dayRow = day.rows[0];
    expect(dayRow).toBeDefined();

    await pool.query(
      `UPDATE cat.units_of_measure
       SET status = 'INACTIVE', version = version + 1, deactivated_at = now()
       WHERE id = $1`,
      [dayRow!.id],
    );

    const historical = await catalogAccess.getVersion(actor, created.serviceDefinitionId, 1);
    expect(historical.status).toBe('PUBLISHED');
    expect(historical.allowedUnits.some((unit) => unit.unitCode === 'DAY')).toBe(true);

    await expect(catalogAccess.create(actor, createPayload(categoryId, 'NEW_AFTER_INACTIVE'))).rejects
      .toMatchObject({ code: CATALOG_ERROR_CODES.INACTIVE_UNIT });
  });

  it('associates physical resource type requirements on service definitions', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId),
      resourceRequirements: SAMPLE_RESOURCE_REQUIREMENTS,
    });
    expect(created.resourceRequirements).toEqual([
      {
        resourceTypeCode: 'WATER_TRUCK',
        requirementLevel: 'REQUIRED',
        minQuantity: 1,
        sortOrder: 0,
      },
    ]);
  });

  it('rejects unknown resource type codes on service definition create', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await expect(
      catalogAccess.create(actor, {
        ...createPayload(categoryId),
        resourceRequirements: [
          {
            resourceTypeCode: 'NOT_A_TYPE',
            requirementLevel: 'REQUIRED',
            minQuantity: 1,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.INVALID_RESOURCE_TYPE });
  });

  it('keeps historical published versions valid when a resource type is later deactivated', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId),
      resourceRequirements: SAMPLE_RESOURCE_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    await catalogAccess.publishVersion(actor, created.serviceDefinitionId, 1, definition.version);

    const waterTruck = await pool.query<{ id: string; version: number }>(
      `SELECT id, version FROM cat.physical_resource_types WHERE code = 'WATER_TRUCK'`,
    );
    const typeRow = waterTruck.rows[0];
    expect(typeRow).toBeDefined();

    await pool.query(
      `UPDATE cat.physical_resource_types
       SET status = 'INACTIVE', version = version + 1, deactivated_at = now()
       WHERE id = $1`,
      [typeRow!.id],
    );

    const historical = await catalogAccess.getVersion(actor, created.serviceDefinitionId, 1);
    expect(historical.status).toBe('PUBLISHED');
    expect(
      historical.resourceRequirements.some((requirement) => requirement.resourceTypeCode === 'WATER_TRUCK'),
    ).toBe(true);

    await expect(
      catalogAccess.create(actor, {
        ...createPayload(categoryId, 'NEW_AFTER_INACTIVE_TYPE'),
        resourceRequirements: SAMPLE_RESOURCE_REQUIREMENTS,
      }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.INACTIVE_RESOURCE_TYPE });
  });

  it('copies resource requirements when creating a draft version from source', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId),
      resourceRequirements: SAMPLE_RESOURCE_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    await catalogAccess.publishVersion(actor, created.serviceDefinitionId, 1, definition.version);

    const version2 = await catalogAccess.createVersion(actor, created.serviceDefinitionId, {
      ...versionCreateBase(categoryId),
      sourceVersion: 1,
    });

    expect(version2.resourceRequirements).toEqual([
      {
        resourceTypeCode: 'WATER_TRUCK',
        requirementLevel: 'REQUIRED',
        minQuantity: 1,
        sortOrder: 0,
      },
    ]);
  });

  it('associates labor type requirements on service definitions', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId, 'LOCACAO_CAMINHAO_PIPA_LABOR'),
      laborRequirements: SAMPLE_LABOR_REQUIREMENTS,
    });
    expect(created.laborRequirements).toEqual([
      {
        laborTypeCode: 'DRIVER',
        requirementLevel: 'REQUIRED',
        minQuantity: 1,
        sortOrder: 0,
      },
    ]);
  });

  it('rejects unknown labor type codes on service definition create', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await expect(
      catalogAccess.create(actor, {
        ...createPayload(categoryId),
        laborRequirements: [
          {
            laborTypeCode: 'NOT_A_LABOR_TYPE',
            requirementLevel: 'REQUIRED',
            minQuantity: 1,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.INVALID_LABOR_TYPE });
  });

  it('keeps historical published versions valid when a labor type is later deactivated', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId, 'INSTALACAO_ELETRICA'),
      laborRequirements: [{ laborTypeCode: 'ELECTRICIAN', requirementLevel: 'REQUIRED', minQuantity: 1 }],
    });
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    await catalogAccess.publishVersion(actor, created.serviceDefinitionId, 1, definition.version);

    const electrician = await pool.query<{ id: string }>(
      `SELECT id FROM cat.operational_labor_types WHERE code = 'ELECTRICIAN'`,
    );
    const typeRow = electrician.rows[0];
    expect(typeRow).toBeDefined();

    await pool.query(
      `UPDATE cat.operational_labor_types
       SET status = 'INACTIVE', version = version + 1, deactivated_at = now()
       WHERE id = $1`,
      [typeRow!.id],
    );

    const historical = await catalogAccess.getVersion(actor, created.serviceDefinitionId, 1);
    expect(historical.laborRequirements.some((requirement) => requirement.laborTypeCode === 'ELECTRICIAN')).toBe(
      true,
    );
  });

  it('does not expose employee or assignment concepts in labor type catalog', async () => {
    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname IN ('cat', 'pty', 'identity')
         AND tablename ~* '(employee|assignment|payroll|personnel)'`,
    );
    expect(tables.rows).toEqual([]);
  });

  it('persists global commercial price separate from internal cost', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId, 'OBRA_ESPECIAL_GLOBAL'),
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [
        {
          modelCode: 'GLOBAL_PRICE',
          salePrice: '96000.00',
          internalCost: '85000.00',
        },
      ],
    });

    expect(created.pricingModels).toEqual([
      expect.objectContaining({
        modelCode: 'GLOBAL_PRICE',
        salePrice: '96000',
        internalCost: '85000',
        currencyCode: 'BRL',
      }),
    ]);
    expect(created.pricingModels[0]?.salePrice).not.toBe(created.pricingModels[0]?.internalCost);
  });

  it('persists negotiated PO unit price', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId, 'SERVICO_PO_NEGOCIADO'),
      measurementMode: 'BY_QUANTITY',
      measurementBasis: 'UNIT',
      allowedUnits: [{ unitCode: 'UA', isDefault: true, sortOrder: 0 }],
      pricingModels: [
        {
          modelCode: 'NEGOTIATED_PO_PRICE',
          unitCode: 'UA',
          salePrice: '9351.00',
        },
      ],
    });

    expect(created.pricingModels[0]).toMatchObject({
      modelCode: 'NEGOTIATED_PO_PRICE',
      unitCode: 'UA',
      salePrice: '9351',
    });
  });

  it('rejects incompatible pricing unit with allowed units', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await expect(
      catalogAccess.create(actor, {
        ...createPayload(categoryId, 'TRANSPORTE_KM_INVALIDO'),
        measurementMode: 'BY_QUANTITY',
        measurementBasis: 'DISTANCE',
        allowedUnits: [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }],
        pricingModels: [{ modelCode: 'PER_KM' }],
      }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.PRICING_UNIT_NOT_ALLOWED });
  });

  it('preserves pricing models when versioning from published source', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId, 'VERSION_PRICING_COPY'),
      pricingModels: [{ modelCode: 'UNIT_PRICE', unitCode: 'UN', salePrice: '100.00' }],
      allowedUnits: [{ unitCode: 'UN', isDefault: true, sortOrder: 0 }],
      measurementMode: 'BY_QUANTITY',
      measurementBasis: 'UNIT',
    });
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    await catalogAccess.publishVersion(actor, created.serviceDefinitionId, 1, definition.version);

    const version2 = await catalogAccess.createVersion(actor, created.serviceDefinitionId, {
      ...versionCreateBase(categoryId),
      allowedUnits: [{ unitCode: 'UN', isDefault: true, sortOrder: 0 }],
      measurementMode: 'BY_QUANTITY',
      measurementBasis: 'UNIT',
      pricingModels: [],
      sourceVersion: 1,
    });

    expect(version2.pricingModels[0]).toMatchObject({
      modelCode: 'UNIT_PRICE',
      unitCode: 'UN',
      salePrice: '100',
    });
  });

  it('associates required and optional execution requirements on service definitions', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId, 'EXEC_REQ_BASIC'),
      executionRequirements: [
        { requirementType: 'PHOTO', requirementLevel: 'REQUIRED' },
        { requirementType: 'OBSERVATION', requirementLevel: 'OPTIONAL' },
      ],
    });

    expect(created.executionRequirements).toEqual([
      { requirementType: 'PHOTO', requirementLevel: 'REQUIRED', config: null, sortOrder: 0 },
      { requirementType: 'OBSERVATION', requirementLevel: 'OPTIONAL', config: null, sortOrder: 1 },
    ]);
  });

  it('accepts conditional execution requirements with typed supported conditions', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId, 'EXEC_REQ_CONDITIONAL'),
      measurementMode: 'BY_EVENT',
      measurementBasis: 'TRIP',
      allowedUnits: [{ unitCode: 'TRIP', isDefault: true, sortOrder: 0 }],
      pricingModels: [{ modelCode: 'PER_TRIP' }],
      executionRequirements: [
        {
          requirementType: 'MILEAGE',
          requirementLevel: 'CONDITIONAL',
            config: {
              schemaVersion: 1,
              conditional: {
                conditionType: 'WHEN_MEASUREMENT_BASIS_IS' as const,
                measurementBasis: 'TRIP',
              },
            },
        },
      ],
    });

    expect(created.executionRequirements[0]?.requirementLevel).toBe('CONDITIONAL');
    expect(created.executionRequirements[0]?.config?.conditional?.conditionType).toBe(
      'WHEN_MEASUREMENT_BASIS_IS',
    );
  });

  it('rejects unknown conditional types and forbidden executable config payloads', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await expect(
      catalogAccess.create(actor, {
        ...createPayload(categoryId, 'EXEC_REQ_UNKNOWN_CONDITION'),
        executionRequirements: [
          {
            requirementType: 'LOCATION',
            requirementLevel: 'CONDITIONAL',
            config: {
              schemaVersion: 1,
              conditional: { conditionType: 'RUN_JAVASCRIPT' as never },
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.UNKNOWN_CONDITION_TYPE });

    await expect(
      catalogAccess.create(actor, {
        ...createPayload(categoryId, 'EXEC_REQ_FORBIDDEN_CONFIG'),
        executionRequirements: [
          {
            requirementType: 'DOCUMENT',
            requirementLevel: 'OPTIONAL',
            config: { schemaVersion: 1, expression: 'eval(1)' } as never,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.FORBIDDEN_EXECUTION_REQUIREMENT_CONFIG });
  });

  it('preserves execution requirements on published versions and copies them to new drafts', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId, 'EXEC_REQ_VERSIONING'),
      executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    await catalogAccess.publishVersion(actor, created.serviceDefinitionId, 1, definition.version);

    const historical = await catalogAccess.getVersion(actor, created.serviceDefinitionId, 1);
    expect(historical.executionRequirements.some((item) => item.requirementType === 'PHOTO')).toBe(true);

    const version2 = await catalogAccess.createVersion(actor, created.serviceDefinitionId, {
      ...versionCreateBase(categoryId),
      executionRequirements: [],
      sourceVersion: 1,
    });
    expect(version2.executionRequirements[0]?.requirementType).toBe('PHOTO');
  });

  it('rejects mutating execution requirements on a published version', async () => {
    const { identityId, categoryId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await catalogAccess.create(actor, {
      ...createPayload(categoryId, 'EXEC_REQ_PUBLISHED_IMMUTABLE'),
      executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, created.serviceDefinitionId);
    await catalogAccess.publishVersion(actor, created.serviceDefinitionId, 1, definition.version);

    await expect(
      catalogAccess.updateDraft(actor, created.serviceDefinitionId, 1, {
        ...draftUpdateBase(categoryId, definition.version + 1),
        executionRequirements: [{ requirementType: 'SIGNATURE', requirementLevel: 'REQUIRED' }],
      }),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.INVALID_STATE });
  });

  it('denies catalog mutation without authorization grants', async () => {
    const admin = await seedActor();
    const employeeLogin = normalizeLoginIdentifier(`catalog-exec-employee-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: employeeId } = await insertIdentity(pool, employeeLogin, passwordHash);

    const created = await catalogAccess.create(
      { identityId: admin.identityId, sessionId: 'sid' },
      {
        ...createPayload(admin.categoryId, 'EXEC_REQ_SECURITY'),
        executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
      },
    );

    await expect(
      catalogAccess.getVersion(
        { identityId: employeeId, sessionId: 'sid' },
        created.serviceDefinitionId,
        1,
      ),
    ).rejects.toMatchObject({ code: CATALOG_ERROR_CODES.DENIED });
  });
});

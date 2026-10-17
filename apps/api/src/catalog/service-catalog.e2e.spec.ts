import {
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertCatalogCategory,
  insertGrant,
  insertIdentity,
  truncateCatalogTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApiTestApp } from '../infrastructure/http/configure-api-test-app';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { applyAuthTestEnv, AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { parseAuthTokenResponse } from '../auth/test/auth-response-test-types';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { CATALOG_ERROR_CODES } from './errors/catalog-error-codes';

function parseCatalogError(body: string): { error: { code: string } } {
  return JSON.parse(body) as { error: { code: string } };
}

describe('Service catalog E2E', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for service catalog E2E tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: 8_192 }),
    );
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  async function loginWithCatalogGrants(): Promise<{
    accessToken: string;
    identityId: string;
    categoryId: string;
  }> {
    const loginId = normalizeLoginIdentifier(`catalog-e2e-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, loginId, passwordHash);
    const { categoryId } = await insertCatalogCategory(pool, { actorIdentityId: identityId });

    for (const action of [
      AUTHZ_ACTIONS.CatalogServiceCreate,
      AUTHZ_ACTIONS.CatalogServiceRead,
      AUTHZ_ACTIONS.CatalogServiceList,
      AUTHZ_ACTIONS.CatalogServiceUpdate,
      AUTHZ_ACTIONS.CatalogServicePublish,
      AUTHZ_ACTIONS.CatalogServiceDeactivate,
      AUTHZ_ACTIONS.CatalogServiceActivate,
    ]) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.CatalogService,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: loginId, password: AUTH_TEST_PASSWORD },
      headers: { 'user-agent': 'vitest-catalog-e2e' },
    });
    const body = parseAuthTokenResponse(response.body);
    return { accessToken: body.accessToken, identityId, categoryId };
  }

  it('denies anonymous access and supports catalog lifecycle via HTTP', async () => {
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/catalog/service-definitions',
    });
    expect(anonymous.statusCode).toBe(401);

    const { accessToken, categoryId } = await loginWithCatalogGrants();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/service-definitions',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        code: 'LOCACAO_CAMINHAO_PIPA',
        name: 'Locação Caminhão Pipa',
        categoryId,
        archetype: 'RENTAL',
        measurementMode: 'BY_PERIOD',
        measurementBasis: 'TIME',
        defaultUnitCode: 'DAY',
        allowedUnits: [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }],
        pricingModels: [
          {
            modelCode: 'DAILY',
            unitCode: 'DAY',
            salePrice: '1200.00',
            internalCost: '900.00',
            currencyCode: 'BRL',
            sortOrder: 0,
          },
        ],
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.body) as {
      serviceDefinitionId: string;
      version: number;
      status: string;
    };
    expect(created.status).toBe('DRAFT');

    const reloadResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/catalog/service-definitions/${created.serviceDefinitionId}/versions/${created.version}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(reloadResponse.statusCode).toBe(200);
    const reloaded = JSON.parse(reloadResponse.body) as {
      defaultUnitCode: string | null;
      allowedUnits: Array<{ unitCode: string; isDefault: boolean; sortOrder: number }>;
      pricingModels: Array<{
        modelCode: string;
        unitCode: string | null;
        salePrice: string | null;
        internalCost: string | null;
        sortOrder: number;
      }>;
    };
    expect(reloaded.defaultUnitCode).toBe('DAY');
    expect(reloaded.allowedUnits).toEqual([
      expect.objectContaining({ unitCode: 'DAY', isDefault: true, sortOrder: 0 }),
    ]);
    expect(reloaded.pricingModels[0]).toMatchObject({
      modelCode: 'DAILY',
      unitCode: 'DAY',
      salePrice: '1200',
      internalCost: '900',
      sortOrder: 0,
    });

    const definitionResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/catalog/service-definitions/${created.serviceDefinitionId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(definitionResponse.statusCode).toBe(200);
    const definition = JSON.parse(definitionResponse.body) as { version: number };

    const publishResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/catalog/service-definitions/${created.serviceDefinitionId}/versions/1/publish`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { lineageVersion: definition.version },
    });
    expect(publishResponse.statusCode).toBe(200);
    const published = JSON.parse(publishResponse.body) as { status: string };
    expect(published.status).toBe('PUBLISHED');

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/catalog/service-definitions?limit=10&offset=0',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResponse.statusCode).toBe(200);
    const listBody = JSON.parse(listResponse.body) as { items: unknown[] };
    expect(listBody.items.length).toBeGreaterThan(0);
  });

  it('returns not found for unknown service definition', async () => {
    const { accessToken } = await loginWithCatalogGrants();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/catalog/service-definitions/${crypto.randomUUID()}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(404);
    const body = parseCatalogError(response.body);
    expect(body.error.code).toBe(CATALOG_ERROR_CODES.NOT_FOUND);
  });
});

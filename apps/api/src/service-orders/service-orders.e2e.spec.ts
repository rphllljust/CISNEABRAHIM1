import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateCatalogTables,
  truncateClientTables,
  truncateCommercialProposalTables,
  truncateCommercialPurchaseOrderTables,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
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
import { SERVICE_ORDER_ORIGINS, SERVICE_ORDER_STATUSES } from './domain/service-order';

const UNIT_A = 'unit-so-e2e';
const UNIT_B = 'unit-so-e2e-b';

describe('Service orders E2E', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let accessToken: string;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for service orders E2E tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);
    process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-e2e';
    process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
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

    const login = normalizeLoginIdentifier(`so-e2e-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    for (const action of [
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
    ]) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login, password: AUTH_TEST_PASSWORD },
    });
    accessToken = parseAuthTokenResponse(loginResponse.body).accessToken;
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('lists only units authorized for service-order creation and accepts that unit on POST', async () => {
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
    await pool.query(
      `INSERT INTO "authorization".operational_unit_directory (ref_id, code, business_name)
       VALUES ($1, 'PVH', 'Porto Velho'), ($2, 'GUA', 'Guajará-Mirim')`,
      [UNIT_A, UNIT_B],
    );

    const login = normalizeLoginIdentifier(`so-unit-scope-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await insertGrant(pool, {
      identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: UNIT_A,
      grantedByIdentityId: identityId,
    });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login, password: AUTH_TEST_PASSWORD },
    });
    const unitScopedToken = parseAuthTokenResponse(loginResponse.body).accessToken;

    const unitsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/service-orders/operational-units',
      headers: { authorization: `Bearer ${unitScopedToken}` },
    });
    expect(unitsResponse.statusCode).toBe(200);
    expect(JSON.parse(unitsResponse.body)).toEqual({ items: [UNIT_A] });
    const optionsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/service-orders/operational-unit-options',
      headers: { authorization: `Bearer ${unitScopedToken}` },
    });
    expect(optionsResponse.statusCode).toBe(200);
    expect(JSON.parse(optionsResponse.body)).toEqual({
      items: [UNIT_A],
      details: [{ id: UNIT_A, code: 'PVH', name: 'Porto Velho', configured: true }],
    });
    // A missing directory record must not produce a fictitious business name.
    await pool.query('DELETE FROM "authorization".operational_unit_directory WHERE ref_id = $1', [UNIT_A]);
    const unconfiguredResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/service-orders/operational-unit-options',
      headers: { authorization: `Bearer ${unitScopedToken}` },
    });
    expect(JSON.parse(unconfiguredResponse.body).details).toEqual([
      { id: UNIT_A, code: null, name: null, configured: false },
    ]);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/service-orders',
      headers: { authorization: `Bearer ${unitScopedToken}` },
      payload: {
        origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
        unitId: UNIT_A,
        description: 'OS com escopo de unidade',
      },
    });
    expect(createResponse.statusCode).toBe(201);

    const deniedOtherUnit = await app.inject({
      method: 'POST',
      url: '/api/v1/service-orders',
      headers: { authorization: `Bearer ${unitScopedToken}` },
      payload: {
        origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
        unitId: UNIT_B,
      },
    });
    expect(deniedOtherUnit.statusCode).toBe(403);
  });

  it('creates and reads a DRAFT service order via HTTP', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/service-orders',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
        unitId: UNIT_A,
        description: 'OS E2E',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.body) as {
      id: string;
      status: string;
      orderNumber: string;
      historyEvents: Array<{ eventType: string }>;
    };
    expect(created.status).toBe(SERVICE_ORDER_STATUSES.Draft);
    expect(created.orderNumber).toMatch(/^OS-/);
    expect(created.historyEvents.some((event) => event.eventType === 'CREATED')).toBe(true);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/service-orders/${created.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(getResponse.statusCode).toBe(200);
    const detail = JSON.parse(getResponse.body) as { id: string };
    expect(detail.id).toBe(created.id);
  });

  it('lists service orders via HTTP with filters and denies unauthorized list', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/service-orders',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
        unitId: UNIT_A,
        description: 'Listagem E2E',
      },
    });
    const created = JSON.parse(createResponse.body) as { id: string; orderNumber: string };

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/service-orders?limit=10&offset=0&status=${SERVICE_ORDER_STATUSES.Draft}&q=${encodeURIComponent(created.orderNumber)}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResponse.statusCode).toBe(200);
    const listed = JSON.parse(listResponse.body) as {
      items: Array<{ id: string; orderNumber: string }>;
      limit: number;
      offset: number;
    };
    expect(listed.items.some((item) => item.id === created.id)).toBe(true);
    expect(listed.limit).toBe(10);
    expect(listed.offset).toBe(0);

    const invalidResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/service-orders?filter=unknown',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(invalidResponse.statusCode).toBe(400);

    const login = normalizeLoginIdentifier(`so-list-http-deny-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await insertGrant(pool, {
      identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
    const deniedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login, password: AUTH_TEST_PASSWORD },
    });
    const deniedToken = parseAuthTokenResponse(deniedLogin.body).accessToken;

    const deniedResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/service-orders?limit=1&offset=0',
      headers: { authorization: `Bearer ${deniedToken}` },
    });
    expect(deniedResponse.statusCode).toBe(403);
  });
});

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
  let authTestClient: string;
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
    // Auth rate limiting is deliberately active. Isolate independent E2E
    // actors by a unique test user-agent rather than disabling throttle.
    authTestClient = `cisne-so-e2e-${crypto.randomUUID()}`;
    // Master identity has its own lifecycle. Clear owned history before identity fixtures.
    await pool.query('TRUNCATE pty.operational_unit_history, pty.operational_unit_commands, pty.operational_units');
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
      headers: { 'user-agent': authTestClient },
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
    // The organizational master is independent from access scope refs.
    // Test cleanup cannot remove existing unit identities by revoking grants.
    await pool.query('DELETE FROM pty.operational_units WHERE id = ANY($1::text[])', [[UNIT_A, UNIT_B]]);
    await pool.query(
      `INSERT INTO pty.operational_units (id, code, business_name)
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
      headers: { 'user-agent': authTestClient },
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
    const operationsDenied = await app.inject({
      method: 'GET',
      url: '/api/v1/query/operations/units',
      headers: { authorization: `Bearer ${unitScopedToken}` },
    });
    expect(operationsDenied.statusCode).toBe(403);

    // A missing directory record must not produce a fictitious business name.
    await pool.query('DELETE FROM pty.operational_units WHERE id = $1', [UNIT_A]);
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

  it('keeps master writes idempotent, detects stale versions and publishes units with no OS', async () => {
    const login = normalizeLoginIdentifier(`unit-admin-${crypto.randomUUID()}@cisne.invalid`);
    const hash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, hash);
    for (const action of [AUTHZ_ACTIONS.OperationalUnitRead, AUTHZ_ACTIONS.OperationalUnitManage]) {
      await insertGrant(pool, {
        identityId, action,
        resourceType: AUTHZ_RESOURCE_TYPES.OperationalUnit,
        scopeType: AUTHZ_SCOPES.Global, grantedByIdentityId: identityId,
      });
    }
    const auth = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      headers: { 'user-agent': authTestClient },
      payload: { login, password: AUTH_TEST_PASSWORD },
    });
    const headers = { authorization: `Bearer ${parseAuthTokenResponse(auth.body).accessToken}` };
    const payload = { code: 'PVH-TEST', name: 'Porto Velho Operacional', idempotencyKey: 'create-pvh-001' };
    const created = await app.inject({
      method: 'POST', url: '/api/v1/organization/operational-units', headers, payload,
    });
    expect(created.statusCode).toBe(201);
    const original = JSON.parse(created.body) as { id: string; version: number; code: string };
    expect(original).toMatchObject({ code: 'PVH-TEST', version: 1 });
    const replay = await app.inject({
      method: 'POST', url: '/api/v1/organization/operational-units', headers, payload,
    });
    expect(JSON.parse(replay.body)).toEqual(original);
    const keyReused = await app.inject({
      method: 'POST', url: '/api/v1/organization/operational-units', headers,
      payload: { ...payload, name: 'Alteração não autorizada com mesma chave' },
    });
    expect(keyReused.statusCode).toBe(409);
    const duplicate = await app.inject({
      method: 'POST', url: '/api/v1/organization/operational-units', headers,
      payload: { ...payload, idempotencyKey: 'create-pvh-002' },
    });
    expect(duplicate.statusCode).toBe(409);

    const change = {
      name: 'Porto Velho Central', expectedVersion: 1, idempotencyKey: 'update-pvh-001',
    };
    const updated = await app.inject({
      method: 'PATCH', url: `/api/v1/organization/operational-units/${original.id}`,
      headers, payload: change,
    });
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.body)).toMatchObject({ id: original.id, version: 2, name: 'Porto Velho Central' });
    const replayUpdate = await app.inject({
      method: 'PATCH', url: `/api/v1/organization/operational-units/${original.id}`,
      headers, payload: change,
    });
    expect(JSON.parse(replayUpdate.body)).toEqual(JSON.parse(updated.body));
    const stale = await app.inject({
      method: 'PATCH', url: `/api/v1/organization/operational-units/${original.id}`,
      headers, payload: { ...change, idempotencyKey: 'update-pvh-002' },
    });
    expect(stale.statusCode).toBe(409);
    const events = await pool.query<{ event_kind: string }>(
      'SELECT event_kind FROM pty.operational_unit_history WHERE unit_id = $1 ORDER BY version', [original.id],
    );
    expect(events.rows.map(row => row.event_kind)).toEqual(['CREATED', 'UPDATED']);
    const readLogin = normalizeLoginIdentifier(`unit-read-${crypto.randomUUID()}@cisne.invalid`);
    const { identityId: readerId } = await insertIdentity(pool, readLogin, hash);
    await insertGrant(pool, {
      identityId: readerId, action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit, resourceId: original.id,
      grantedByIdentityId: readerId,
    });
    const authReader = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      headers: { 'user-agent': authTestClient },
      payload: { login: readLogin, password: AUTH_TEST_PASSWORD },
    });
    const readHeaders = { authorization: `Bearer ${parseAuthTokenResponse(authReader.body).accessToken}` };
    const units = await app.inject({
      method: 'GET', url: '/api/v1/query/operations/units', headers: readHeaders,
    });
    expect(units.statusCode).toBe(200);
    expect(JSON.parse(units.body).details).toEqual([
      { id: original.id, code: 'PVH-TEST', name: 'Porto Velho Central', configured: true },
    ]);
    const emptyBoard = await app.inject({
      method: 'GET', url: `/api/v1/query/operations/dispatch?unitId=${original.id}`, headers: readHeaders,
    });
    expect(emptyBoard.statusCode).toBe(200);
    expect(JSON.parse(emptyBoard.body).items).toEqual([]);
    const forbiddenCreate = await app.inject({
      method: 'POST', url: '/api/v1/service-orders', headers: readHeaders,
      payload: { origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect, unitId: original.id },
    });
    expect(forbiddenCreate.statusCode).toBe(403);
    const forbiddenAdmin = await app.inject({
      method: 'PATCH', url: `/api/v1/organization/operational-units/${original.id}`,
      headers: readHeaders,
      payload: { name: 'Sem permissão', expectedVersion: 2, idempotencyKey: 'update-pvh-003' },
    });
    expect(forbiddenAdmin.statusCode).toBe(403);

    // Two different commands against one version: exactly one may commit.
    const contenders = await Promise.all([
      app.inject({
        method: 'PATCH', url: `/api/v1/organization/operational-units/${original.id}`,
        headers, payload: {
          name: 'Concorrente A', expectedVersion: 2, idempotencyKey: 'update-pvh-race-a',
        },
      }),
      app.inject({
        method: 'PATCH', url: `/api/v1/organization/operational-units/${original.id}`,
        headers, payload: {
          name: 'Concorrente B', expectedVersion: 2, idempotencyKey: 'update-pvh-race-b',
        },
      }),
    ]);
    expect(contenders.map(result => result.statusCode).sort()).toEqual([200, 409]);
    const persisted = await pool.query<{ version: number }>(
      'SELECT version FROM pty.operational_units WHERE id = $1', [original.id],
    );
    expect(persisted.rows[0]?.version).toBe(3);
    // Revoking the technical scope anchor must not cascade into business identity.
    await pool.query(
      `DELETE FROM "authorization".scope_refs WHERE scope_type = 'UNIT' AND ref_id = $1`,
      [original.id],
    );
    const preserved = await pool.query<{ id: string; code: string }>(
      'SELECT id, code FROM pty.operational_units WHERE id = $1', [original.id],
    );
    expect(preserved.rows).toEqual([{ id: original.id, code: 'PVH-TEST' }]);

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
      headers: { 'user-agent': authTestClient },
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

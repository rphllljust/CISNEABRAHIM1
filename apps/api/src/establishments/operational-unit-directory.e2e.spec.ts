import {
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { applyAuthTestEnv, AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { parseAuthTokenResponse } from '../auth/test/auth-response-test-types';
import { configureApiTestApp } from '../infrastructure/http/configure-api-test-app';
import { AUTHZ_ACTIONS, type AuthzAction } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES, type AuthzResourceType } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES, type AuthzScopeType } from '../authorization/types/authz-scopes';

const TEST_DB = process.env['TEST_DATABASE_URL'];
const api = '/api/v1/organization/operational-units';

type Grant = {
  action: AuthzAction;
  resourceType: AuthzResourceType;
  scopeType: AuthzScopeType;
  resourceId?: string;
};

describe('Operational UNIT master — real business and authorization E2E', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  beforeAll(async () => {
    if (!TEST_DB) throw new Error('TEST_DATABASE_URL is required.');
    applyAuthTestEnv(TEST_DB);
    process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-e2e';
    process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: TEST_DB });
  });

  beforeEach(async () => {
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  async function login(grants: Grant[]) {
    const address = normalizeLoginIdentifier(`unit-operator-${crypto.randomUUID()}@cisne.invalid`);
    const { identityId } = await insertIdentity(
      pool,
      address,
      await hashPassword(AUTH_TEST_PASSWORD),
    );
    for (const grant of grants) {
      await insertGrant(pool, {
        identityId,
        action: grant.action,
        resourceType: grant.resourceType,
        scopeType: grant.scopeType,
        ...(grant.resourceId ? { resourceId: grant.resourceId } : {}),
        grantedByIdentityId: identityId,
      });
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: address, password: AUTH_TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return { identityId, authorization: `Bearer ${parseAuthTokenResponse(response.body).accessToken}` };
  }

  function masterGrant(action: AuthzAction): Grant {
    return { action, resourceType: AUTHZ_RESOURCE_TYPES.OperationalUnit, scopeType: AUTHZ_SCOPES.Global };
  }

  it('requires distinct manage/read capabilities and does not confer OS create or dispatch', async () => {
    const operator = await login([masterGrant(AUTHZ_ACTIONS.OperationalUnitRead)]);
    const denied = await app.inject({
      method: 'POST',
      url: api,
      headers: { authorization: operator.authorization },
      payload: { code: 'E2E-NO-MANAGE', name: 'Forbidden name', idempotencyKey: 'not-manage-01' },
    });
    expect(denied.statusCode).toBe(403);
    const created = await pool.query("SELECT id FROM pty.operational_units WHERE code = 'E2E-NO-MANAGE'");
    expect(created.rowCount).toBe(0);
  });

  it('binds a legacy UNIT reference without reassigning IDs; unit without OS is discoverable', async () => {
    const refId = `E2E-${crypto.randomUUID().slice(0, 8)}`;
    await insertScopeRef(pool, { scopeType: 'UNIT', refId });
    const administrator = await login([
      masterGrant(AUTHZ_ACTIONS.OperationalUnitManage),
      masterGrant(AUTHZ_ACTIONS.OperationalUnitRead),
    ]);
    const code = `E2E-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const create = await app.inject({
      method: 'POST',
      url: api,
      headers: { authorization: administrator.authorization },
      payload: { refId, code, name: 'Unidade Operacional Real', idempotencyKey: 'bind-legacy-ref-01' },
    });
    expect(create.statusCode).toBe(201);
    const unit = JSON.parse(create.body) as { id: string; code: string; version: number };
    expect(unit).toMatchObject({ id: refId, code, version: 1 });

    const reader = await login([{
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: refId,
    }]);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/query/operations/units',
      headers: { authorization: reader.authorization },
    });
    expect(list.statusCode).toBe(200);
    expect((JSON.parse(list.body) as { details: unknown[] }).details).toContainEqual({
      id: refId, code, name: 'Unidade Operacional Real', configured: true,
    });
    const noCreate = await app.inject({
      method: 'GET',
      url: '/api/v1/service-orders/operational-unit-options',
      headers: { authorization: reader.authorization },
    });
    expect(noCreate.statusCode).toBe(403);
    const dispatch = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM so.service_orders WHERE unit_id = $1', [refId]);
    expect(dispatch.rows[0].total).toBe(0);

    // An authorization-reference deletion MUST NOT delete the business master.
    await pool.query('DELETE FROM "authorization".scope_refs WHERE scope_type = $1 AND ref_id = $2', ['UNIT', refId]);
    const stillMaster = await pool.query('SELECT code, business_name FROM pty.operational_units WHERE id = $1', [refId]);
    expect(stillMaster.rows[0]).toMatchObject({ code, business_name: 'Unidade Operacional Real' });
  });

  it('serializes retries, rejects reused keys, checks version and code uniqueness', async () => {
    const administrator = await login([masterGrant(AUTHZ_ACTIONS.OperationalUnitManage)]);
    const code = `E2E-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const createBody = { code, name: 'Unidade Original', idempotencyKey: 'idempotent-create-01' };
    const sendCreate = (payload: unknown) => app.inject({
      method: 'POST', url: api, headers: { authorization: administrator.authorization }, payload,
    });
    const first = await sendCreate(createBody);
    expect(first.statusCode).toBe(201);
    const original = JSON.parse(first.body) as { id: string; version: number; name: string };
    expect(original.version).toBe(1);
    const same = await sendCreate(createBody);
    expect(same.statusCode).toBe(201);
    expect(JSON.parse(same.body)).toEqual(original);

    const changed = await sendCreate({ ...createBody, name: 'Another name' });
    expect(changed.statusCode).toBe(409);
    const duplicateCode = await sendCreate({ ...createBody, idempotencyKey: 'another-create-01' });
    expect(duplicateCode.statusCode).toBe(409);

    const updateBody = { name: 'Unidade Atualizada', expectedVersion: 1, idempotencyKey: 'version-update-01' };
    const sendUpdate = (payload: unknown) => app.inject({
      method: 'PATCH', url: `${api}/${original.id}`,
      headers: { authorization: administrator.authorization }, payload,
    });
    const updated = await sendUpdate(updateBody);
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.body)).toMatchObject({ version: 2, name: 'Unidade Atualizada' });
    const replay = await sendUpdate(updateBody);
    expect(replay.statusCode).toBe(200);
    expect(JSON.parse(replay.body)).toEqual(JSON.parse(updated.body));
    const stale = await sendUpdate({ name: 'Stale', expectedVersion: 1, idempotencyKey: 'stale-update-01' });
    expect(stale.statusCode).toBe(409);
    const history = await pool.query('SELECT version, event_kind FROM pty.operational_unit_history WHERE unit_id = $1 ORDER BY version', [original.id]);
    expect(history.rows).toEqual([{ version: 1, event_kind: 'CREATED' }, { version: 2, event_kind: 'UPDATED' }]);
  });

  it('competing updates cannot overwrite each other on the same version', async () => {
    const administrator = await login([masterGrant(AUTHZ_ACTIONS.OperationalUnitManage)]);
    const code = `E2E-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await app.inject({
      method: 'POST', url: api, headers: { authorization: administrator.authorization },
      payload: { code, name: 'Original', idempotencyKey: 'concurrent-create-01' },
    });
    expect(created.statusCode).toBe(201);
    const unit = JSON.parse(created.body) as { id: string };
    const versions = await Promise.all([
      app.inject({ method: 'PATCH', url: `${api}/${unit.id}`, headers: { authorization: administrator.authorization },
        payload: { name: 'Primeira', expectedVersion: 1, idempotencyKey: 'concurrent-edit-01' } }),
      app.inject({ method: 'PATCH', url: `${api}/${unit.id}`, headers: { authorization: administrator.authorization },
        payload: { name: 'Segunda', expectedVersion: 1, idempotencyKey: 'concurrent-edit-02' } }),
    ]);
    expect(versions.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const rows = await pool.query<{ version: number }>('SELECT version FROM pty.operational_units WHERE id = $1', [unit.id]);
    expect(rows.rows[0].version).toBe(2);
    const events = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM pty.operational_unit_history WHERE unit_id = $1', [unit.id]);
    expect(events.rows[0].total).toBe(2);
  });
});

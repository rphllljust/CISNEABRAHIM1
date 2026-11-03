import {
  hashPassword,
  insertGrant,
  insertIdentity,
  ensureOperationalLaborTypesBaseline,
  truncateIdentityAndAuthorizationTables,
  truncateWorkforceTables,
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
import { PERSON_ERROR_CODES } from './errors/person-error-codes';

function parsePersonError(body: string): { error: { code: string } } {
  return JSON.parse(body) as { error: { code: string } };
}

describe('People E2E', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
  const previousPeopleFlag = process.env['FEATURE_MODULE_PEOPLE'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for people E2E tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);
    process.env['FEATURE_MODULE_PEOPLE'] = 'true';

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
    await truncateWorkforceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureOperationalLaborTypesBaseline(pool);
  });

  afterAll(async () => {
    if (previousPeopleFlag === undefined) {
      delete process.env['FEATURE_MODULE_PEOPLE'];
    } else {
      process.env['FEATURE_MODULE_PEOPLE'] = previousPeopleFlag;
    }
    await pool.end();
    await app.close();
  });

  async function loginWithPeopleGrants(): Promise<{ accessToken: string; identityId: string }> {
    const loginId = normalizeLoginIdentifier(`people-e2e-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, loginId, passwordHash);

    for (const action of [
      AUTHZ_ACTIONS.PeoplePersonCreate,
      AUTHZ_ACTIONS.PeoplePersonRead,
      AUTHZ_ACTIONS.PeoplePersonList,
      AUTHZ_ACTIONS.PeoplePersonUpdate,
      AUTHZ_ACTIONS.PeoplePersonDeactivate,
      AUTHZ_ACTIONS.PeoplePersonActivate,
    ]) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.PeoplePerson,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: loginId, password: AUTH_TEST_PASSWORD },
      headers: { 'user-agent': 'vitest-people-e2e' },
    });
    const body = parseAuthTokenResponse(response.body);
    return { accessToken: body.accessToken, identityId };
  }

  it('denies anonymous access and supports full person lifecycle via HTTP', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/people' });
    expect(anonymous.statusCode).toBe(401);

    const { accessToken } = await loginWithPeopleGrants();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/people',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        legalName: 'Pessoa E2E Sintetica',
        defaultLaborTypeCode: 'OPERATOR',
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.body) as { id: string; version: number; memberCode: string };
    expect(created.memberCode).toMatch(/^PSN-/);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/people?limit=10&offset=0',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResponse.statusCode).toBe(200);

    const deactivateResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/people/${created.id}/deactivate`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { version: created.version, reason: 'Inativacao E2E' },
    });
    expect(deactivateResponse.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/people',
    });
    expect(denied.statusCode).toBe(401);
  });

  it('denies the Person -> OS allocation view without OS read grants, then permits an authorized empty view', async () => {
    const { accessToken, identityId } = await loginWithPeopleGrants();
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/people',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { legalName: 'Vinculo Seguro', defaultLaborTypeCode: 'OPERATOR' },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = JSON.parse(createdResponse.body) as { id: string };
    const url = `/api/v1/people/${created.id}/allocations?limit=10&offset=0`;

    const denied = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(denied.statusCode).toBe(403);

    for (const action of [
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead,
    ]) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }

    const allowed = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(JSON.parse(allowed.body)).toEqual({
      items: [],
      limit: 10,
      offset: 0,
      hasMore: false,
      partial: false,
    });
  });

  it('returns validation error for empty legal name', async () => {
    const { accessToken } = await loginWithPeopleGrants();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/people',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { legalName: '   ' },
    });
    expect(response.statusCode).toBe(400);
    expect(parsePersonError(response.body).error.code).toBe(PERSON_ERROR_CODES.VALIDATION_FAILED);
  });
});

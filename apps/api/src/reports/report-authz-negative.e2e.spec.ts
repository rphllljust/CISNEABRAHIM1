import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
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

describe('REPORT AUTHZ HTTP NEGATIVE', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
  const REPORT = '/api/v1/reports';

  /**
   * Este suite testa o CONTRATO DE AUTORIZACAO dos relatorios (401 sem token, 403 sem
   * grant, 400 de filtro antes do SQL, 200/escopo para quem tem grant). O gate de
   * release roda antes de qualquer controller: com FEATURE_MODULE_REPORTS ausente, o
   * ReleaseScopeGuard global responde 403 FEATURE_DISABLED em toda rota /reports e
   * nenhuma dessas assercoes fica observavel — foi exatamente a falha do CI (403 em
   * lugar de 401/200/400). O gate em si continua coberto por release-scope.guard.spec.ts
   * e release-scope.http.spec.ts; aqui a flag e habilitada para o modulo sob teste, como
   * .env ja faz, no mesmo idioma de sod-hardening.e2e.spec.ts.
   */
  const REPORTS_FEATURE_FLAG = 'FEATURE_MODULE_REPORTS';
  const previousFlags: Record<string, string | undefined> = {};

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    previousFlags[REPORTS_FEATURE_FLAG] = process.env[REPORTS_FEATURE_FLAG];
    process.env[REPORTS_FEATURE_FLAG] = 'true';
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
    await truncateServiceOrderTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    const previous = previousFlags[REPORTS_FEATURE_FLAG];
    if (previous === undefined) {
      delete process.env[REPORTS_FEATURE_FLAG];
    } else {
      process.env[REPORTS_FEATURE_FLAG] = previous;
    }
    await pool?.end();
    await app.close();
  });

  async function createUser(grants: Array<[string, string, string | undefined]>): Promise<string> {
    const login = normalizeLoginIdentifier(`report-neg-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    for (const [action, resourceType, unitId] of grants) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType,
        scopeType: unitId ? AUTHZ_SCOPES.Unit : AUTHZ_SCOPES.Global,
        resourceId: unitId ?? undefined,
        grantedByIdentityId: identityId,
      });
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login, password: AUTH_TEST_PASSWORD },
      headers: { 'user-agent': 'vitest-report-neg' },
    });
    const body = parseAuthTokenResponse(response.body);
    return body.accessToken;
  }

  const SO = AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;

  it('anônimo -> 401 no catálogo e no preview', async () => {
    const catalog = await app.inject({ method: 'GET', url: `${REPORT}/catalog` });
    expect(catalog.statusCode).toBe(401);
    const preview = await app.inject({
      method: 'GET',
      url: `${REPORT}/exports/preview?reportType=SERVICE_ORDERS_BY_PERIOD`,
    });
    expect(preview.statusCode).toBe(401);
  });

  it('usuário sem grant -> 403 no preview/export (fail closed)', async () => {
    const token = await createUser([]);
    const auth = { authorization: `Bearer ${token}`, 'user-agent': 'x' };
    const preview = await app.inject({
      method: 'GET',
      url: `${REPORT}/exports/preview?reportType=SERVICE_ORDERS_BY_PERIOD`,
      headers: auth,
    });
    expect(preview.statusCode).toBe(403);
    const create = await app.inject({
      method: 'POST',
      url: `${REPORT}/exports?reportType=SERVICE_ORDERS_BY_PERIOD`,
      headers: auth,
    });
    expect(create.statusCode).toBe(403);
  });

  it('grant errado por tipo (mismatch) -> 403: billing-only não vê Measurements', async () => {
    const token = await createUser([[AUTHZ_ACTIONS.BillingBillingRecordRead, SO, undefined]]);
    const auth = { authorization: `Bearer ${token}`, 'user-agent': 'x' };
    const measurements = await app.inject({
      method: 'GET',
      url: `${REPORT}/exports/preview?reportType=MEASUREMENTS`,
      headers: auth,
    });
    expect(measurements.statusCode).toBe(403);
    const aging = await app.inject({
      method: 'GET',
      url: `${REPORT}/exports/preview?reportType=FINANCIAL_AGING`,
      headers: auth,
    });
    expect(aging.statusCode).toBe(200); // FinancialAging exige billing read (contrato)
  });

  it('measurement-only não vê relatório de OS (fim do requiredAction genérico)', async () => {
    const token = await createUser([[AUTHZ_ACTIONS.MeasurementsMeasurementRead, SO, undefined]]);
    const auth = { authorization: `Bearer ${token}`, 'user-agent': 'x' };
    const os = await app.inject({
      method: 'GET',
      url: `${REPORT}/exports/preview?reportType=SERVICE_ORDERS_BY_PERIOD`,
      headers: auth,
    });
    expect(os.statusCode).toBe(403);
  });

  it('filtro inválido -> 400 antes do SQL (allowlist, from/to, injection)', async () => {
    const token = await createUser([[AUTHZ_ACTIONS.ServiceOrdersServiceOrderList, SO, undefined]]);
    const auth = { authorization: `Bearer ${token}`, 'user-agent': 'x' };

    const agingFilter = await app.inject({
      method: 'GET',
      url: `${REPORT}/exports/preview?reportType=FINANCIAL_AGING&unitId=unit-a`,
      headers: auth,
    });
    expect(agingFilter.statusCode).toBe(400);

    const missingPair = await app.inject({
      method: 'GET',
      url: `${REPORT}/exports/preview?reportType=SERVICE_ORDERS_BY_PERIOD&from=2026-09-01`,
      headers: auth,
    });
    expect(missingPair.statusCode).toBe(400);

    const injection = await app.inject({
      method: 'GET',
      url: `${REPORT}/exports/preview?reportType=SERVICE_ORDERS_BY_PERIOD&from=${encodeURIComponent("2026-01-01') OR 1=1 --")}&to=2026-02-01`,
      headers: auth,
    });
    expect(injection.statusCode).toBe(400);

    const valid = await app.inject({
      method: 'GET',
      url: `${REPORT}/exports/preview?reportType=SERVICE_ORDERS_BY_PERIOD&from=2026-09-01&to=2026-09-30`,
      headers: auth,
    });
    expect(valid.statusCode).toBe(200);
  });

  it('escopo errado não vaza dados de outra unidade', async () => {
    const seedActor = await insertIdentity(
      pool,
      normalizeLoginIdentifier(`report-seed-${crypto.randomUUID()}@cisne.invalid`),
      await hashPassword(AUTH_TEST_PASSWORD),
    );
    await pool.query(
      `INSERT INTO so.service_orders (
         internal_code, order_number, unit_id, status, origin, service_snapshot,
         client_snapshot, row_version, created_by_identity_id, updated_by_identity_id
       ) VALUES ('SO-NEG-B-1', 'NEG-B', 'unit-neg-b', 'PREPARED', 'AUTHORIZED_DIRECT',
                 '{}'::jsonb, '{}'::jsonb, 1, $1, $1)`,
      [seedActor.identityId],
    );
    const scopedToken = await createUser([
      [AUTHZ_ACTIONS.ServiceOrdersServiceOrderList, SO, 'unit-neg-a'],
    ]);
    const auth = { authorization: `Bearer ${scopedToken}`, 'user-agent': 'x' };
    const preview = await app.inject({
      method: 'GET',
      url: `${REPORT}/exports/preview?reportType=SERVICE_ORDERS_BY_PERIOD`,
      headers: auth,
    });
    expect(preview.statusCode).toBe(200);
    const body = JSON.parse(preview.body) as { total: number };
    expect(body.total).toBe(0); // OS de unit-neg-b fora do escopo do ator
  });
});

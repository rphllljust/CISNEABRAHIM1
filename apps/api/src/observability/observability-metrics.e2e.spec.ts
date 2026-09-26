import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { applyAuthTestEnv, AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { parseAuthTokenResponse } from '../auth/test/auth-response-test-types';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { configureApiTestApp } from '../infrastructure/http/configure-api-test-app';
import {
  PlatformMetricsCollectionError,
  PlatformMetricsCollectorService,
} from './services/platform-metrics-collector.service';
import type { ObservabilityMetricsResponse } from './services/observability-metrics.service';

/**
 * Contrato HTTP de `GET /observability/metrics` (diagnostico de plataforma).
 *
 * Duas invariantes provadas na cadeia real (AppModule + filtros globais + PostgreSQL real):
 *   1) autorizacao: 401 sem autenticacao e 403 sem `platform:diagnostics:read` (fail closed);
 *   2) falha de coleta NUNCA vira 200 com contadores zerados. Um `0` fabricado desarmaria os
 *      alertas tecnicos (OUTBOX_BACKLOG, ERP_FAILURES, TRACKING_FAILURES, NOTIFICATION_FAILURES,
 *      WORKER_STALLED), que decidem justamente a partir destes contadores.
 */
describe('Observability metrics E2E', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for observability metrics E2E tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: 8_192 }),
    );
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  beforeEach(async () => {
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loginWithGrants(
    grants?: Array<{ action: string; resourceType: string }>,
  ): Promise<string> {
    const loginId = normalizeLoginIdentifier(`metrics-e2e-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, loginId, passwordHash);
    for (const grant of grants ?? []) {
      await insertGrant(pool, {
        identityId,
        action: grant.action,
        resourceType: grant.resourceType,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: loginId, password: AUTH_TEST_PASSWORD },
      headers: { 'user-agent': 'vitest-metrics-e2e' },
    });
    return parseAuthTokenResponse(response.body).accessToken;
  }

  it('exige autenticacao (401) e nega sem platform diagnostics (403)', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/observability/metrics' });
    expect(anonymous.statusCode).toBe(401);

    const plainToken = await loginWithGrants();
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers: { authorization: `Bearer ${plainToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('responde 200 com contadores reais medidos no PostgreSQL', async () => {
    const token = await loginWithGrants([
      { action: AUTHZ_ACTIONS.PlatformDiagnosticsRead, resourceType: AUTHZ_RESOURCE_TYPES.Platform },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as ObservabilityMetricsResponse;
    expect(body.collectedAt).toBeTruthy();

    // As 7 consultas de backlog rodaram contra o schema real (drift de enum/coluna quebraria aqui).
    const backlog = body.technical.backlog;
    for (const value of Object.values(backlog)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(body.technical.db.pool.configured).toBe(true);
  });

  it('falha de coleta responde 500 e NUNCA publica contadores zerados fabricados', async () => {
    const token = await loginWithGrants([
      { action: AUTHZ_ACTIONS.PlatformDiagnosticsRead, resourceType: AUTHZ_RESOURCE_TYPES.Platform },
    ]);
    const platform = app.get(PlatformMetricsCollectorService);
    vi.spyOn(platform, 'collectBacklogs').mockRejectedValue(
      new PlatformMetricsCollectionError(
        'outboxPending',
        'invalid input value for enum outbox_event_status',
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { error?: { correlationId?: string } };
    expect(body.error?.correlationId).toBeTruthy();
    // Nenhum contador de backlog (nem zero fabricado) pode aparecer no corpo de falha.
    expect(response.body).not.toContain('workerPending');
    expect(response.body).not.toContain('outboxPending');
    expect(response.body).not.toContain('integrationFailures');
  });

  it('recupera: coleta volta a responder 200 depois da falha (sem estado de falha pegajoso)', async () => {
    const token = await loginWithGrants([
      { action: AUTHZ_ACTIONS.PlatformDiagnosticsRead, resourceType: AUTHZ_RESOURCE_TYPES.Platform },
    ]);
    const headers = { authorization: `Bearer ${token}` };
    const platform = app.get(PlatformMetricsCollectorService);

    const failing = vi
      .spyOn(platform, 'collectBacklogs')
      .mockRejectedValue(new PlatformMetricsCollectionError('outboxPending', 'transient failure'));
    const failureResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers,
    });
    expect(failureResponse.statusCode).toBe(500);

    failing.mockRestore();
    const recovered = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers,
    });
    expect(recovered.statusCode).toBe(200);
  });
});

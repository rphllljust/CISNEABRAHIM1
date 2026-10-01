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
import { PrometheusMetricsService } from './metrics/prometheus-metrics.service';

/**
 * Contrato de integracao da observabilidade complementar de B3.
 *
 * Complementa — nao substitui — `observability-metrics.e2e.spec.ts`. O que B3
 * acrescentou foi: exposition format do Prometheus, contador `business_errors_total`
 * e a redaction de identificadores fiscais. Os invariantes provados aqui sao:
 *
 *   1) `/health/live` responde 200 SEM tocar o banco (liveness puro);
 *   2) `/health/ready` responde 200 quando o PostgreSQL esta acessivel;
 *   3) `/observability/prometheus` responde 200 em formato Prometheus valido
 *      (`# HELP`, `# TYPE` e ao menos uma amostra);
 *   4) a requisicao HTTP real alimenta `http_requests_total` com a rota
 *      NORMALIZADA — nunca com o id concreto na label;
 *   5) o erro de dominio incrementa `business_errors_total` com o MESMO codigo
 *      que sai no envelope de resposta;
 *   6) `/observability/prometheus` exige autenticacao (401) e autorizacao (403).
 *
 * O caso 6 e deliberado: o endpoint NAO e anonimo. Ver a justificativa no
 * `ObservabilityController.getPrometheusMetrics`.
 */
describe('Observability B3 integration', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let prometheus: PrometheusMetricsService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for observability B3 integration tests.');
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
    prometheus = app.get(PrometheusMetricsService);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  beforeEach(async () => {
    await truncateIdentityAndAuthorizationTables(pool);
    prometheus.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loginWithGrants(
    grants?: Array<{ action: string; resourceType: string }>,
  ): Promise<string> {
    const loginId = normalizeLoginIdentifier(`b3-obs-${crypto.randomUUID()}@cisne.invalid`);
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
      headers: { 'user-agent': 'vitest-b3-observability' },
    });
    return parseAuthTokenResponse(response.body).accessToken;
  }

  async function loginWithDiagnostics(): Promise<string> {
    return loginWithGrants([
      {
        action: AUTHZ_ACTIONS.PlatformDiagnosticsRead,
        resourceType: AUTHZ_RESOURCE_TYPES.Platform,
      },
    ]);
  }

  it('Caso 1: GET /health/live responde 200 com corpo minimo, sem tocar o banco', async () => {    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; service: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('api');
    expect(body.timestamp).toBeTruthy();
    // Liveness nao pode consultar dependencia externa: nenhum campo de banco.
    expect(response.body).not.toContain('database');
  });

  it('Caso 2: GET /health/ready responde 200 quando o PostgreSQL responde', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      status: string;
      checks: { database: { status: string } };
    };
    expect(body.status).toBe('ready');
    expect(body.checks.database.status).toBe('up');
  });

  it('Caso 3: GET /observability/prometheus responde 200 em formato Prometheus valido', async () => {
    const token = await loginWithDiagnostics();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/prometheus',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('# HELP');
    expect(response.body).toContain('# TYPE');
    expect(response.body).toContain('http_requests_total');
    expect(response.body).toContain('http_request_duration_seconds');
    expect(response.body).toContain('business_errors_total');

    // Contrato de exposicao: cada metrica declarada tem HELP e TYPE.
    for (const name of ['http_requests_total', 'http_request_duration_seconds', 'business_errors_total']) {
      expect(response.body).toContain(`# HELP ${name}`);
      expect(response.body).toContain(`# TYPE ${name}`);
    }
  });

  it('Caso 4: requisicao HTTP real gera log estruturado com correlation-id e metrica por rota normalizada', async () => {
    const token = await loginWithDiagnostics();
    const correlationId = `b3-corr-${crypto.randomUUID()}`;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers: { authorization: `Bearer ${token}`, 'x-correlation-id': correlationId },
    });

    // O log e escrito no teardown do interceptor; o spy ja capturou as linhas.
    expect(response.statusCode).toBe(200);

    const lines = logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('http_request_completed'));

    expect(lines.length).toBeGreaterThan(0);
    const entry = JSON.parse(lines[0]!) as {
      level: string;
      correlationId?: string;
      operation?: string;
      metadata?: { statusCode?: number };
    };
    expect(entry.correlationId).toBe(correlationId);
    expect(entry.operation).toContain('/api/v1/observability/metrics');
    expect(typeof entry.metadata?.statusCode).toBe('number');

    logSpy.mockRestore();

    // A metrica Prometheus usa a rota NORMALIZADA, sem o correlation-id na label.
    const rendered = await prometheus.render();
    expect(rendered).toContain('http_requests_total');
    expect(rendered).toContain('/api/v1/observability/metrics');
    expect(rendered).not.toContain(correlationId);
  });

  it('Caso 5: erro de dominio incrementa business_errors_total com o codigo do envelope', async () => {
    const token = await loginWithDiagnostics();

    // Rota inexistente sob o prefixo autenticado: produz erro de dominio
    // normalizado pelo ApiExceptionFilter, que e quem incrementa o contador.
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/rota-inexistente-b3',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(response.body) as { error: { code: string } };
    const envelopeCode = body.error.code;

    const rendered = await prometheus.render();

    // O codigo contado e o MESMO do envelope — nao um codigo interno do filtro.
    expect(readCounter(rendered, 'business_errors_total', envelopeCode)).toBeGreaterThanOrEqual(1);
    expect(rendered).toContain('# TYPE business_errors_total counter');
    expect(rendered).toContain(`error_code="${envelopeCode}"`);

    // O stack nunca vaza para a resposta HTTP, apenas para o log.
    expect(response.body).not.toMatch(/stack|node_modules/i);
  });

  it('Caso 6: /observability/prometheus exige autenticacao (401) e autorizacao (403)', async () => {
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/prometheus',
    });
    expect(anonymous.statusCode).toBe(401);

    // Autenticado, mas SEM o grant de diagnostico de plataforma.
    const plainToken = await loginWithGrants();
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/prometheus',
      headers: { authorization: `Bearer ${plainToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });
});

/**
 * Le amostra de um counter Prometheus por `error_code`. Retorna -1 quando a
 * serie ainda nao existe, que e o estado legitimo antes do primeiro erro.
 */
function readCounter(rendered: string, metric: string, labelValue: string): number {
  const line = rendered
    .split('\n')
    .find((candidate) => candidate.startsWith(metric) && candidate.includes(`"${labelValue}"`));
  if (!line) {
    return -1;
  }
  const value = Number(line.slice(line.lastIndexOf(' ') + 1));
  return Number.isFinite(value) ? value : -1;
}

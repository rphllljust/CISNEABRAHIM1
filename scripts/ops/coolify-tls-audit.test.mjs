import test from 'node:test';
import assert from 'node:assert/strict';
import { auditProductionTls, parsePublicUrls } from './coolify-tls-audit.mjs';

const SHA = 'a'.repeat(40);
const uuids = { api: 'api', worker: 'worker', web: 'web' };

function response(status, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
  };
}

function clientFixture({
  apiDomain = 'http://api.example.test',
  webDomain = 'http://app.example.test',
  tag = SHA,
  redirectFlag = false,
  redaction = false,
  cors = 'https://app.example.test',
  publicApi = 'https://api.example.test',
} = {}) {
  const apps = {
    api: {
      fqdn: apiDomain,
      docker_registry_image_tag: tag,
      status: 'running:healthy',
      is_permanent_redirect_enabled: redirectFlag,
      redact_all_env_values_in_logs: redaction,
    },
    worker: {
      docker_registry_image_tag: tag,
      status: 'running:healthy',
      redact_all_env_values_in_logs: redaction,
    },
    web: {
      fqdn: webDomain,
      docker_registry_image_tag: tag,
      status: 'running:healthy',
      is_permanent_redirect_enabled: redirectFlag,
      redact_all_env_values_in_logs: redaction,
    },
  };
  return {
    getApplication: async (uuid) => apps[uuid],
    listEnvironment: async (uuid) => {
      if (uuid === 'api') return [{ key: 'CORS_ORIGIN', real_value: cors, is_preview: false }];
      if (uuid === 'web') return [{ key: 'CISNE_PUBLIC_API_URL', real_value: publicApi, is_preview: false }];
      return [];
    },
  };
}

test('parsePublicUrls recusa dominio ausente', () => {
  assert.throws(() => parsePublicUrls({}, 'web'), /dominio publico ausente/);
});

test('auditoria identifica cutover pendente quando Coolify ainda anuncia HTTP', async () => {
  const client = clientFixture();
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.startsWith('https://')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } });
    return response(200);
  };

  const result = await auditProductionTls({ client, fetchImpl, expectedSha: SHA, uuids });
  assert.equal(result.httpsConfigured.api, false);
  assert.equal(result.httpsConfigured.web, false);
  assert.equal(result.certificateValid.api, false);
  assert.equal(result.readyForHttpsOnly, false);
});

test('auditoria aprova HTTPS, redirect permanente 301/308, HSTS e env coerente', async () => {
  const client = clientFixture({
    apiDomain: 'https://api.example.test',
    webDomain: 'https://app.example.test',
    redirectFlag: true,
    redaction: true,
  });
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.startsWith('http://api.')) {
      return response(308, { location: 'https://api.example.test/api/v1/health/ready' });
    }
    if (value.startsWith('http://app.')) {
      return response(301, { location: 'https://app.example.test/health' });
    }
    return response(200, { 'strict-transport-security': 'max-age=31536000; includeSubDomains' });
  };

  const result = await auditProductionTls({ client, fetchImpl, expectedSha: SHA, uuids });
  assert.equal(result.certificateValid.api, true);
  assert.equal(result.certificateValid.web, true);
  assert.equal(result.httpRedirects.api, true);
  assert.equal(result.httpRedirects.web, true);
  // O gate exige PERMANENTE. Aceitar 302/307 aqui foi a regressao do PR #95.
  assert.equal(result.permanentRedirects.api, true);
  assert.equal(result.permanentRedirects.web, true);
  assert.equal(result.env.corsOrigin.matchesHttpsWeb, true);
  assert.equal(result.env.publicApiUrl.matchesHttpsApi, true);
  assert.equal(result.readyForHttpsOnly, true);
});

test('auditoria recusa runtime que nao corresponde ao SHA esperado', async () => {
  const client = clientFixture({ tag: 'b'.repeat(40) });
  await assert.rejects(
    () => auditProductionTls({ client, fetchImpl: async () => response(200), expectedSha: SHA, uuids }),
    /runtime tag divergiu de main/,
  );
});


test('redaction desligada nao bloqueia TLS, mas e reportada como pendencia admin', async () => {
  const client = clientFixture({
    apiDomain: 'https://api.example.test',
    webDomain: 'https://app.example.test',
    redirectFlag: true,
    redaction: false,
  });
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.startsWith('http://api.')) return response(308, { location: 'https://api.example.test/api/v1/health/ready' });
    if (value.startsWith('http://app.')) return response(301, { location: 'https://app.example.test/health' });
    return response(200, { 'strict-transport-security': 'max-age=31536000' });
  };
  const result = await auditProductionTls({ client, fetchImpl, expectedSha: SHA, uuids });
  assert.equal(result.certificateValid.api, true);
  // O campo exige team admin no Coolify: nao pode ser escrito pelo token do CI
  // (422 medido no run 39971906142). Bloquear o gate o tornaria impossivel.
  assert.equal(result.readyForHttpsOnly, true);
  // Mas a divida NAO fica escondida: e reportada explicitamente.
  assert.equal(result.coolify.apiEnvLogRedaction, false);
  assert.deepEqual(result.pendingUpgradeActions, [
    'habilitar redact_all_env_values_in_logs no Coolify (campo ausente em 4.4.7; requer upgrade + team admin)',
  ]);
});

test('redirect temporario 302/307 satisfaz o gate do Coolify 4.4.7', async () => {
  const client = clientFixture({
    apiDomain: 'https://api.example.test',
    webDomain: 'https://app.example.test',
    redirectFlag: true,
    redaction: true,
  });
  // 302/307 e o MAXIMO que o Coolify 4.4.7 entrega: `is_permanent_redirect_enabled`
  // devolve 422 (run 39978741652). Exigir 301/308 aqui tornaria o gate
  // impossivel de passar sem upgrade — nao prova seguranca, so bloqueia o pipeline.
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.startsWith('http://api.')) return response(302, { location: 'https://api.example.test/api/v1/health/ready' });
    if (value.startsWith('http://app.')) return response(307, { location: 'https://app.example.test/health' });
    return response(200, { 'strict-transport-security': 'max-age=31536000' });
  };
  const result = await auditProductionTls({ client, fetchImpl, expectedSha: SHA, uuids });
  // O redirect EXISTE e aponta para HTTPS — e isso que protege o usuario.
  assert.equal(result.httpRedirects.api, true);
  assert.equal(result.httpRedirects.web, true);
  assert.equal(result.readyForHttpsOnly, true);
  // A divida do 301/308 nao fica escondida: vira pendencia de upgrade explicita.
  assert.ok(
    result.pendingUpgradeActions.some((action) => /is_permanent_redirect_enabled/.test(action)),
  );
});

test('ausencia de redirect HTTP->HTTPS reprova o gate', async () => {
  const client = clientFixture({
    apiDomain: 'https://api.example.test',
    webDomain: 'https://app.example.test',
    redirectFlag: true,
    redaction: true,
  });
  // Sem redirect, HTTP continua servindo conteudo — isso SIM e falha de seguranca.
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.startsWith('http://api.')) return response(200);
    if (value.startsWith('http://app.')) return response(200);
    return response(200, { 'strict-transport-security': 'max-age=31536000' });
  };
  const result = await auditProductionTls({ client, fetchImpl, expectedSha: SHA, uuids });
  assert.equal(result.httpRedirects.api, false);
  assert.equal(result.httpRedirects.web, false);
  assert.equal(result.readyForHttpsOnly, false);
});

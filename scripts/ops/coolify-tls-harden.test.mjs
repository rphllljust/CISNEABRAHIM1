import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildTlsCutoverPlan, hardenProductionTls } from './coolify-tls-harden.mjs';

const SHA = 'a'.repeat(40);
const uuids = { api: 'api', worker: 'worker', web: 'web' };

function app(kind, overrides = {}) {
  return {
    docker_registry_image_tag: SHA,
    docker_registry_image_name: `ghcr.io/example/cisne-${kind}`,
    status: kind === 'web' ? 'running:unhealthy' : 'running:unknown',
    fqdn: kind === 'api' ? 'http://api.example.test' : kind === 'web' ? 'http://app.example.test' : '',
    is_force_https_enabled: false,
    is_permanent_redirect_enabled: false,
    redact_all_env_values_in_logs: false,
    ...overrides,
  };
}

let envSequence = 0;
function env(key, value) {
  envSequence += 1;
  return [{
    uuid: `env-${envSequence}`,
    key,
    real_value: value,
    is_preview: false,
    is_literal: true,
  }];
}

test('plano promove dominios e envs HTTP para HTTPS no mesmo SHA', () => {
  const plan = buildTlsCutoverPlan({
    api: app('api'),
    worker: app('worker'),
    web: app('web'),
    apiEnvs: env('CORS_ORIGIN', 'http://app.example.test'),
    webEnvs: env('CISNE_PUBLIC_API_URL', 'http://api.example.test'),
    expectedSha: SHA,
  });
  assert.equal(plan.desired.apiDomains, 'https://api.example.test');
  assert.equal(plan.desired.webDomains, 'https://app.example.test');
  assert.equal(plan.desired.corsOrigin, 'https://app.example.test');
  assert.equal(plan.desired.publicApiUrl, 'https://api.example.test');
  assert.equal(plan.runtimeRestartRequired, true);
});

test('plano seguro e idempotente nao exige restart', () => {
  const plan = buildTlsCutoverPlan({
    api: app('api', {
      fqdn: 'https://api.example.test',
      is_force_https_enabled: true,
      is_permanent_redirect_enabled: true,
      redact_all_env_values_in_logs: true,
    }),
    worker: app('worker', { redact_all_env_values_in_logs: true }),
    web: app('web', {
      fqdn: 'https://app.example.test',
      is_force_https_enabled: true,
      is_permanent_redirect_enabled: true,
      redact_all_env_values_in_logs: true,
    }),
    apiEnvs: env('CORS_ORIGIN', 'https://app.example.test'),
    webEnvs: env('CISNE_PUBLIC_API_URL', 'https://api.example.test'),
    expectedSha: SHA,
  });
  assert.equal(plan.runtimeRestartRequired, false);
  assert.equal(Object.values(plan.changed).some(Boolean), false);
});

test('plano recusa runtime em SHA diferente', () => {
  assert.throws(
    () =>
      buildTlsCutoverPlan({
        api: app('api', { docker_registry_image_tag: 'b'.repeat(40) }),
        worker: app('worker'),
        web: app('web'),
        apiEnvs: env('CORS_ORIGIN', 'http://app.example.test'),
        webEnvs: env('CISNE_PUBLIC_API_URL', 'http://api.example.test'),
        expectedSha: SHA,
      }),
    /runtime tag divergiu/,
  );
});

function mutableClient() {
  const apps = {
    api: app('api'),
    worker: app('worker'),
    web: app('web'),
  };
  const envs = {
    api: env('CORS_ORIGIN', 'http://app.example.test'),
    web: env('CISNE_PUBLIC_API_URL', 'http://api.example.test'),
  };
  const deployments = [];
  return {
    apps,
    envs,
    deployments,
    async getApplication(uuid) { return apps[uuid]; },
    async listEnvironment(uuid) { return envs[uuid] ?? []; },
    calls: [],
    async call(path, { method, body } = {}) {
      this.calls.push({ path, method, body });
      const appMatch = /^\/applications\/([^/]+)$/.exec(path);
      if (appMatch) {
        assert.equal(method, 'PATCH');
        const target = apps[appMatch[1]];
        if (body.domains !== undefined) target.fqdn = body.domains;
        Object.assign(target, {
          ...(body.is_force_https_enabled !== undefined ? { is_force_https_enabled: body.is_force_https_enabled } : {}),
          ...(body.is_permanent_redirect_enabled !== undefined ? { is_permanent_redirect_enabled: body.is_permanent_redirect_enabled } : {}),
          ...(body.redact_all_env_values_in_logs !== undefined ? { redact_all_env_values_in_logs: body.redact_all_env_values_in_logs } : {}),
        });
        return { uuid: appMatch[1] };
      }
      const deleteMatch = /^\/applications\/([^/]+)\/envs\/([^/]+)$/.exec(path);
      if (deleteMatch) {
        assert.equal(method, 'DELETE');
        const appUuid = deleteMatch[1];
        const envUuid = deleteMatch[2];
        envs[appUuid] = (envs[appUuid] ?? []).filter((entry) => entry.uuid !== envUuid);
        return { message: 'Environment variable deleted.' };
      }
      const envMatch = /^\/applications\/([^/]+)\/envs$/.exec(path);
      if (envMatch) {
        assert.equal(method, 'POST');
        envSequence += 1;
        envs[envMatch[1]] = [{
          uuid: `env-${envSequence}`,
          ...body,
          real_value: body.value,
        }];
        return { uuid: `env-${envSequence}` };
      }
      throw new Error(`unexpected path ${path}`);
    },
    async deploy(uuid) {
      const id = `deploy-${uuid}-${deployments.length}`;
      deployments.push(id);
      return { deployment_uuid: id };
    },
  };
}

test('hardening aplica HTTPS somente com campos suportados, redeploya e executa smoke', async () => {
  const client = mutableClient();
  let smokeCalls = 0;
  const result = await hardenProductionTls({
    client,
    expectedSha: SHA,
    uuids,
    login: 'smoke',
    password: 'secret',
    sleep: async () => {},
    waitFn: async () => ({ status: 'finished' }),
    auditFn: async () => ({
      readyForHttpsOnly: true,
      certificateValid: { api: true, web: true },
      permanentRedirects: { api: true, web: true },
      hsts: { api: true, web: true },
      env: {},
      coolify: {},
    }),
    verifyFn: async () => {
      smokeCalls += 1;
      return { authenticatedSmoke: 'ok' };
    },
  });
  assert.equal(result.runtimeRestarted, true);
  assert.equal(client.apps.api.fqdn, 'https://api.example.test');
  assert.equal(client.apps.web.fqdn, 'https://app.example.test');
  assert.equal(client.envs.api[0].real_value, 'https://app.example.test');
  assert.equal(client.envs.web[0].real_value, 'https://api.example.test');
  assert.equal(smokeCalls, 1);
  assert.equal(client.deployments.length, 2);
  assert.equal(client.calls.some((entry) => entry.method === 'DELETE'), true);
  assert.equal(
    client.calls.some((entry) => entry.method === 'PATCH' && /\/envs$/.test(entry.path)),
    false,
  );
  const applicationPatches = client.calls.filter(
    (entry) => entry.method === 'PATCH' && /^\/applications\/[^/]+$/.test(entry.path),
  );
  for (const patch of applicationPatches) {
    // Regressao do run 39971906142: este campo exige team admin no Coolify e
    // reprova o payload inteiro com 422, inclusive o rollback.
    assert.equal('redact_all_env_values_in_logs' in patch.body, false);
    // Este campo E suportado e E requisito de TLS: deve ir no payload.
    assert.equal('is_permanent_redirect_enabled' in patch.body, true);
    assert.equal(patch.body.is_permanent_redirect_enabled, true);
  }
});

test('falha de TLS restaura domains/env usando somente campos suportados', async () => {
  const client = mutableClient();
  await assert.rejects(
    () =>
      hardenProductionTls({
        client,
        expectedSha: SHA,
        uuids,
        login: 'smoke',
        password: 'secret',
        certificateTimeoutMs: 0,
        sleep: async () => {},
        waitFn: async () => ({ status: 'finished' }),
        auditFn: async () => ({
          readyForHttpsOnly: false,
          httpsConfigured: { api: true, web: true },
          certificateValid: { api: false, web: false },
          permanentRedirects: { api: false, web: false },
          hsts: { api: false, web: false },
          env: {},
          coolify: {},
        }),
        verifyFn: async () => ({ authenticatedSmoke: 'ok' }),
      }),
    /configuracao de rota\/env foi restaurada/,
  );
  assert.equal(client.apps.api.fqdn, 'http://api.example.test');
  assert.equal(client.apps.web.fqdn, 'http://app.example.test');
  assert.equal(client.envs.api[0].real_value, 'http://app.example.test');
  assert.equal(client.envs.web[0].real_value, 'http://api.example.test');
  assert.equal(client.deployments.length, 4);
  // O rollback original morria em 422 por reenviar redaction.
  const rollbackPatches = client.calls.filter(
    (entry) => entry.method === 'PATCH' && /^\/applications\/[^/]+$/.test(entry.path),
  );
  assert.equal(
    rollbackPatches.some((entry) => 'redact_all_env_values_in_logs' in entry.body),
    false,
    'rollback nao pode reenviar redact_all_env_values_in_logs',
  );
});

test('nginx Web aplica HSTS e snippet nos locations que definem add_header', async () => {
  const snippet = await readFile(resolve('docker/release/security-headers.inc'), 'utf8');
  const nginx = await readFile(resolve('docker/release/nginx.conf'), 'utf8');
  assert.match(snippet, /Strict-Transport-Security/);
  assert.match(snippet, /X-Content-Type-Options/);
  const includes = nginx.match(/include \/etc\/nginx\/snippets\/security-headers\.inc;/g) ?? [];
  assert.equal(includes.length, 5);
});


test('falha depois de DELETE de env ainda executa rollback', async () => {
  const client = mutableClient();
  const originalCall = client.call.bind(client);
  let failNextEnvPost = true;
  client.call = async (path, options = {}) => {
    if (failNextEnvPost && options.method === 'POST' && /\/envs$/.test(path)) {
      failNextEnvPost = false;
      throw new Error('simulated env create failure');
    }
    return originalCall(path, options);
  };

  await assert.rejects(
    () =>
      hardenProductionTls({
        client,
        expectedSha: SHA,
        uuids,
        login: 'smoke',
        password: 'secret',
        sleep: async () => {},
        waitFn: async () => ({ status: 'finished' }),
        auditFn: async () => ({ readyForHttpsOnly: true }),
        verifyFn: async () => ({ authenticatedSmoke: 'ok' }),
      }),
    /configuracao de rota\/env foi restaurada/,
  );

  assert.equal(client.envs.api[0].real_value, 'http://app.example.test');
  assert.equal(client.envs.web[0].real_value, 'http://api.example.test');
});

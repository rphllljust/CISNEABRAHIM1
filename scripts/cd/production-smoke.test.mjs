import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRuntimeApplication,
  resolveApplicationUrl,
  runProductionSmoke,
} from './production-smoke.mjs';

const SHA = '1'.repeat(40);

test('resolve URL prioriza HTTPS e aceita lista de FQDNs do Coolify', () => {
  assert.equal(
    resolveApplicationUrl({ fqdn: 'http://api.local,https://api.example.com' }, 'api'),
    'https://api.example.com',
  );
});

test('runtime exige running, rejeita unhealthy e SHA divergente', () => {
  assert.doesNotThrow(() =>
    assertRuntimeApplication(
      { status: 'running:healthy', docker_registry_image_tag: SHA },
      'api',
      SHA,
    ),
  );
  assert.throws(() =>
    assertRuntimeApplication(
      { status: 'running:unhealthy', docker_registry_image_tag: SHA },
      'api',
      SHA,
    ),
  );
  assert.throws(() =>
    assertRuntimeApplication(
      { status: 'running', docker_registry_image_tag: '2'.repeat(40) },
      'api',
      SHA,
    ),
  );
});

test('smoke prova runtime, health, banco, web e autenticacao sem vazar senha', async () => {
  const apps = { api: 'api', worker: 'worker', web: 'web' };
  const client = {
    getApplication: async (uuid) => ({
      status: uuid === 'worker' ? 'running' : 'running:healthy',
      docker_registry_image_tag: SHA,
      fqdn: uuid === 'api' ? 'https://api.example.test' : uuid === 'web' ? 'https://web.example.test' : null,
    }),
  };
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, init });
    const path = new URL(url).pathname;
    const payload =
      path.endsWith('/health/live')
        ? { status: 'ok' }
        : path.endsWith('/health/ready')
          ? { status: 'ready', checks: { database: { status: 'up', latencyMs: 1 } } }
          : path.endsWith('/auth/login')
            ? { accessToken: 'token-'.padEnd(40, 'x') }
            : path.endsWith('/auth/session')
              ? { session: { id: 's' } }
              : path.endsWith('/me')
                ? { permissions: [] }
                : null;
    const text =
      path === '/health'
        ? 'ok\n'
        : path === '/login'
          ? '<!doctype html><html><div id="root"></div></html>'
          : JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      text: async () => text,
    };
  };

  const result = await runProductionSmoke({
    client,
    apps,
    expectedSha: SHA,
    login: 'smoke@example.test',
    password: 'secret-value',
    fetchImpl,
  });

  assert.equal(result.database, 'up');
  assert.ok(seen.some(({ url }) => url.endsWith('/api/v1/auth/session')));
  assert.ok(seen.some(({ url }) => url.endsWith('/api/v1/me')));
  assert.ok(JSON.stringify(result).includes('secret-value') === false);
});

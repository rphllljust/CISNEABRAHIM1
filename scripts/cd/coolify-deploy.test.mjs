import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeployPlan,
  createCoolifyClient,
  DeployRefusedError,
  runDeployPlan,
  waitForDeployment,
} from './coolify-deploy.mjs';

const sha = '1'.repeat(40);
const apiImage = `ghcr.io/rphllljust/cisne-api@sha256:${'3'.repeat(64)}`;
const webImage = `ghcr.io/rphllljust/cisne-web@sha256:${'4'.repeat(64)}`;

const apps = { api: 'uuid-api', worker: 'uuid-worker', web: 'uuid-web' };

function payload(overrides = {}) {
  return {
    sourceSha: sha,
    artifactDigest: `sha256:${'2'.repeat(64)}`,
    images: { api: apiImage, worker: apiImage, web: webImage },
    runtime: {
      api: { healthPath: '/api/v1/health/ready' },
      worker: {},
      web: { healthPath: '/health' },
    },
    ...overrides,
  };
}

test('builds a plan that pins worker to the API image', () => {
  const plan = buildDeployPlan(payload(), apps);
  assert.equal(plan.length, 3);
  const byKey = Object.fromEntries(plan.map((entry) => [entry.key, entry]));
  assert.equal(byKey.api.image, apiImage);
  assert.equal(byKey.worker.image, apiImage);
  assert.equal(byKey.web.image, webImage);
  assert.equal(byKey.api.healthPath, '/api/v1/health/ready');
  assert.equal(byKey.web.healthPath, '/health');
  // worker nao expoe health HTTP
  assert.equal(byKey.worker.healthPath, null);
  assert.equal(byKey.api.sourceSha, sha);
});

for (const [name, patch] of [
  ['worker using a different image', { images: { api: apiImage, worker: webImage, web: webImage } }],
  ['mutable api tag', { images: { api: 'ghcr.io/rphllljust/cisne-api:latest', worker: 'ghcr.io/rphllljust/cisne-api:latest', web: webImage } }],
  ['api without digest', { images: { api: 'ghcr.io/rphllljust/cisne-api', worker: 'ghcr.io/rphllljust/cisne-api', web: webImage } }],
  ['short source sha', { sourceSha: 'abc' }],
]) {
  test(`refuses ${name}`, () => {
    assert.throws(() => buildDeployPlan(payload(patch), apps), DeployRefusedError);
  });
}

test('refuses when an application uuid is missing', () => {
  assert.throws(() => buildDeployPlan(payload(), { api: 'x', worker: 'y' }), DeployRefusedError);
});

test('waitForDeployment returns on finished', async () => {
  const client = { deployment: async () => ({ status: 'finished' }) };
  const detail = await waitForDeployment(client, 'dep-1', { timeoutMs: 1000 });
  assert.equal(detail.status, 'finished');
});

test('waitForDeployment throws on failed', async () => {
  const client = { deployment: async () => ({ status: 'failed' }) };
  await assert.rejects(
    () => waitForDeployment(client, 'dep-1', { timeoutMs: 1000 }),
    DeployRefusedError,
  );
});

test('waitForDeployment times out instead of hanging', async () => {
  const client = { deployment: async () => ({ status: 'in_progress' }) };
  let calls = 0;
  await assert.rejects(
    () =>
      waitForDeployment(client, 'dep-1', {
        timeoutMs: 30,
        intervalMs: 0,
        sleep: async () => {
          calls += 1;
        },
      }),
    /nao terminou/,
  );
  assert.ok(calls > 0);
});

test('runDeployPlan pins, deploys and waits for every application in order', async () => {
  const events = [];
  const client = {
    pinImage: async (uuid, image) => {
      events.push(['pin', uuid, image]);
    },
    deploy: async (uuid) => {
      events.push(['deploy', uuid]);
      return { deployments: [{ deployment_uuid: `dep-${uuid}` }] };
    },
    deployment: async (uuid) => {
      events.push(['poll', uuid]);
      return { status: 'finished' };
    },
  };

  const plan = buildDeployPlan(payload(), apps);
  const results = await runDeployPlan(plan, client, { timeoutMs: 1000 });

  assert.deepEqual(
    results.map((entry) => entry.key),
    ['api', 'worker', 'web'],
  );
  assert.deepEqual(
    events.filter(([kind]) => kind === 'deploy').map(([, uuid]) => uuid),
    ['uuid-api', 'uuid-worker', 'uuid-web'],
  );
  // cada aplicacao foi fixada na sua imagem imutavel
  assert.deepEqual(
    events.filter(([kind]) => kind === 'pin').map(([, uuid, image]) => [uuid, image]),
    [
      ['uuid-api', apiImage],
      ['uuid-worker', apiImage],
      ['uuid-web', webImage],
    ],
  );
});

test('runDeployPlan refuses when Coolify returns no deployment uuid', async () => {
  const client = {
    pinImage: async () => undefined,
    deploy: async () => ({}),
    deployment: async () => ({ status: 'finished' }),
  };
  await assert.rejects(
    () => runDeployPlan(buildDeployPlan(payload(), apps), client, { timeoutMs: 1000 }),
    DeployRefusedError,
  );
});

test('client sends the digest as an immutable tag and never leaks the token on error', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/deploy?uuid=uuid-api')) {
      return {
        ok: false,
        status: 500,
        text: async () => 'boom',
      };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };

  const client = createCoolifyClient({
    baseUrl: 'http://coolify.test/api/v1',
    token: 'super-secret-token',
    fetchImpl,
  });

  await client.pinImage('uuid-api', apiImage);

  const patch = seen[0];
  assert.match(patch.url, /\/applications\/uuid-api$/);
  assert.equal(patch.init.method, 'PATCH');
  const sent = JSON.parse(patch.init.body);
  assert.equal(sent.docker_registry_image_name, 'rphllljust/cisne-api');
  assert.match(sent.docker_registry_image_tag, /^@sha256:[0-9a-f]{64}$/);
  assert.equal(patch.init.headers.Authorization, 'Bearer super-secret-token');

  await assert.rejects(async () => {
    try {
      await client.deploy('uuid-api');
    } catch (error) {
      // a mensagem de erro nao pode conter o token
      assert.ok(!error.message.includes('super-secret-token'));
      throw error;
    }
  }, DeployRefusedError);
});

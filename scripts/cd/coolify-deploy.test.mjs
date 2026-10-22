import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeployPlan,
  createCoolifyClient,
  createGhcrDigestResolver,
  DeployRefusedError,
  runDeployPlan,
  verifyPublishedDigest,
  waitForDeployment,
} from './coolify-deploy.mjs';

const SHA = '1'.repeat(40);
const OTHER_SHA = '2'.repeat(40);
const API_DIGEST = `sha256:${'3'.repeat(64)}`;
const WEB_DIGEST = `sha256:${'4'.repeat(64)}`;
const API_IMAGE = `ghcr.io/rphllljust/cisne-api@${API_DIGEST}`;
const WEB_IMAGE = `ghcr.io/rphllljust/cisne-web@${WEB_DIGEST}`;

const apps = { api: 'uuid-api', worker: 'uuid-worker', web: 'uuid-web' };

function payload(overrides = {}) {
  return {
    sourceSha: SHA,
    artifactDigest: `sha256:${'5'.repeat(64)}`,
    images: { api: API_IMAGE, worker: API_IMAGE, web: WEB_IMAGE },
    runtime: {
      api: { healthPath: '/api/v1/health/ready', command: ['node', 'apps/api/dist/main.js'] },
      worker: { command: ['node', 'apps/api/dist/worker/main.js'] },
      web: { healthPath: '/health' },
    },
    ...overrides,
  };
}

// 1 + 2 + 9: preserva ghcr.io/ e usa SOURCE_SHA como tag
test('1/2/9: preserva o registry completo e usa o source SHA como tag', () => {
  const plan = buildDeployPlan(payload(), apps);
  const byKey = Object.fromEntries(plan.map((e) => [e.key, e]));

  assert.equal(byKey.api.repository, 'ghcr.io/rphllljust/cisne-api');
  assert.equal(byKey.web.repository, 'ghcr.io/rphllljust/cisne-web');
  assert.ok(byKey.api.repository.startsWith('ghcr.io/'), 'registry precisa ser preservado');

  assert.equal(byKey.api.tag, SHA);
  assert.equal(byKey.web.tag, SHA);
  assert.equal(byKey.worker.tag, SHA);
});

// 5 + 6 + 7: digests
test('5/6/7: digests autorizados e worker herdando o da API', () => {
  const byKey = Object.fromEntries(buildDeployPlan(payload(), apps).map((e) => [e.key, e]));
  assert.equal(byKey.api.expectedDigest, API_DIGEST);
  assert.equal(byKey.web.expectedDigest, WEB_DIGEST);
  assert.equal(byKey.worker.expectedDigest, API_DIGEST);
  assert.equal(byKey.worker.repository, byKey.api.repository);
});

// 8: worker command obrigatorio
for (const [label, workerRuntime] of [
  ['ausente', {}],
  ['vazio', { command: [] }],
  ['nao-array', { command: 'node apps/api/dist/worker/main.js' }],
]) {
  test(`8: recusa worker command ${label}`, () => {
    assert.throws(
      () =>
        buildDeployPlan(
          payload({
            runtime: {
              api: { healthPath: '/api/v1/health/ready' },
              worker: workerRuntime,
              web: { healthPath: '/health' },
            },
          }),
          apps,
        ),
      DeployRefusedError,
    );
  });
}

// 3 + 4: latest e tag divergente
test('3: recusa latest como imagem', () => {
  assert.throws(
    () =>
      buildDeployPlan(
        payload({ images: { api: 'ghcr.io/rphllljust/cisne-api:latest', worker: 'ghcr.io/rphllljust/cisne-api:latest', web: WEB_IMAGE } }),
        apps,
      ),
    DeployRefusedError,
  );
});

test('4: recusa tag de deploy diferente do source SHA', () => {
  const client = createCoolifyClient({ baseUrl: 'http://x/api/v1', token: 't', fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }) });
  assert.throws(
    () => client.pinImage('uuid-api', { repository: 'ghcr.io/r/ci', tag: 'latest' }),
    DeployRefusedError,
  );
  assert.throws(
    () => client.pinImage('uuid-api', { repository: 'ghcr.io/r/ci', tag: OTHER_SHA.slice(0, 8) }),
    DeployRefusedError,
  );
});

test('worker com digest diferente da API e recusado', () => {
  assert.throws(
    () => buildDeployPlan(payload({ images: { api: API_IMAGE, worker: WEB_IMAGE, web: WEB_IMAGE } }), apps),
    DeployRefusedError,
  );
});

// provenance: tag -> digest precisa bater
test('provenance: reprova quando a tag resolve para outro digest', async () => {
  const plan = buildDeployPlan(payload(), apps);
  await assert.rejects(
    () => verifyPublishedDigest(plan, async () => `sha256:${'9'.repeat(64)}`),
    /resolve para/,
  );
});

test('provenance: reprova quando o manifest nao existe', async () => {
  const plan = buildDeployPlan(payload(), apps);
  await assert.rejects(() => verifyPublishedDigest(plan, async () => null), /manifest ausente/);
});

test('provenance: autoriza quando os digests conferem (worker herda API)', async () => {
  const plan = buildDeployPlan(payload(), apps);
  const resolved = [];
  await verifyPublishedDigest(plan, async (repo, tag) => {
    resolved.push(`${repo}:${tag}`);
    return repo.endsWith('cisne-api') ? API_DIGEST : WEB_DIGEST;
  });
  // a API e o worker compartilham repository:tag, entao resolve uma vez so
  assert.deepEqual(resolved, [
    `ghcr.io/rphllljust/cisne-api:${SHA}`,
    `ghcr.io/rphllljust/cisne-web:${SHA}`,
  ]);
});

// 10/11/12/13: estados terminais
test('10: finished = sucesso', async () => {
  const client = { deployment: async () => ({ status: 'finished' }) };
  const detail = await waitForDeployment(client, 'd', { timeoutMs: 1000 });
  assert.equal(detail.status, 'finished');
});

for (const status of ['failed', 'cancelled', 'error']) {
  test(`11/12: ${status} reprova`, async () => {
    const client = { deployment: async () => ({ status }) };
    await assert.rejects(() => waitForDeployment(client, 'd', { timeoutMs: 1000 }), DeployRefusedError);
  });
}

test('13: timeout reprova em vez de travar', async () => {
  const client = { deployment: async () => ({ status: 'in_progress' }) };
  let calls = 0;
  await assert.rejects(
    () =>
      waitForDeployment(client, 'd', {
        timeoutMs: 20,
        intervalMs: 0,
        sleep: async () => {
          calls += 1;
        },
      }),
    /nao terminou/,
  );
  assert.ok(calls > 0);
});

// orquestracao
test('orquestra api -> worker -> web e devolve deployment uuid + digest', async () => {
  const events = [];
  const client = {
    pinImage: async (uuid, { repository, tag }) => events.push(['pin', uuid, repository, tag]),
    setStartCommand: async (uuid, cmd) => events.push(['start', uuid, cmd]),
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

  assert.deepEqual(results.map((r) => r.key), ['api', 'worker', 'web']);
  assert.equal(results[0].digest, API_DIGEST);
  assert.equal(results[1].digest, API_DIGEST);
  assert.equal(results[2].digest, WEB_DIGEST);
  assert.deepEqual(
    events.filter(([k]) => k === 'deploy').map(([, u]) => u),
    ['uuid-api', 'uuid-worker', 'uuid-web'],
  );
});

test('runDeployPlan verifica provenance antes de pinar quando recebe o resolvedor', async () => {
  const order = [];
  const client = {
    pinImage: async () => order.push('pin'),
    setStartCommand: async () => order.push('start'),
    deploy: async () => {
      order.push('deploy');
      return { deployments: [{ deployment_uuid: 'dep' }] };
    },
    deployment: async () => ({ status: 'finished' }),
  };
  await runDeployPlan(buildDeployPlan(payload(), apps), client, {
    timeoutMs: 500,
    resolveManifestDigest: async (repo) => {
      order.push('manifest');
      return repo.endsWith('cisne-api') ? API_DIGEST : WEB_DIGEST;
    },
  });
  assert.equal(order[0], 'manifest');
  assert.ok(order.indexOf('manifest') < order.indexOf('pin'));
});

test('runDeployPlan recusa quando o Coolify nao devolve deployment_uuid', async () => {
  const client = {
    pinImage: async () => undefined,
    setStartCommand: async () => undefined,
    deploy: async () => ({}),
    deployment: async () => ({ status: 'finished' }),
  };
  await assert.rejects(
    () => runDeployPlan(buildDeployPlan(payload(), apps), client, { timeoutMs: 500 }),
    DeployRefusedError,
  );
});

// 14: token nunca aparece em erro
test('14: mensagem de erro nunca vaza o token', async () => {
  const SECRET = 'super-secret-token-do-not-leak';
  const client = createCoolifyClient({
    baseUrl: 'http://coolify.test/api/v1',
    token: SECRET,
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
  });
  await assert.rejects(
    async () => {
      try {
        await client.deploy('uuid-api');
      } catch (error) {
        assert.ok(!error.message.includes(SECRET), 'token vazou na mensagem');
        throw error;
      }
    },
    DeployRefusedError,
  );
});

// cliente envia o repository completo (nao remove o registry)
test('cliente envia repository completo e tag = sha', async () => {
  const seen = [];
  const client = createCoolifyClient({
    baseUrl: 'http://c/api/v1',
    token: 't',
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });
  await client.pinImage('uuid-api', { repository: 'ghcr.io/rphllljust/cisne-api', tag: SHA });
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.docker_registry_image_name, 'ghcr.io/rphllljust/cisne-api');
  assert.equal(body.docker_registry_image_tag, SHA);
  assert.doesNotMatch(body.docker_registry_image_tag, /@?sha256:/);
});

test('resolvedor GHCR usa o cabecalho do manifest', async () => {
  const resolver = createGhcrDigestResolver({
    fetchImpl: async (url) => {
      if (url.includes('/token')) {
        return { ok: true, json: async () => ({ token: 'ghcr-token' }) };
      }
      return {
        ok: true,
        headers: { get: () => API_DIGEST },
      };
    },
  });
  assert.equal(await resolver('ghcr.io/rphllljust/cisne-api', SHA), API_DIGEST);
});

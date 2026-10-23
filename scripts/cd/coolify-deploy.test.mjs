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

/**
 * Ambiente MINIMO valido no Coolify para o plano passar.
 *
 * Espelha o contrato real: a API precisa de `CORS_ORIGIN` (senao nao devolve
 * Access-Control-Allow-Origin e o browser bloqueia o login) e o Web precisa de
 * `CISNE_PUBLIC_API_URL` (senao o browser nao sabe para qual API chamar).
 */
const ENV_OK = {
  'uuid-api': [
    { key: 'CORS_ORIGIN', real_value: 'http://app.example.test' },
    { key: 'JWT_SECRET', real_value: 'x'.repeat(40) },
  ],
  'uuid-web': [
    { key: 'CISNE_PUBLIC_API_URL', real_value: 'http://api.example.test' },
  ],
};

function payload(overrides = {}) {
  return {
    sourceSha: SHA,
    artifactDigest: `sha256:${'5'.repeat(64)}`,
    images: { api: API_IMAGE, worker: API_IMAGE, web: WEB_IMAGE },
    runtime: {
      api: {
        healthPath: '/api/v1/health/ready',
        command: ['node', 'apps/api/dist/main.js'],
        // Espelha o payload real: sem CORS_ORIGIN a API nao autoriza a origem do Web.
        requiredEnvironment: ['CORS_ORIGIN'],
      },
      worker: { command: ['node', 'apps/api/dist/worker/main.js'] },
      web: {
        healthPath: '/health',
        // Espelha o payload real: o Web precisa saber para qual API o browser deve chamar.
        requiredEnvironment: ['CISNE_PUBLIC_API_URL'],
      },
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

test('worker com imagem dedicada cisne-worker e aceito', () => {
  const workerDigest = `sha256:${'6'.repeat(64)}`;
  const plan = buildDeployPlan(
    payload({
      images: {
        api: API_IMAGE,
        worker: `ghcr.io/rphllljust/cisne-worker@${workerDigest}`,
        web: WEB_IMAGE,
      },
    }),
    apps,
  );
  const byKey = Object.fromEntries(plan.map((e) => [e.key, e]));
  assert.equal(byKey.worker.repository, 'ghcr.io/rphllljust/cisne-worker');
  assert.equal(byKey.worker.expectedDigest, workerDigest);
  assert.equal(byKey.api.repository, 'ghcr.io/rphllljust/cisne-api');
});

test('worker com imagem totalmente estranha e recusado', () => {
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
    listEnvironment: async (uuid) => ENV_OK[uuid] ?? [],
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
    listEnvironment: async (uuid) => ENV_OK[uuid] ?? [],
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
    listEnvironment: async () => [],
  };
  await assert.rejects(
    () => runDeployPlan(buildDeployPlan(payload(), apps), client, { timeoutMs: 500 }),
    DeployRefusedError,
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CONTRATO DE AMBIENTE — `requiredEnvironment` precisa ser EXECUTADO, nao apenas declarado.
//
// O payload declarava `CORS_ORIGIN` (api) e `CISNE_PUBLIC_API_URL` (web) desde o inicio, e
// nada no caminho de deploy lia o campo. O incidente de producao provou o custo: containers
// saudaveis, `/health/ready` verde, `restarts=0`, e a tela de login dizendo "Nao foi possivel
// conectar ao servidor". Estes testes travam a transformacao do campo em contrato fail-closed.
// ─────────────────────────────────────────────────────────────────────────────────────────────

function clientComEnv(envsByUuid) {
  return {
    pinImage: async () => undefined,
    setStartCommand: async () => undefined,
    deploy: async () => ({ deployments: [{ deployment_uuid: 'dep' }] }),
    deployment: async () => ({ status: 'finished' }),
    listEnvironment: async (uuid) => envsByUuid[uuid] ?? [],
  };
}

test('recusa deploy quando variavel obrigatoria esta ausente no Coolify', async () => {
  // Sem CORS_ORIGIN a API nao devolve Access-Control-Allow-Origin e o browser bloqueia.
  const client = clientComEnv({
    'uuid-api': [{ key: 'JWT_SECRET', real_value: 'x'.repeat(40) }],
    'uuid-web': ENV_OK['uuid-web'],
  });
  await assert.rejects(
    () => runDeployPlan(buildDeployPlan(payload(), apps), client, { timeoutMs: 500 }),
    /variavel obrigatoria ausente: CORS_ORIGIN/,
  );
});

test('recusa deploy quando variavel obrigatoria esta vazia', async () => {
  // Variavel presente com valor vazio tem o mesmo efeito pratico de ausente: a lista de
  // origens permitidas fica vazia e todo login pelo browser falha.
  const client = clientComEnv({
    'uuid-api': [{ key: 'CORS_ORIGIN', real_value: '   ' }],
    'uuid-web': ENV_OK['uuid-web'],
  });
  await assert.rejects(
    () => runDeployPlan(buildDeployPlan(payload(), apps), client, { timeoutMs: 500 }),
    /variavel obrigatoria vazia: CORS_ORIGIN/,
  );
});

test('recusa deploy quando variavel esta duplicada (ambiguidade de runtime)', async () => {
  // A API v1 do Coolify nao tem PATCH: recriar exige DELETE + POST. Sem conferir
  // cardinalidade sobram duas entradas com a mesma chave e nao ha como saber qual valor
  // o container recebe.
  const client = clientComEnv({
    'uuid-api': [
      { key: 'CORS_ORIGIN', real_value: 'http://antigo.example.test' },
      { key: 'CORS_ORIGIN', real_value: 'http://app.example.test' },
    ],
    'uuid-web': ENV_OK['uuid-web'],
  });
  await assert.rejects(
    () => runDeployPlan(buildDeployPlan(payload(), apps), client, { timeoutMs: 500 }),
    /variavel duplicada \(2x\) no Coolify: CORS_ORIGIN/,
  );
});

test('recusa deploy quando CISNE_PUBLIC_API_URL do Web esta ausente', async () => {
  const client = clientComEnv({
    'uuid-api': ENV_OK['uuid-api'],
    'uuid-web': [],
  });
  await assert.rejects(
    () => runDeployPlan(buildDeployPlan(payload(), apps), client, { timeoutMs: 500 }),
    /variavel obrigatoria ausente: CISNE_PUBLIC_API_URL/,
  );
});

test('ambiente completo e aceito e o deploy prossegue', async () => {
  const client = clientComEnv(ENV_OK);
  const results = await runDeployPlan(buildDeployPlan(payload(), apps), client, { timeoutMs: 500 });
  assert.deepEqual(results.map((r) => r.key), ['api', 'worker', 'web']);
});

test('verificacao de ambiente roda ANTES de pinar qualquer imagem', async () => {
  const order = [];
  const client = {
    pinImage: async () => order.push('pin'),
    setStartCommand: async () => order.push('start'),
    deploy: async () => {
      order.push('deploy');
      return { deployments: [{ deployment_uuid: 'dep' }] };
    },
    deployment: async () => ({ status: 'finished' }),
    listEnvironment: async (uuid) => {
      order.push(`env:${uuid}`);
      return ENV_OK[uuid] ?? [];
    },
  };
  await runDeployPlan(buildDeployPlan(payload(), apps), client, { timeoutMs: 500 });
  assert.ok(order.includes('env:uuid-api'), 'ambiente da API nao foi verificado');
  assert.ok(
    order.indexOf('env:uuid-api') < order.indexOf('pin'),
    'ambiente precisa ser verificado antes de pinar a imagem',
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

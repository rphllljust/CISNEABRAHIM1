#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  createCoolifyClient,
  DeployRefusedError,
  waitForDeployment,
} from '../cd/coolify-deploy.mjs';
import { verifyProduction } from '../cd/coolify-postdeploy-smoke.mjs';
import { auditProductionTls, parsePublicUrls } from './coolify-tls-audit.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;

function required(name, value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new DeployRefusedError(`${name} ausente`);
  return normalized;
}

function normalizeBase(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function toHttps(value) {
  const url = new URL(value);
  url.protocol = 'https:';
  return url.toString().replace(/\/$/, '');
}

function origin(value) {
  return new URL(value).origin.toLowerCase();
}

function runtimeIdentity(app, expectedSha, key) {
  const tag = String(app?.docker_registry_image_tag ?? '').trim();
  const status = String(app?.status ?? '').toLowerCase();
  const repository = String(app?.docker_registry_image_name ?? '').trim();
  if (tag !== expectedSha) {
    throw new DeployRefusedError(
      `${key}: runtime tag divergiu: expected=${expectedSha} actual=${tag || 'MISSING'}`,
    );
  }
  if (!status.startsWith('running')) {
    throw new DeployRefusedError(`${key}: runtime nao esta running: ${status || 'MISSING'}`);
  }
  if (!repository) {
    throw new DeployRefusedError(`${key}: repository do runtime ausente`);
  }
  return { tag, status, repository };
}

function productionEnv(envs, key) {
  const entries = (Array.isArray(envs) ? envs : []).filter(
    (entry) => entry?.key === key && entry?.is_preview !== true,
  );
  if (entries.length !== 1) {
    throw new DeployRefusedError(
      `${key}: esperado exatamente 1 env de producao, encontrado ${entries.length}`,
    );
  }
  const entry = entries[0];
  const value = entry?.real_value ?? entry?.value;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DeployRefusedError(`${key}: env de producao vazio`);
  }
  return {
    value: value.trim(),
    isLiteral: entry?.is_literal ?? true,
    isMultiline: entry?.is_multiline ?? false,
    isShownOnce: entry?.is_shown_once ?? false,
  };
}

function rawDomains(app, key) {
  const value = String(app?.fqdn ?? app?.domains ?? '').trim();
  if (!value) throw new DeployRefusedError(`${key}: domains/fqdn ausente`);
  return value;
}

export function buildTlsCutoverPlan({
  api,
  worker,
  web,
  apiEnvs,
  webEnvs,
  expectedSha,
}) {
  if (!SHA_RE.test(expectedSha ?? '')) {
    throw new DeployRefusedError('EXPECTED_SOURCE_SHA invalido');
  }

  const runtime = {
    api: runtimeIdentity(api, expectedSha, 'api'),
    worker: runtimeIdentity(worker, expectedSha, 'worker'),
    web: runtimeIdentity(web, expectedSha, 'web'),
  };

  const apiUrls = parsePublicUrls(api, 'api');
  const webUrls = parsePublicUrls(web, 'web');
  const secureApiUrls = apiUrls.map(toHttps);
  const secureWebUrls = webUrls.map(toHttps);
  const desiredDomains = {
    api: secureApiUrls.join(','),
    web: secureWebUrls.join(','),
  };

  const currentCors = productionEnv(apiEnvs, 'CORS_ORIGIN');
  const currentPublicApi = productionEnv(webEnvs, 'CISNE_PUBLIC_API_URL');
  const desiredCors = [...new Set(secureWebUrls.map(origin))].join(',');
  const desiredPublicApi = normalizeBase(secureApiUrls[0]);

  const original = {
    api: {
      domains: rawDomains(api, 'api'),
      forceHttps: Boolean(api?.is_force_https_enabled),
    },
    web: {
      domains: rawDomains(web, 'web'),
      forceHttps: Boolean(web?.is_force_https_enabled),
    },
    env: {
      cors: currentCors,
      publicApi: currentPublicApi,
    },
  };

  const changed = {
    apiDomains: normalizeBase(original.api.domains) !== normalizeBase(desiredDomains.api),
    webDomains: normalizeBase(original.web.domains) !== normalizeBase(desiredDomains.web),
    cors: currentCors.value !== desiredCors,
    publicApi: normalizeBase(currentPublicApi.value) !== desiredPublicApi,
    apiForceHttps: !original.api.forceHttps,
    webForceHttps: !original.web.forceHttps,
  };

  return {
    expectedSha,
    runtime,
    desired: {
      apiDomains: desiredDomains.api,
      webDomains: desiredDomains.web,
      corsOrigin: desiredCors,
      publicApiUrl: desiredPublicApi,
    },
    original,
    changed,
    runtimeRestartRequired:
      changed.apiDomains || changed.webDomains || changed.cors || changed.publicApi,
  };
}

async function patchApplication(client, uuid, body) {
  return client.call(`/applications/${uuid}`, { method: 'PATCH', body });
}

async function replaceProductionEnvironment(client, uuid, key, value, metadata = {}) {
  // Coolify 4.4.7 foi medido sem update confiavel de env por chave: o caminho
  // operacional seguro e DELETE do UUID atual + POST da nova entrada.
  // Reconsultar antes de cada troca torna o rollback recuperavel mesmo se o
  // POST falhar depois do DELETE.
  const envs = await client.listEnvironment(uuid);
  const current = (Array.isArray(envs) ? envs : []).filter(
    (entry) => entry?.key === key && entry?.is_preview !== true,
  );
  if (current.length > 1) {
    throw new DeployRefusedError(
      `${key}: ambiente ambiguo no Coolify (${current.length} entradas de producao)`,
    );
  }
  if (current.length === 1) {
    const envUuid = String(current[0]?.uuid ?? '').trim();
    if (!envUuid) {
      throw new DeployRefusedError(`${key}: UUID da variavel atual ausente`);
    }
    await client.call(`/applications/${uuid}/envs/${envUuid}`, { method: 'DELETE' });
  }
  return client.call(`/applications/${uuid}/envs`, {
    method: 'POST',
    body: {
      key,
      value,
      is_preview: false,
      is_literal: metadata.isLiteral ?? true,
      is_multiline: metadata.isMultiline ?? false,
      is_shown_once: metadata.isShownOnce ?? false,
    },
  });
}

function deploymentUuid(started, key) {
  const uuid = started?.deployments?.[0]?.deployment_uuid ?? started?.deployment_uuid;
  if (!uuid) throw new DeployRefusedError(`Coolify nao devolveu deployment_uuid para ${key}`);
  return uuid;
}

async function redeployApiAndWeb(client, uuids, {
  timeoutMs,
  intervalMs,
  sleep,
  waitFn = waitForDeployment,
}) {
  const started = await Promise.all([
    client.deploy(uuids.api),
    client.deploy(uuids.web),
  ]);
  const deployments = [
    ['api', deploymentUuid(started[0], 'api')],
    ['web', deploymentUuid(started[1], 'web')],
  ];
  await Promise.all(
    deployments.map(([, uuid]) =>
      waitFn(client, uuid, { timeoutMs, intervalMs, sleep }),
    ),
  );
  return deployments;
}

async function applyDesired(plan, client, uuids) {
  let mutationCount = 0;

  // Primeiro persiste envs: ainda nao afeta os containers em execucao.
  // Assim o proxy so muda para HTTPS depois de CORS/runtime-config estarem
  // prontos para entrar juntos no proximo deploy.
  if (plan.changed.cors) {
    await replaceProductionEnvironment(
      client,
      uuids.api,
      'CORS_ORIGIN',
      plan.desired.corsOrigin,
      plan.original.env.cors,
    );
    mutationCount += 1;
  }
  if (plan.changed.publicApi) {
    await replaceProductionEnvironment(
      client,
      uuids.web,
      'CISNE_PUBLIC_API_URL',
      plan.desired.publicApiUrl,
      plan.original.env.publicApi,
    );
    mutationCount += 1;
  }

  const appOps = [];
  if (plan.changed.apiDomains || plan.changed.apiForceHttps) {
    appOps.push(
      patchApplication(client, uuids.api, {
        domains: plan.desired.apiDomains,
        is_force_https_enabled: true,
      }),
    );
    mutationCount += 1;
  }
  if (plan.changed.webDomains || plan.changed.webForceHttps) {
    appOps.push(
      patchApplication(client, uuids.web, {
        domains: plan.desired.webDomains,
        is_force_https_enabled: true,
      }),
    );
    mutationCount += 1;
  }
  await Promise.all(appOps);

  return mutationCount;
}

async function rollback(plan, client, uuids, options) {
  await Promise.all([
    patchApplication(client, uuids.api, {
      domains: plan.original.api.domains,
      is_force_https_enabled: plan.original.api.forceHttps,
    }),
    patchApplication(client, uuids.web, {
      domains: plan.original.web.domains,
      is_force_https_enabled: plan.original.web.forceHttps,
    }),
    replaceProductionEnvironment(
      client,
      uuids.api,
      'CORS_ORIGIN',
      plan.original.env.cors.value,
      plan.original.env.cors,
    ),
    replaceProductionEnvironment(
      client,
      uuids.web,
      'CISNE_PUBLIC_API_URL',
      plan.original.env.publicApi.value,
      plan.original.env.publicApi,
    ),
  ]);

  // Voltar env/domains exige recriar API e Web para restaurar runtime-config/CORS.
  await redeployApiAndWeb(client, uuids, options);
}

async function waitForTlsReady({
  client,
  fetchImpl,
  expectedSha,
  uuids,
  timeoutMs,
  intervalMs,
  sleep,
  auditFn,
}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await auditFn({ client, fetchImpl, expectedSha, uuids });
    if (last.readyForHttpsOnly) return last;
    if (Date.now() >= deadline) {
      throw new DeployRefusedError(
        `TLS nao ficou pronto em ${timeoutMs}ms: ${JSON.stringify({
          httpsConfigured: last.httpsConfigured,
          certificateValid: last.certificateValid,
          httpRedirects: last.httpRedirects,
          hsts: last.hsts,
          env: last.env,
        })}`,
      );
    }
    await sleep(intervalMs);
  }
}

function defaultSleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

export async function hardenProductionTls({
  client,
  fetchImpl = fetch,
  expectedSha,
  uuids,
  login,
  password,
  deployTimeoutMs = 600_000,
  certificateTimeoutMs = 180_000,
  pollIntervalMs = 5_000,
  sleep = defaultSleep,
  auditFn = auditProductionTls,
  verifyFn = verifyProduction,
  waitFn = waitForDeployment,
}) {
  required('PROD_SMOKE_LOGIN', login);
  required('PROD_SMOKE_PASSWORD', password);

  const [api, worker, web, apiEnvs, webEnvs] = await Promise.all([
    client.getApplication(uuids.api),
    client.getApplication(uuids.worker),
    client.getApplication(uuids.web),
    client.listEnvironment(uuids.api),
    client.listEnvironment(uuids.web),
  ]);

  const plan = buildTlsCutoverPlan({
    api,
    worker,
    web,
    apiEnvs,
    webEnvs,
    expectedSha,
  });

  // Marcar ANTES do primeiro efeito: se DELETE de env funcionar e o POST
  // seguinte falhar, o catch ainda executa rollback e recria o valor original.
  let mutated = Object.values(plan.changed).some(Boolean);
  try {
    await applyDesired(plan, client, uuids);

    if (plan.runtimeRestartRequired) {
      await redeployApiAndWeb(client, uuids, {
        timeoutMs: deployTimeoutMs,
        intervalMs: pollIntervalMs,
        sleep,
        waitFn,
      });
    }

    const tls = await waitForTlsReady({
      client,
      fetchImpl,
      expectedSha,
      uuids,
      timeoutMs: certificateTimeoutMs,
      intervalMs: pollIntervalMs,
      sleep,
      auditFn,
    });

    const smoke = await verifyFn({
      client,
      fetchImpl,
      sourceSha: expectedSha,
      repositories: {
        api: plan.runtime.api.repository,
        worker: plan.runtime.worker.repository,
        web: plan.runtime.web.repository,
      },
      uuids,
      login,
      password,
    });

    return {
      sourceSha: expectedSha,
      changed: plan.changed,
      runtimeRestarted: plan.runtimeRestartRequired,
      tls,
      smoke,
    };
  } catch (error) {
    if (!mutated) throw error;

    try {
      await rollback(plan, client, uuids, {
        timeoutMs: deployTimeoutMs,
        intervalMs: pollIntervalMs,
        sleep,
        waitFn,
      });
    } catch (rollbackError) {
      throw new DeployRefusedError(
        `TLS hardening falhou (${error instanceof Error ? error.message : String(error)}) e rollback tambem falhou (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`,
      );
    }

    throw new DeployRefusedError(
      `TLS hardening falhou e configuracao de rota/env foi restaurada: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function main() {
  const expectedSha = required('EXPECTED_SOURCE_SHA', process.env.EXPECTED_SOURCE_SHA);
  const client = createCoolifyClient({
    baseUrl: process.env.COOLIFY_BASE_URL,
    token: process.env.COOLIFY_TOKEN,
  });
  const result = await hardenProductionTls({
    client,
    expectedSha,
    uuids: {
      api: required('COOLIFY_API_UUID', process.env.COOLIFY_API_UUID),
      worker: required('COOLIFY_WORKER_UUID', process.env.COOLIFY_WORKER_UUID),
      web: required('COOLIFY_WEB_UUID', process.env.COOLIFY_WEB_UUID),
    },
    login: process.env.PROD_SMOKE_LOGIN,
    password: process.env.PROD_SMOKE_PASSWORD,
    deployTimeoutMs: Number(process.env.COOLIFY_DEPLOY_TIMEOUT_MS ?? 600_000),
    certificateTimeoutMs: Number(process.env.TLS_CERTIFICATE_TIMEOUT_MS ?? 180_000),
  });

  console.log(
    `[tls-harden] PASS source=${result.sourceSha} changed=${JSON.stringify(result.changed)} restart=${result.runtimeRestarted} httpsOnly=${result.tls.readyForHttpsOnly} auth=${result.smoke.authenticatedSmoke}`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[tls-harden] FALHA: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

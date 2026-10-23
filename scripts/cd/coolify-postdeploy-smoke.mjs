#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createCoolifyClient, DeployRefusedError } from './coolify-deploy.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;

function required(name, value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new DeployRefusedError(`${name} ausente`);
  return normalized;
}

function normalizeRepository(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function selectPublicBaseUrl(fqdn, name) {
  const candidates = String(fqdn ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`));

  if (candidates.length === 0) {
    throw new DeployRefusedError(`${name}: fqdn publico ausente no Coolify`);
  }
  return (candidates.find((url) => url.startsWith('https://')) ?? candidates[0]).replace(/\/$/, '');
}

async function fetchChecked(fetchImpl, url, init, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (response.status >= 500) {
      throw new DeployRefusedError(`${label}: HTTP ${response.status}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function jsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function assertRuntimeIdentity(app, { key, repository, sourceSha }) {
  const actualRepository = normalizeRepository(app?.docker_registry_image_name);
  const actualTag = String(app?.docker_registry_image_tag ?? '').trim();
  const status = String(app?.status ?? '').toLowerCase();

  if (actualRepository !== normalizeRepository(repository)) {
    throw new DeployRefusedError(
      `${key}: repository em runtime divergiu: expected=${repository} actual=${actualRepository || 'MISSING'}`,
    );
  }
  if (actualTag !== sourceSha) {
    throw new DeployRefusedError(
      `${key}: tag em runtime divergiu: expected=${sourceSha} actual=${actualTag || 'MISSING'}`,
    );
  }
  if (!status.startsWith('running')) {
    throw new DeployRefusedError(`${key}: status Coolify nao esta running: ${status || 'MISSING'}`);
  }
}

function logsText(payload) {
  if (typeof payload === 'string') return payload;
  if (typeof payload?.logs === 'string') return payload.logs;
  return JSON.stringify(payload ?? '');
}

function findFiveHundreds(text) {
  const lines = String(text).split('\n');
  return lines.filter((line) =>
    /"statusCode"\s*:\s*5\d\d|\bHTTP\s+5\d\d\b|\bstatus(?:Code)?\s*[=:]\s*5\d\d\b/i.test(line),
  );
}

export async function verifyProduction({
  client,
  fetchImpl = fetch,
  sourceSha,
  repositories,
  uuids,
  login,
  password,
}) {
  if (!SHA_RE.test(sourceSha ?? '')) throw new DeployRefusedError('COOLIFY_SOURCE_SHA invalido');
  required('PROD_SMOKE_LOGIN', login);
  required('PROD_SMOKE_PASSWORD', password);

  const [api, worker, web] = await Promise.all([
    client.getApplication(uuids.api),
    client.getApplication(uuids.worker),
    client.getApplication(uuids.web),
  ]);

  assertRuntimeIdentity(api, { key: 'api', repository: repositories.api, sourceSha });
  assertRuntimeIdentity(worker, { key: 'worker', repository: repositories.worker, sourceSha });
  assertRuntimeIdentity(web, { key: 'web', repository: repositories.web, sourceSha });

  const apiUrl = selectPublicBaseUrl(api.fqdn, 'api');
  const webUrl = selectPublicBaseUrl(web.fqdn, 'web');

  const [ready, webHealth] = await Promise.all([
    fetchChecked(fetchImpl, `${apiUrl}/api/v1/health/ready`, { method: 'GET' }, 'api readiness'),
    fetchChecked(fetchImpl, `${webUrl}/health`, { method: 'GET' }, 'web health'),
  ]);

  if (!ready.ok) throw new DeployRefusedError(`api readiness: HTTP ${ready.status}`);
  const readyBody = await jsonSafe(ready);
  if (readyBody?.status !== 'ready' || readyBody?.checks?.database?.status !== 'up') {
    throw new DeployRefusedError('api readiness nao confirmou status=ready e database=up');
  }
  if (!webHealth.ok) throw new DeployRefusedError(`web health: HTTP ${webHealth.status}`);

  const loginResponse = await fetchChecked(
    fetchImpl,
    `${apiUrl}/api/v1/auth/login`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login, password }),
    },
    'login',
  );
  const loginBody = await jsonSafe(loginResponse);
  const token = loginBody?.accessToken;
  if (!loginResponse.ok || !token) {
    throw new DeployRefusedError(`login smoke falhou: HTTP ${loginResponse.status}`);
  }

  const authHeaders = { authorization: `Bearer ${token}` };
  for (const [label, path] of [
    ['auth session', '/api/v1/auth/session'],
    ['me', '/api/v1/me'],
    ['catalog', '/api/v1/catalog/service-definitions?limit=1&offset=0'],
  ]) {
    const response = await fetchChecked(fetchImpl, `${apiUrl}${path}`, { method: 'GET', headers: authHeaders }, label);
    if (!response.ok) throw new DeployRefusedError(`${label}: HTTP ${response.status}`);
  }

  const logPayloads = await Promise.all(
    Object.entries(uuids).map(async ([key, uuid]) => {
      const payload = await client.call(`/applications/${uuid}/logs?lines=200&show_timestamps=true`);
      return [key, logsText(payload)];
    }),
  );

  const fiveHundreds = logPayloads.flatMap(([key, text]) =>
    findFiveHundreds(text).map((line) => `${key}: ${line.slice(0, 240)}`),
  );
  if (fiveHundreds.length > 0) {
    throw new DeployRefusedError(
      `5xx encontrado nos logs recentes: ${fiveHundreds.slice(0, 5).join(' | ')}`,
    );
  }

  return {
    sourceSha,
    apiUrl,
    webUrl,
    runtime: {
      api: { repository: repositories.api, tag: sourceSha, status: api.status },
      worker: { repository: repositories.worker, tag: sourceSha, status: worker.status },
      web: { repository: repositories.web, tag: sourceSha, status: web.status },
    },
    readiness: { status: readyBody.status, database: readyBody.checks.database.status },
    webHealth: 'ok',
    authenticatedSmoke: 'ok',
    recent5xx: 0,
  };
}

async function main() {
  const sourceSha = required('COOLIFY_SOURCE_SHA', process.env.COOLIFY_SOURCE_SHA);
  const client = createCoolifyClient({
    baseUrl: process.env.COOLIFY_BASE_URL,
    token: process.env.COOLIFY_TOKEN,
  });

  const result = await verifyProduction({
    client,
    sourceSha,
    repositories: {
      api: required('API_REPOSITORY', process.env.API_REPOSITORY),
      worker: required('WORKER_REPOSITORY', process.env.WORKER_REPOSITORY),
      web: required('WEB_REPOSITORY', process.env.WEB_REPOSITORY),
    },
    uuids: {
      api: required('COOLIFY_API_UUID', process.env.COOLIFY_API_UUID),
      worker: required('COOLIFY_WORKER_UUID', process.env.COOLIFY_WORKER_UUID),
      web: required('COOLIFY_WEB_UUID', process.env.COOLIFY_WEB_UUID),
    },
    login: process.env.PROD_SMOKE_LOGIN,
    password: process.env.PROD_SMOKE_PASSWORD,
  });

  console.log(
    `[coolify-postdeploy] PASS source=${result.sourceSha} readiness=${result.readiness.status} database=${result.readiness.database} web=${result.webHealth} auth=${result.authenticatedSmoke} recent5xx=${result.recent5xx}`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[coolify-postdeploy] FALHA: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

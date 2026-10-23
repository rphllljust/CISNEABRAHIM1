#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const SHA_RE = /^[0-9a-f]{40}$/i;
const FATAL_RE = /(?:\bfatal\b|unhandled(?:rejection|exception)|uncaught(?:exception|error)|panic)/i;
const HTTP_5XX_RE = /(?:\b(?:GET|POST|PUT|PATCH|DELETE)\b.*\s5\d\d\b|\bstatus(?:Code)?[=:\s"']+5\d\d\b|\bHTTP\/\S+\s+5\d\d\b)/i;

export class ProductionSmokeError extends Error {}

function required(name, value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new ProductionSmokeError(`${name} is required`);
  return normalized;
}

function firstPublicUrl(app, label) {
  const raw = app?.fqdn ?? app?.domains ?? '';
  const urls = String(raw)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const url = urls.find((v) => /^https?:\/\//i.test(v));
  if (!url) throw new ProductionSmokeError(`${label}: public URL ausente no Coolify`);
  return url.replace(/\/$/, '');
}

function assertRuntime(app, { label, repository, sha }) {
  if (!app || typeof app !== 'object') throw new ProductionSmokeError(`${label}: app ausente`);
  const actualRepo = String(app.docker_registry_image_name ?? '').toLowerCase();
  const actualTag = String(app.docker_registry_image_tag ?? '').toLowerCase();
  if (actualRepo !== repository.toLowerCase()) {
    throw new ProductionSmokeError(`${label}: repository divergente: ${actualRepo}`);
  }
  if (actualTag !== sha.toLowerCase()) {
    throw new ProductionSmokeError(`${label}: tag divergente: ${actualTag}`);
  }
  const status = String(app.status ?? '');
  if (!/^running(?::|$)/i.test(status)) {
    throw new ProductionSmokeError(`${label}: status runtime invalido: ${status}`);
  }
}

async function jsonSafe(response) {
  try { return await response.json(); } catch { return null; }
}

async function expect2xx(fetchImpl, url, init, label) {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProductionSmokeError(`${label}: HTTP ${response.status} ${body.slice(0,200)}`);
  }
  return response;
}

function recentOperationalErrors(logs, sinceMs) {
  return String(logs ?? '')
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      const iso = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
      if (!iso) return false;
      const ts = Date.parse(iso[0]);
      if (!Number.isFinite(ts) || ts < sinceMs) return false;
      return FATAL_RE.test(line) || HTTP_5XX_RE.test(line);
    });
}

export async function runProductionSmoke(config, fetchImpl = fetch) {
  const baseUrl = required('COOLIFY_BASE_URL', config.coolifyBaseUrl).replace(/\/$/, '');
  const token = required('COOLIFY_TOKEN', config.coolifyToken);
  const sha = required('EXPECTED_SOURCE_SHA', config.expectedSourceSha);
  if (!SHA_RE.test(sha)) throw new ProductionSmokeError('EXPECTED_SOURCE_SHA invalid');
  const uuids = {
    api: required('COOLIFY_API_UUID', config.apiUuid),
    worker: required('COOLIFY_WORKER_UUID', config.workerUuid),
    web: required('COOLIFY_WEB_UUID', config.webUuid),
  };
  const login = required('PROD_SMOKE_LOGIN', config.login);
  const password = required('PROD_SMOKE_PASSWORD', config.password);
  const startedAt = Date.now();

  const coolify = async (path) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new ProductionSmokeError(`Coolify GET ${path}: HTTP ${response.status}`);
    }
    return jsonSafe(response);
  };

  const [api, worker, web] = await Promise.all([
    coolify(`/applications/${uuids.api}`),
    coolify(`/applications/${uuids.worker}`),
    coolify(`/applications/${uuids.web}`),
  ]);

  assertRuntime(api, { label:'api', repository:'ghcr.io/rphllljust/cisne-api', sha });
  assertRuntime(worker, { label:'worker', repository:'ghcr.io/rphllljust/cisne-worker', sha });
  assertRuntime(web, { label:'web', repository:'ghcr.io/rphllljust/cisne-web', sha });

  const apiBase = firstPublicUrl(api, 'api');
  const webBase = firstPublicUrl(web, 'web');

  await expect2xx(fetchImpl, `${apiBase}/api/v1/health/live`, { method:'GET' }, 'api live');
  const readyResponse = await expect2xx(fetchImpl, `${apiBase}/api/v1/health/ready`, { method:'GET' }, 'api ready');
  const ready = await jsonSafe(readyResponse);
  if (ready?.status !== 'ready' || ready?.database?.status !== 'up') {
    throw new ProductionSmokeError(`api ready sem banco up: ${JSON.stringify(ready)}`);
  }
  await expect2xx(fetchImpl, `${webBase}/health`, { method:'GET' }, 'web health');

  const loginResponse = await expect2xx(fetchImpl, `${apiBase}/api/v1/auth/login`, {
    method:'POST',
    headers:{ 'content-type':'application/json', 'user-agent':'cisne-production-smoke' },
    body:JSON.stringify({ login, password }),
  }, 'auth login');
  const loginBody = await jsonSafe(loginResponse);
  const accessToken = loginBody?.accessToken;
  if (!accessToken) throw new ProductionSmokeError('auth login nao retornou accessToken');

  const authHeaders = { authorization:`Bearer ${accessToken}`, 'user-agent':'cisne-production-smoke' };
  await expect2xx(fetchImpl, `${apiBase}/api/v1/auth/session`, { method:'GET', headers:authHeaders }, 'auth session');
  await expect2xx(fetchImpl, `${apiBase}/api/v1/me`, { method:'GET', headers:authHeaders }, 'me');
  await expect2xx(fetchImpl, `${apiBase}/api/v1/catalog/service-definitions?limit=1&offset=0`, { method:'GET', headers:authHeaders }, 'catalog');

  const logResults = await Promise.all(Object.entries(uuids).map(async ([key, uuid]) => {
    const payload = await coolify(`/applications/${uuid}/logs?lines=200&show_timestamps=true`);
    const errors = recentOperationalErrors(payload?.logs, startedAt - 120_000);
    return { key, errors };
  }));
  const bad = logResults.flatMap(({key,errors}) => errors.map(line => `${key}: ${line}`));
  if (bad.length) {
    throw new ProductionSmokeError(`erros operacionais recentes: ${bad.slice(0,10).join(' | ')}`);
  }

  return {
    sourceSha: sha.toLowerCase(),
    api: { status: String(api.status), url: apiBase },
    worker: { status: String(worker.status) },
    web: { status: String(web.status), url: webBase },
    database: 'up',
    auth: 'ok',
    logs: 'clean',
  };
}

async function runCli() {
  const result = await runProductionSmoke({
    coolifyBaseUrl: process.env.COOLIFY_BASE_URL,
    coolifyToken: process.env.COOLIFY_TOKEN,
    apiUuid: process.env.COOLIFY_API_UUID,
    workerUuid: process.env.COOLIFY_WORKER_UUID,
    webUuid: process.env.COOLIFY_WEB_UUID,
    expectedSourceSha: process.env.EXPECTED_SOURCE_SHA,
    login: process.env.PROD_SMOKE_LOGIN,
    password: process.env.PROD_SMOKE_PASSWORD,
  });
  console.log(`[production-smoke] PASS source=${result.sourceSha} database=${result.database} auth=${result.auth} logs=${result.logs}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli().catch((error) => {
    console.error(`[production-smoke] FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createCoolifyClient,
  DeployRefusedError,
} from './coolify-deploy.mjs';

function requireEnv(name, env = process.env) {
  const value = env[name]?.trim();
  if (!value) throw new DeployRefusedError(`${name} e obrigatorio para smoke de producao`);
  return value;
}

function urlsFrom(value) {
  if (Array.isArray(value)) return value.flatMap(urlsFrom);
  if (typeof value !== 'string') return [];
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
}

export function resolveApplicationUrl(application, label) {
  const candidates = [
    application?.fqdn,
    application?.domains,
    application?.domain,
    application?.url,
    application?.urls,
  ].flatMap(urlsFrom);
  const selected =
    candidates.find((url) => /^https:\/\//i.test(url)) ??
    candidates.find((url) => /^http:\/\//i.test(url));
  if (!selected) {
    throw new DeployRefusedError(`${label}: Coolify nao publicou FQDN/URL acessivel`);
  }
  return selected.replace(/\/$/, '');
}

export function assertRuntimeApplication(application, label, expectedSha) {
  const status = String(application?.status ?? '').toLowerCase();
  if (!status.includes('running') || status.includes('unhealthy')) {
    throw new DeployRefusedError(`${label}: runtime nao saudavel (status=${status || 'missing'})`);
  }
  const tag = String(application?.docker_registry_image_tag ?? '').trim();
  if (tag && tag !== expectedSha) {
    throw new DeployRefusedError(`${label}: tag implantada diverge do SOURCE_SHA`);
  }
}

async function request(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // HTML/texto e valido para o Web.
  }
  if (!response.ok) {
    const safePath = new URL(url).pathname;
    throw new DeployRefusedError(`${options.method ?? 'GET'} ${safePath} -> HTTP ${response.status}`);
  }
  return { response, body, text };
}

export async function runProductionSmoke({
  client,
  apps,
  expectedSha,
  login,
  password,
  fetchImpl = fetch,
  onStep = () => {},
}) {
  const [apiApp, workerApp, webApp] = await Promise.all([
    client.getApplication(apps.api),
    client.getApplication(apps.worker),
    client.getApplication(apps.web),
  ]);

  assertRuntimeApplication(apiApp, 'api', expectedSha);
  assertRuntimeApplication(workerApp, 'worker', expectedSha);
  assertRuntimeApplication(webApp, 'web', expectedSha);

  const apiBase = resolveApplicationUrl(apiApp, 'api');
  const webBase = resolveApplicationUrl(webApp, 'web');

  onStep('[prod-smoke] runtime Coolify running no SOURCE_SHA autorizado');

  const live = await request(`${apiBase}/api/v1/health/live`, {}, fetchImpl);
  if (live.body?.status !== 'ok') {
    throw new DeployRefusedError('API liveness nao retornou status=ok');
  }

  const ready = await request(`${apiBase}/api/v1/health/ready`, {}, fetchImpl);
  if (ready.body?.status !== 'ready' || ready.body?.checks?.database?.status !== 'up') {
    throw new DeployRefusedError('API readiness nao confirmou database=up');
  }
  onStep('[prod-smoke] API live/ready e PostgreSQL up');

  const webHealth = await request(`${webBase}/health`, {}, fetchImpl);
  if (!/ok/i.test(String(webHealth.text ?? ''))) {
    throw new DeployRefusedError('Web /health nao retornou ok');
  }
  const loginPage = await request(`${webBase}/login`, {}, fetchImpl);
  if (!/<(?:!doctype|html|div)/i.test(String(loginPage.text ?? ''))) {
    throw new DeployRefusedError('Web /login nao retornou HTML da aplicacao');
  }
  onStep('[prod-smoke] Web /health e /login responderam');

  const auth = await request(
    `${apiBase}/api/v1/auth/login`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login, password }),
    },
    fetchImpl,
  );
  const accessToken = auth.body?.accessToken;
  if (typeof accessToken !== 'string' || accessToken.length < 20) {
    throw new DeployRefusedError('login 200 sem accessToken valido');
  }

  const headers = { authorization: `Bearer ${accessToken}` };
  await request(`${apiBase}/api/v1/auth/session`, { headers }, fetchImpl);
  await request(`${apiBase}/api/v1/me`, { headers }, fetchImpl);
  onStep('[prod-smoke] autenticacao, sessao e /me confirmados');

  return {
    sourceSha: expectedSha,
    apiHost: new URL(apiBase).host,
    webHost: new URL(webBase).host,
    database: ready.body.checks.database.status,
  };
}

async function runCli() {
  const expectedSha = requireEnv('PROD_SMOKE_EXPECTED_SHA');
  const apps = {
    api: requireEnv('COOLIFY_API_UUID'),
    worker: requireEnv('COOLIFY_WORKER_UUID'),
    web: requireEnv('COOLIFY_WEB_UUID'),
  };
  const login = requireEnv('PROD_SMOKE_LOGIN');
  const password = requireEnv('PROD_SMOKE_PASSWORD');

  const client = createCoolifyClient({
    baseUrl: requireEnv('COOLIFY_BASE_URL'),
    token: requireEnv('COOLIFY_TOKEN'),
  });

  const result = await runProductionSmoke({
    client,
    apps,
    expectedSha,
    login,
    password,
    onStep: (message) => console.log(message),
  });
  console.log(
    `[prod-smoke] PASS source=${result.sourceSha} api=${result.apiHost} web=${result.webHost} database=${result.database}`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli().catch((error) => {
    console.error(`[prod-smoke] FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createCoolifyClient, DeployRefusedError } from '../cd/coolify-deploy.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const REDIRECTS = new Set([301, 302, 307, 308]);
const PERMANENT_REDIRECTS = new Set([301, 308]);

function required(name, value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new DeployRefusedError(`${name} ausente`);
  return normalized;
}

function normalizeBase(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function normalizeOrigin(value) {
  try {
    return new URL(String(value)).origin.toLowerCase();
  } catch {
    return normalizeBase(value).toLowerCase();
  }
}

export function parsePublicUrls(app, name) {
  const raw = String(app?.fqdn ?? app?.domains ?? '').trim();
  const urls = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value.includes('://') ? value : `https://${value}`).toString().replace(/\/$/, '');
      } catch {
        throw new DeployRefusedError(`${name}: dominio publico invalido: ${value}`);
      }
    });

  if (urls.length === 0) {
    throw new DeployRefusedError(`${name}: dominio publico ausente no Coolify`);
  }
  return urls;
}

function selectConfiguredBase(urls) {
  return urls.find((url) => url.startsWith('https://')) ?? urls[0];
}

function withProtocol(value, protocol) {
  const url = new URL(value);
  url.protocol = protocol;
  return url.toString().replace(/\/$/, '');
}

function productionEnv(envs, key) {
  const entries = (Array.isArray(envs) ? envs : []).filter(
    (entry) => entry?.key === key && entry?.is_preview !== true,
  );
  if (entries.length !== 1) return { state: entries.length === 0 ? 'missing' : 'ambiguous', value: null };
  const value = entries[0]?.real_value ?? entries[0]?.value;
  if (typeof value !== 'string' || value.trim() === '') return { state: 'empty', value: null };
  return { state: 'ok', value: value.trim() };
}

async function probe(fetchImpl, baseUrl, path, { redirect = 'manual' } = {}) {
  const target = `${normalizeBase(baseUrl)}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(target, { method: 'GET', redirect, signal: controller.signal });
    const location = response.headers?.get?.('location') ?? null;
    const hsts = response.headers?.get?.('strict-transport-security') ?? null;
    return {
      reachable: true,
      ok: response.ok,
      status: response.status,
      location: location ? normalizeBase(location) : null,
      hsts: Boolean(hsts),
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    const code = error?.cause?.code ?? null;
    return { reachable: false, ok: false, status: null, location: null, hsts: false, error: code ?? name };
  } finally {
    clearTimeout(timeout);
  }
}

function runtimeIdentity(app, expectedSha, key) {
  const tag = String(app?.docker_registry_image_tag ?? '').trim();
  const status = String(app?.status ?? '').toLowerCase();
  if (tag !== expectedSha) {
    throw new DeployRefusedError(`${key}: runtime tag divergiu de main: expected=${expectedSha} actual=${tag || 'MISSING'}`);
  }
  if (!status.startsWith('running')) {
    throw new DeployRefusedError(`${key}: runtime nao esta running: ${status || 'MISSING'}`);
  }
  return { tag, status };
}

function corsMatches(corsValue, webBase) {
  if (!corsValue) return false;
  const expected = normalizeOrigin(webBase);
  return corsValue
    .split(',')
    .map((value) => normalizeOrigin(value))
    .includes(expected);
}

export async function auditProductionTls({
  client,
  fetchImpl = fetch,
  expectedSha,
  uuids,
}) {
  if (!SHA_RE.test(expectedSha ?? '')) {
    throw new DeployRefusedError('EXPECTED_SOURCE_SHA invalido');
  }

  const [api, worker, web] = await Promise.all([
    client.getApplication(uuids.api),
    client.getApplication(uuids.worker),
    client.getApplication(uuids.web),
  ]);

  const runtime = {
    api: runtimeIdentity(api, expectedSha, 'api'),
    worker: runtimeIdentity(worker, expectedSha, 'worker'),
    web: runtimeIdentity(web, expectedSha, 'web'),
  };

  const apiUrls = parsePublicUrls(api, 'api');
  const webUrls = parsePublicUrls(web, 'web');
  const apiBase = selectConfiguredBase(apiUrls);
  const webBase = selectConfiguredBase(webUrls);
  const httpsApi = withProtocol(apiBase, 'https:');
  const httpsWeb = withProtocol(webBase, 'https:');
  const httpApi = withProtocol(apiBase, 'http:');
  const httpWeb = withProtocol(webBase, 'http:');

  const [apiEnvs, webEnvs, apiHttps, webHttps, apiHttp, webHttp] = await Promise.all([
    client.listEnvironment(uuids.api),
    client.listEnvironment(uuids.web),
    probe(fetchImpl, httpsApi, '/api/v1/health/ready'),
    probe(fetchImpl, httpsWeb, '/health'),
    probe(fetchImpl, httpApi, '/api/v1/health/ready'),
    probe(fetchImpl, httpWeb, '/health'),
  ]);

  const cors = productionEnv(apiEnvs, 'CORS_ORIGIN');
  const publicApi = productionEnv(webEnvs, 'CISNE_PUBLIC_API_URL');
  const httpsConfigured = {
    api: apiUrls.some((url) => url.startsWith('https://')),
    web: webUrls.some((url) => url.startsWith('https://')),
  };

  const httpRedirects = {
    api:
      REDIRECTS.has(apiHttp.status) &&
      Boolean(apiHttp.location) &&
      normalizeOrigin(apiHttp.location) === normalizeOrigin(httpsApi),
    web:
      REDIRECTS.has(webHttp.status) &&
      Boolean(webHttp.location) &&
      normalizeOrigin(webHttp.location) === normalizeOrigin(httpsWeb),
  };

  const permanentRedirects = {
    api: httpRedirects.api && PERMANENT_REDIRECTS.has(apiHttp.status),
    web: httpRedirects.web && PERMANENT_REDIRECTS.has(webHttp.status),
  };

  const envCoherence = {
    corsOrigin: cors.state === 'ok' && corsMatches(cors.value, httpsWeb),
    publicApiUrl:
      publicApi.state === 'ok' && normalizeBase(publicApi.value) === normalizeBase(httpsApi),
  };

  const certificateValid = {
    api: apiHttps.reachable && apiHttps.ok,
    web: webHttps.reachable && webHttps.ok,
  };

  const logRedaction = {
    api: Boolean(api?.redact_all_env_values_in_logs),
    web: Boolean(web?.redact_all_env_values_in_logs),
    worker: Boolean(worker?.redact_all_env_values_in_logs),
  };

  const readyForHttpsOnly =
    httpsConfigured.api &&
    httpsConfigured.web &&
    certificateValid.api &&
    certificateValid.web &&
    httpRedirects.api &&
    httpRedirects.web &&
    envCoherence.corsOrigin &&
    envCoherence.publicApiUrl &&
    apiHttps.hsts &&
    webHttps.hsts;

  return {
    sourceSha: expectedSha,
    runtime,
    public: {
      api: apiUrls,
      web: webUrls,
    },
    httpsConfigured,
    certificateValid,
    httpRedirects,
    permanentRedirects,
    hsts: { api: apiHttps.hsts, web: webHttps.hsts },
    env: {
      corsOrigin: { state: cors.state, matchesHttpsWeb: envCoherence.corsOrigin },
      publicApiUrl: { state: publicApi.state, matchesHttpsApi: envCoherence.publicApiUrl },
    },
    probes: {
      apiHttps: { status: apiHttps.status, error: apiHttps.error ?? null },
      webHttps: { status: webHttps.status, error: webHttps.error ?? null },
      apiHttp: { status: apiHttp.status },
      webHttp: { status: webHttp.status },
    },
    coolify: {
      apiPermanentRedirectFlag: Boolean(api?.is_permanent_redirect_enabled),
      webPermanentRedirectFlag: Boolean(web?.is_permanent_redirect_enabled),
      apiCertificateResolver: api?.traefik_certificate_resolver ?? null,
      webCertificateResolver: web?.traefik_certificate_resolver ?? null,
      apiEnvLogRedaction: logRedaction.api,
      webEnvLogRedaction: logRedaction.web,
      workerEnvLogRedaction: logRedaction.worker,
    },
    readyForHttpsOnly,
  };
}

async function main() {
  const expectedSha = required('EXPECTED_SOURCE_SHA', process.env.EXPECTED_SOURCE_SHA);
  const client = createCoolifyClient({
    baseUrl: process.env.COOLIFY_BASE_URL,
    token: process.env.COOLIFY_TOKEN,
  });
  const result = await auditProductionTls({
    client,
    expectedSha,
    uuids: {
      api: required('COOLIFY_API_UUID', process.env.COOLIFY_API_UUID),
      worker: required('COOLIFY_WORKER_UUID', process.env.COOLIFY_WORKER_UUID),
      web: required('COOLIFY_WEB_UUID', process.env.COOLIFY_WEB_UUID),
    },
  });

  console.log(`[tls-audit] ${JSON.stringify(result)}`);
  if (!result.readyForHttpsOnly) {
    throw new DeployRefusedError('producao nao esta em HTTPS-only com redirect HTTP->HTTPS, HSTS e env coerente');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[tls-audit] FALHA: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

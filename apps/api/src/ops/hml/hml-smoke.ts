import type { HmlSmokeCheck, HmlSmokeResult } from './hml-types';

export type HmlSmokeConfig = {
  baseUrl: string;
  login: string;
  password: string;
  timeoutMs?: number;
};

type FetchLike = typeof fetch;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

async function request(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function check(
  id: string,
  label: string,
  passed: boolean,
  statusCode: number | null,
  detail: string,
): HmlSmokeCheck {
  return { id, label, passed, statusCode, detail };
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Allows one bounded retry for API startup; HTTP failures remain fail-closed. */
async function requestStartupReady(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await request(fetchImpl, url, { method: 'GET' }, timeoutMs);
  } catch (firstError) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      return await request(fetchImpl, url, { method: 'GET' }, timeoutMs);
    } catch {
      throw firstError;
    }
  }
}

export async function runHmlDeploySmoke(
  config: HmlSmokeConfig,
  fetchImpl: FetchLike = fetch,
): Promise<HmlSmokeResult> {
  const startedAt = new Date().toISOString();
  const base = normalizeBaseUrl(config.baseUrl);
  const timeoutMs = config.timeoutMs ?? 15_000;
  const checks: HmlSmokeCheck[] = [];

  try {
    const live = await requestStartupReady(fetchImpl, `${base}/api/v1/health/live`, timeoutMs);
    checks.push(
      check('health_live', 'Health live', live.ok, live.status, live.ok ? 'ok' : await live.text()),
    );

    const ready = await request(fetchImpl, `${base}/api/v1/health/ready`, { method: 'GET' }, timeoutMs);
    checks.push(
      check('health_ready', 'Health ready', ready.ok, ready.status, ready.ok ? 'ready' : await ready.text()),
    );

    const loginResponse = await request(
      fetchImpl,
      `${base}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login: config.login, password: config.password }),
      },
      timeoutMs,
    );
    const loginBody = await parseJsonSafe<{ accessToken?: string }>(loginResponse);
    const token = loginBody?.accessToken;
    checks.push(
      check(
        'login',
        'Login',
        loginResponse.ok && Boolean(token),
        loginResponse.status,
        loginResponse.ok ? 'token issued' : 'login failed',
      ),
    );

    if (!token) {
      const finishedAt = new Date().toISOString();
      return { status: 'FAIL', startedAt, finishedAt, checks, error: 'Login smoke failed' };
    }

    const authHeaders = { authorization: `Bearer ${token}` };

    const metrics = await request(
      fetchImpl,
      `${base}/api/v1/observability/metrics`,
      { method: 'GET', headers: authHeaders },
      timeoutMs,
    );
    const metricsAccessible = metrics.ok || metrics.status === 403;
    checks.push(
      check(
        'observability_metrics',
        'Observability metrics',
        metricsAccessible,
        metrics.status,
        metrics.ok
          ? 'metrics available'
          : metrics.status === 403
            ? 'metrics endpoint protected by authorization'
            : await metrics.text(),
      ),
    );

    const listEndpoints: Array<{ id: string; label: string; path: string }> = [
      { id: 'clients', label: 'Clients list', path: '/api/v1/clients' },
      { id: 'requests', label: 'Service requests list', path: '/api/v1/requests/service-requests' },
      { id: 'service_orders', label: 'Service orders list', path: '/api/v1/service-orders' },
      { id: 'documents', label: 'Documents list', path: '/api/v1/documents' },
    ];

    for (const endpoint of listEndpoints) {
      const response = await request(
        fetchImpl,
        `${base}${endpoint.path}`,
        { method: 'GET', headers: authHeaders },
        timeoutMs,
      );
      checks.push(
        check(
          endpoint.id,
          endpoint.label,
          response.status === 200,
          response.status,
          response.status === 200 ? 'authorized list' : await response.text(),
        ),
      );
    }

    const ordersResponse = await request(
      fetchImpl,
      `${base}/api/v1/service-orders`,
      { method: 'GET', headers: authHeaders },
      timeoutMs,
    );
    const ordersPayload = ordersResponse.ok
      ? ((await ordersResponse.json()) as { items?: Array<{ id: string }> })
      : { items: [] };
    const orderId = ordersPayload.items?.[0]?.id ?? '00000000-0000-0000-0000-000000000001';

    const nestedEndpoints: Array<{ id: string; label: string; path: string }> = [
      { id: 'execution', label: 'Execution read model', path: `/api/v1/service-orders/${orderId}/execution` },
      { id: 'measurements', label: 'Measurements list', path: `/api/v1/service-orders/${orderId}/measurements` },
      { id: 'billing', label: 'Billing records list', path: `/api/v1/service-orders/${orderId}/billing-records` },
    ];

    for (const endpoint of nestedEndpoints) {
      const response = await request(
        fetchImpl,
        `${base}${endpoint.path}`,
        { method: 'GET', headers: authHeaders },
        timeoutMs,
      );
      const acceptable = response.status === 200 || response.status === 404;
      checks.push(
        check(
          endpoint.id,
          endpoint.label,
          acceptable,
          response.status,
          response.status === 200
            ? 'authorized'
            : response.status === 404
              ? 'authorized empty nested resource'
              : await response.text(),
        ),
      );
    }

    const finishedAt = new Date().toISOString();
    const passed = checks.every((entry) => entry.passed);
    return {
      status: passed ? 'PASS' : 'FAIL',
      startedAt,
      finishedAt,
      checks,
      error: passed ? undefined : 'One or more smoke checks failed',
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    return {
      status: 'FAIL',
      startedAt,
      finishedAt,
      checks,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

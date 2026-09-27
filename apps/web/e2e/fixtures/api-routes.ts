import type { Page, Route } from '@playwright/test';
import { EXECUTIVE_DASHBOARD_SNAPSHOT } from './executive-dashboard-snapshot';
import {
  MOCK_IDENTITY_ID,
  MOCK_SESSION_ID,
  PROBE_BILLING_RECORD_ID,
  PROBE_SERVICE_ORDER_ID,
} from './constants';
import { handleCommercialApiRoute } from './commercial-api-routes';
import { handleClientsApiRoute } from './clients-api-routes';
import { handleDocumentsApiRoute } from './documents-api-routes';
import { handleSuppliersApiRoute } from './suppliers-api-routes';

export type ApiMockProfile =
  | 'shell'
  | 'dashboard'
  | 'billing-empty'
  | 'commercial'
  | 'clients'
  | 'documents'
  | 'suppliers';

type RouteContext = {
  profile: ApiMockProfile;
};

function jsonBody(body: unknown, status = 200): { status: number; contentType: string; body: string } {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

function parseRequest(route: Route): { pathname: string; method: string; url: URL } {
  const request = route.request();
  const url = new URL(request.url());
  return { pathname: url.pathname, method: request.method(), url };
}

function authHeader(route: Route): string | null {
  return route.request().headers().authorization ?? null;
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  const payload = jsonBody(body, status);
  await route.fulfill(payload);
}

async function handleApiRoute(route: Route, context: RouteContext): Promise<void> {
  const { pathname, method } = parseRequest(route);

  if (pathname === '/api/v1/auth/login' && method === 'POST') {
    const raw = route.request().postData() ?? '{}';
    const body = JSON.parse(raw) as { login?: string; password?: string };
    if (body.password === 'Password1!') {
      await fulfillJson(route, {
        accessToken: 'visual-access-token',
        refreshToken: 'visual-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 900,
        session: { id: MOCK_SESSION_ID, expiresAt: '2026-08-29T12:00:00.000Z', status: 'active' },
      });
      return;
    }
    await fulfillJson(route, { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials.' } }, 401);
    return;
  }

  if (pathname === '/api/v1/auth/session' && method === 'GET') {
    const auth = authHeader(route);
    if (auth?.startsWith('Bearer ')) {
      await fulfillJson(route, {
        identityId: MOCK_IDENTITY_ID,
        session: { id: MOCK_SESSION_ID, expiresAt: '2026-08-29T12:00:00.000Z', status: 'active' },
      });
      return;
    }
    await fulfillJson(route, { error: { code: 'AUTH_UNAUTHORIZED', message: 'Unauthorized.' } }, 401);
    return;
  }

  if (pathname === '/api/v1/auth/refresh' && method === 'POST') {
    await fulfillJson(route, {
      accessToken: 'visual-access-token-2',
      refreshToken: 'visual-refresh-token-2',
      tokenType: 'Bearer',
      expiresIn: 900,
      session: { id: MOCK_SESSION_ID, expiresAt: '2026-08-29T12:00:00.000Z', status: 'active' },
    });
    return;
  }

  if (pathname === '/api/v1/auth/logout' && method === 'POST') {
    await fulfillJson(route, { success: true });
    return;
  }

  if (pathname === '/api/v1/auth/logout-all' && method === 'POST') {
    await fulfillJson(route, { success: true });
    return;
  }

  if (context.profile === 'commercial' && (await handleCommercialApiRoute(route))) {
    return;
  }

  if (context.profile === 'clients' && (await handleClientsApiRoute(route))) {
    return;
  }

  if (context.profile === 'documents' && (await handleDocumentsApiRoute(route))) {
    return;
  }

  if (context.profile === 'suppliers' && (await handleSuppliersApiRoute(route))) {
    return;
  }

  if (pathname === '/api/v1/authz/probe' && method === 'GET') {
    await fulfillJson(route, {
      status: 'ok',
      identityId: MOCK_IDENTITY_ID,
      sessionId: MOCK_SESSION_ID,
    });
    return;
  }

  if (pathname === '/api/v1/alerts/summary' && method === 'GET') {
    await fulfillJson(route, { activeCount: context.profile === 'dashboard' ? 1 : 0 });
    return;
  }

  if (pathname === '/api/v1/alerts' && method === 'GET') {
    await fulfillJson(route, []);
    return;
  }

  if (pathname.startsWith('/api/v1/search') && method === 'GET') {
    await fulfillJson(route, {
      query: { raw: 'test', kind: 'text' },
      groups: [],
      pagination: { limit: 20, offset: 0, hasMore: false },
      allowedTypes: ['CLIENT'],
    });
    return;
  }

  if (pathname.startsWith('/api/v1/reports/catalog') && method === 'GET') {
    await fulfillJson(route, [
      {
        reportType: 'SERVICE_ORDERS_BY_PERIOD',
        label: 'OS por período',
        formats: ['CSV'],
        sensitive: false,
        columns: ['Número OS', 'Unidade', 'Cliente', 'Status', 'Criada em', 'Concluída em'],
      },
    ]);
    return;
  }

  if (pathname.startsWith('/api/v1/reports/exports/preview') && method === 'GET') {
    await fulfillJson(route, {
      contract: {
        name: 'OS por período',
        filters: { period: 'month' },
        columns: ['Número OS'],
        sort: { field: 'createdAt', direction: 'DESC' },
        timezone: 'America/Porto_Velho',
        generatedAt: null,
        actor: { identityId: MOCK_IDENTITY_ID, sessionId: MOCK_SESSION_ID },
        scope: { summary: 'scoped_by_existing_grants' },
      },
      preview: [],
      total: 0,
    });
    return;
  }

  if (pathname === '/api/v1/reports/exports' && method === 'POST') {
    await fulfillJson(route, {
      id: 'export-visual',
      reportType: 'SERVICE_ORDERS_BY_PERIOD',
      format: 'CSV',
      status: 'COMPLETED',
      rowCount: 0,
      fileSizeBytes: 0,
      errorMessage: null,
      createdAt: '2026-08-29T12:00:00.000Z',
      completedAt: '2026-08-29T12:00:00.000Z',
      downloadReady: false,
    });
    return;
  }

  if (pathname.startsWith('/api/v1/dashboard/executive') && method === 'GET') {
    if (context.profile === 'dashboard' || context.profile === 'billing-empty') {
      await fulfillJson(route, EXECUTIVE_DASHBOARD_SNAPSHOT);
      return;
    }
    await fulfillJson(route, {
      generatedAt: '2026-08-29T12:00:00.000Z',
      businessTimezone: 'America/Porto_Velho',
      period: { preset: 'week', from: '2026-08-23', to: '2026-08-29' },
      visibility: {
        serviceRequests: true,
        serviceOrders: false,
        measurements: false,
        billing: false,
        documents: false,
        resources: false,
        productivity: false,
        financialAging: false,
      },
      attention: [],
      charts: {
        serviceOrdersByStatus: { title: '', description: '', items: [], summary: '' },
        throughputTrend: { title: '', description: '', points: [], summary: '' },
        sla: { title: '', description: '', points: [], summary: '' },
        financialAging: { available: false, title: '', description: '', buckets: [], summary: '' },
      },
      productivity: null,
      shortcuts: [],
    });
    return;
  }

  if (pathname === '/api/v1/dashboard/operational' && method === 'GET') {
    await fulfillJson(route, {
      generatedAt: '2026-08-29T12:00:00.000Z',
      visibility: {
        serviceRequests: true,
        serviceOrders: false,
        measurements: false,
        billing: false,
        documents: false,
        resources: false,
      },
      attention: [],
      operation: [],
      deadlines: [],
      finance: [],
      shortcuts: [],
    });
    return;
  }

  if (pathname === '/api/v1/clients' && method === 'GET') {
    await fulfillJson(route, { error: { code: 'CLIENT_DENIED', message: 'Forbidden.' } }, 403);
    return;
  }

  if (pathname.startsWith('/api/v1/clients/') && (method === 'GET' || method === 'PATCH' || method === 'POST')) {
    await fulfillJson(route, { error: { code: 'CLIENT_DENIED', message: 'Forbidden.' } }, method === 'GET' ? 404 : 403);
    return;
  }

  if (pathname === '/api/v1/catalog/service-definitions' && method === 'GET') {
    await fulfillJson(route, { error: { code: 'CATALOG_DENIED', message: 'Forbidden.' } }, 403);
    return;
  }

  if (pathname === '/api/v1/resources/physical-assets' && method === 'GET') {
    await fulfillJson(route, { error: { code: 'ASSET_DENIED', message: 'Forbidden.' } }, 403);
    return;
  }

  if (pathname.startsWith('/api/v1/requests/service-requests') && method === 'GET') {
    await fulfillJson(route, { items: [], total: 0 });
    return;
  }

  const probeBillingBase = `/api/v1/service-orders/${PROBE_SERVICE_ORDER_ID}/billing-records`;
  if (pathname === probeBillingBase && method === 'GET') {
    await fulfillJson(route, null);
    return;
  }
  if (pathname === probeBillingBase && method === 'POST') {
    await fulfillJson(route, { code: 'BILLING_DENIED' }, 403);
    return;
  }
  if (pathname === `${probeBillingBase}/${PROBE_BILLING_RECORD_ID}/void` && method === 'POST') {
    await fulfillJson(route, { code: 'BILLING_DENIED' }, 403);
    return;
  }

  if (pathname === '/api/v1/service-orders' && method === 'GET') {
    await fulfillJson(route, { items: [], total: 0, limit: 20, offset: 0 });
    return;
  }

  await fulfillJson(route, { error: { code: 'UNKNOWN', message: 'Not found' } }, 404);
}

export async function installApiMocks(page: Page, profile: ApiMockProfile = 'shell'): Promise<void> {
  const context: RouteContext = { profile };
  await page.route('**/api/v1/**', async (route) => {
    await handleApiRoute(route, context);
  });
}

import { vi } from 'vitest';
import { parseRequestPath } from './request-url';

export const MOCK_IDENTITY_ID = '11111111-1111-4111-8111-111111111111';
export const MOCK_SESSION_ID = '22222222-2222-4222-8222-222222222222';

/** Unidade autorizada do ator no mock — a mesma que a navegacao usa para sondar fiscal/contabil. */
export const MOCK_UNIT_ID = 'UN-DEV-001';

export type ShellFetchMockOptions = {
  probeAllowed?: boolean;
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

export function createShellFetchMock(options: ShellFetchMockOptions = {}) {
  const probeAllowed = options.probeAllowed ?? true;

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, pathname } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/v1/auth/login') && method === 'POST') {
      const rawBody = init?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
        login: string;
        password: string;
      };
      if (body.password === 'Password1!') {
        return jsonResponse({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          tokenType: 'Bearer',
          expiresIn: 900,
          session: { id: MOCK_SESSION_ID, expiresAt: new Date().toISOString(), status: 'active' },
        });
      }
      return jsonResponse(
        { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials.' } },
        401,
      );
    }

    if (url.endsWith('/api/v1/auth/session') && method === 'GET') {
      const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
      if (auth === 'Bearer expired-token') {
        return jsonResponse({ error: { code: 'AUTH_SESSION_EXPIRED', message: 'Expired.' } }, 401);
      }
      if (auth?.startsWith('Bearer ')) {
        return jsonResponse({
          identityId: MOCK_IDENTITY_ID,
          session: { id: MOCK_SESSION_ID, expiresAt: new Date().toISOString(), status: 'active' },
        });
      }
      return jsonResponse({ error: { code: 'AUTH_UNAUTHORIZED', message: 'Unauthorized.' } }, 401);
    }

    if (url.endsWith('/api/v1/auth/refresh') && method === 'POST') {
      return jsonResponse({
        accessToken: 'access-token-2',
        refreshToken: 'refresh-token-2',
        tokenType: 'Bearer',
        expiresIn: 900,
        session: { id: MOCK_SESSION_ID, expiresAt: new Date().toISOString(), status: 'active' },
      });
    }

    if (url.endsWith('/api/v1/auth/logout') && method === 'POST') {
      return jsonResponse({ success: true });
    }

    if (url.endsWith('/api/v1/auth/logout-all') && method === 'POST') {
      return jsonResponse({ success: true });
    }

    if (url.endsWith('/api/v1/authz/probe') && method === 'GET') {
      if (!probeAllowed) {
        return jsonResponse({ error: { code: 'AUTHZ_FORBIDDEN', message: 'Forbidden.' } }, 403);
      }
      return jsonResponse({
        status: 'ok',
        identityId: MOCK_IDENTITY_ID,
        sessionId: MOCK_SESSION_ID,
      });
    }

    if (url.includes('/api/v1/alerts/summary') && method === 'GET') {
      return jsonResponse({ activeCount: 0 });
    }

    if (url.includes('/api/v1/alerts') && method === 'GET') {
      return jsonResponse([]);
    }

    if (url.includes('/api/v1/search') && method === 'GET') {
      return jsonResponse({
        query: { raw: 'test', kind: 'text' },
        groups: [],
        pagination: { limit: 20, offset: 0, hasMore: false },
        allowedTypes: ['CLIENT'],
      });
    }

    if (pathname === '/api/v1/service-orders' && method === 'GET') {
      return jsonResponse({ items: [], total: 0, limit: 1, offset: 0 });
    }

    if (pathname === '/api/v1/requests/service-requests' && method === 'GET') {
      return jsonResponse({ items: [], limit: 1, offset: 0 });
    }

    /**
     * ESCOPO DE UNIDADE — a lista que a navegacao resolve ANTES das sondas que exigem unidade.
     *
     * Sem esta rota o mock devolvia 404, `resolveAuthorizedUnit` caia em `''` e toda superficie
     * fiscal/contabil resolvia `undetermined` — o que escondia itens por um motivo DIFERENTE do
     * que os testes de contrato querem medir.
     */
    if (pathname === '/api/v1/requests/service-requests/operational-units' && method === 'GET') {
      return jsonResponse({ items: [MOCK_UNIT_ID] });
    }

    /**
     * FINANCEIRO — modela o DEFEITO REAL medido em HML, nao um estado inventado.
     *
     * O menu sondava o DETALHE com UUID sintetico e recebia 404; para aquele codigo, 404
     * significava "a rota existe, o registro e que nao" e o item ficava VISIVEL. A pagina pedia
     * a LISTA e recebia 403 FINANCE_DENIED. Resultado: menu mostrava Despesas e Orcamentos e a
     * pagina negava.
     *
     * Os dois status sao reproduzidos fielmente — e e essa ASSIMETRIA que da poder ao teste de
     * contrato: um mapa antigo gravado com a regra do 404 mostra o item; a resolucao nova, que
     * pergunta pela lista, o esconde.
     */
    if (pathname.startsWith('/api/v1/finance/expenses/') && method === 'GET') {
      return jsonResponse(
        { error: { code: 'FINANCE_EXPENSE_NOT_FOUND', message: 'Not found.' } },
        404,
      );
    }
    if (pathname.startsWith('/api/v1/finance/budgets/') && method === 'GET') {
      return jsonResponse(
        { error: { code: 'FINANCE_BUDGET_NOT_FOUND', message: 'Not found.' } },
        404,
      );
    }
    if (pathname === '/api/v1/finance/expenses' && method === 'GET') {
      return jsonResponse({ error: { code: 'FINANCE_DENIED', message: 'Forbidden.' } }, 403);
    }
    if (pathname === '/api/v1/finance/budgets' && method === 'GET') {
      return jsonResponse({ error: { code: 'FINANCE_DENIED', message: 'Forbidden.' } }, 403);
    }

    if (pathname === '/api/v1/analytics/operational-profitability' && method === 'GET') {
      return jsonResponse({
        generatedAt: new Date().toISOString(),
        businessTimezone: 'America/Porto_Velho',
        period: { preset: 'week', from: '2026-08-23', to: '2026-08-29', fromInclusive: '', toExclusive: '' },
        groupBy: 'none',
        visibility: { revenue: true, costs: true },
        summary: {
          operationalRevenue: '0',
          realizedCost: '0',
          operationalMargin: '0',
          revenueSupportedCount: 0,
          costSupportedCount: 0,
          marginComputableCount: 0,
          serviceOrderCount: 0,
          formula: 'operational_revenue - realized_cost = operational_margin',
          disclaimer: 'Operational profitability is indicative and not official accounting.',
          currencyCode: 'BRL',
        },
        groups: [],
        lines: [],
      });
    }

    if (url.includes('/api/v1/reports/catalog') && method === 'GET') {
      return jsonResponse([
        {
          reportType: 'SERVICE_ORDERS_BY_PERIOD',
          label: 'OS por período',
          formats: ['CSV'],
          sensitive: false,
          columns: ['Número OS', 'Unidade', 'Cliente', 'Status', 'Criada em', 'Concluída em'],
        },
      ]);
    }

    if (url.includes('/api/v1/reports/exports/preview') && method === 'GET') {
      return jsonResponse({
        contract: {
          name: 'OS por período',
          filters: { period: 'month' },
          columns: ['Número OS', 'Unidade', 'Cliente', 'Status', 'Criada em', 'Concluída em'],
          sort: { field: 'createdAt', direction: 'DESC' },
          timezone: 'America/Porto_Velho',
          generatedAt: null,
          actor: { identityId: MOCK_IDENTITY_ID, sessionId: MOCK_SESSION_ID },
          scope: { summary: 'scoped_by_existing_grants' },
        },
        preview: [
          {
            orderNumber: 'SO-001',
            unitId: 'unit-a',
            clientName: 'Cliente Alfa',
            status: 'PREPARED',
            createdAt: '2026-08-29T12:00:00.000Z',
            completedAt: null,
          },
        ],
        total: 1,
      });
    }

    if (url.includes('/api/v1/reports/exports') && method === 'POST') {
      return jsonResponse({
        id: 'export-1',
        reportType: 'SERVICE_ORDERS_BY_PERIOD',
        format: 'CSV',
        status: 'COMPLETED',
        contract: {
          name: 'OS por período',
          filters: { period: 'month' },
          columns: ['Número OS'],
          sort: { field: 'createdAt', direction: 'DESC' },
          timezone: 'America/Porto_Velho',
          generatedAt: new Date().toISOString(),
          actor: { identityId: MOCK_IDENTITY_ID, sessionId: MOCK_SESSION_ID },
          scope: { summary: 'scoped_by_existing_grants' },
        },
        rowCount: 1,
        fileSizeBytes: 128,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        downloadReady: true,
      });
    }

    if (url.includes('/api/v1/dashboard/executive') && method === 'GET') {
      return jsonResponse({
        generatedAt: new Date().toISOString(),
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
    }

    if (url.endsWith('/api/v1/dashboard/operational') && method === 'GET') {
      return jsonResponse({
        generatedAt: new Date().toISOString(),
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
    }

    if (pathname === '/api/v1/clients' && method === 'GET') {
      return jsonResponse({ error: { code: 'CLIENT_DENIED', message: 'Forbidden.' } }, 403);
    }

    if (pathname === '/api/v1/catalog/service-definitions' && method === 'GET') {
      return jsonResponse({ error: { code: 'CATALOG_DENIED', message: 'Forbidden.' } }, 403);
    }

    if (pathname === '/api/v1/resources/physical-assets' && method === 'GET') {
      return jsonResponse({ error: { code: 'ASSET_DENIED', message: 'Forbidden.' } }, 403);
    }

    if (pathname.startsWith('/api/v1/clients/') && method === 'GET') {
      return jsonResponse({ error: { code: 'CLIENT_NOT_FOUND', message: 'Not found.' } }, 404);
    }

    if (pathname.startsWith('/api/v1/clients/') && (method === 'PATCH' || method === 'POST')) {
      return jsonResponse({ error: { code: 'CLIENT_DENIED', message: 'Forbidden.' } }, 403);
    }

    return jsonResponse({ error: { code: 'UNKNOWN', message: 'Not found' } }, 404);
  });
}

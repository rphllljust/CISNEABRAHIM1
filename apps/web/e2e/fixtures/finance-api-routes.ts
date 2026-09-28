import type { Route } from '@playwright/test';

type JsonResponse = { status: number; contentType: string; body: string };

function jsonBody(body: unknown, status = 200): JsonResponse {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill(jsonBody(body, status));
}

function hasBearerToken(route: Route): boolean {
  return route.request().headers().authorization?.startsWith('Bearer ') ?? false;
}

const EXPENSES = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    unitId: 'unit-1',
    description: 'Combustível da frota',
    costCenterCode: 'CC-OPER',
    totalAmount: '1840',
    currencyCode: 'BRL',
    dueDate: '2026-10-05',
    status: 'SUBMITTED',
    version: 2,
    createdAt: '2026-09-20T12:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    unitId: 'unit-1',
    description: 'Peças de reposição',
    costCenterCode: 'CC-MANUT',
    totalAmount: '620',
    currencyCode: 'BRL',
    dueDate: '2026-10-12',
    status: 'DRAFT',
    version: 1,
    createdAt: '2026-09-19T12:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    unitId: 'unit-1',
    description: 'Serviço de terceiros',
    costCenterCode: 'CC-ADM',
    totalAmount: '4300',
    currencyCode: 'BRL',
    dueDate: '2026-10-20',
    status: 'APPROVED',
    version: 3,
    createdAt: '2026-09-18T12:00:00.000Z',
  },
];

const BUDGETS = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    unitId: 'unit-1',
    code: 'ORC-2026-OPER',
    name: 'Operação 2026',
    currencyCode: 'BRL',
    status: 'ACTIVE',
    rowVersion: 2,
    updatedAt: '2026-09-20T12:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    unitId: 'unit-1',
    code: 'ORC-2026-MANUT',
    name: 'Manutenção 2026',
    currencyCode: 'BRL',
    status: 'INACTIVE',
    rowVersion: 1,
    updatedAt: '2026-09-15T12:00:00.000Z',
  },
];

function pageOf<T>(items: T[], route: Route, matches: (item: T, q: string) => boolean): Record<string, unknown> {
  const searchParams = new URL(route.request().url()).searchParams;
  const limit = Number(searchParams.get('limit') ?? '20');
  const offset = Number(searchParams.get('offset') ?? '0');
  const q = searchParams.get('q')?.trim().toLowerCase() ?? '';
  const matched = q.length === 0 ? items : items.filter((item) => matches(item, q));
  return {
    items: matched.slice(offset, offset + limit),
    limit,
    offset,
    total: matched.length,
    totalPages: matched.length > 0 ? 1 : 0,
  };
}

/**
 * Tráfego determinístico da superfície Financeira finalizada nesta frente (Despesas e Orçamentos).
 * Devolve `false` quando a rota não pertence a esta fixture.
 */
export async function handleFinanceApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();

  if (!pathname.startsWith('/api/v1/finance')) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'FINANCE_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  if (method === 'GET') {
    if (pathname === '/api/v1/finance/expenses') {
      await fulfillJson(
        route,
        pageOf(EXPENSES, route, (item, q) =>
          item.description.toLowerCase().includes(q) || item.costCenterCode.toLowerCase().includes(q),
        ),
      );
      return true;
    }
    if (pathname === '/api/v1/finance/budgets') {
      await fulfillJson(
        route,
        pageOf(BUDGETS, route, (item, q) =>
          item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q),
        ),
      );
      return true;
    }
  }

  // Sondas de capability: 404 (e não 403) é o que faz a sonda concluir que a capability existe.
  await fulfillJson(route, { error: { code: 'FINANCE_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}

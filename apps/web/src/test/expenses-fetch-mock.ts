import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { createShellFetchMock } from './shell-fetch-mock';

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
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createExpensesFetchMock(options: { denied?: boolean } = {}) {
  const shellMock = createShellFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const { pathname, searchParams } = parseRequestPath(input);

    if (pathname === '/api/v1/finance/expenses' && method === 'GET') {
      if (options.denied) {
        return jsonResponse({ error: { code: 'FINANCE_DENIED' } }, 403);
      }
      const limit = Number(searchParams.get('limit') ?? '20');
      const offset = Number(searchParams.get('offset') ?? '0');
      const status = searchParams.get('status');
      const q = searchParams.get('q')?.trim().toLowerCase() ?? '';
      let items = EXPENSES;
      if (status) {
        items = items.filter((expense) => expense.status === status);
      }
      if (q) {
        items = items.filter(
          (expense) =>
            expense.description.toLowerCase().includes(q) ||
            expense.costCenterCode.toLowerCase().includes(q),
        );
      }
      return jsonResponse({
        items: items.slice(offset, offset + limit),
        limit,
        offset,
        total: items.length,
        totalPages: items.length > 0 ? 1 : 0,
      });
    }

    if (pathname.startsWith('/api/v1/finance/expenses')) {
      return jsonResponse({ error: { code: 'FINANCE_EXPENSE_NOT_FOUND' } }, 404);
    }

    return shellMock(input, init);
  });
}

export const EXPENSES_TEST_DATA = { EXPENSES };

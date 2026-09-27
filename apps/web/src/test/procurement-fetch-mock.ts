import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { createShellFetchMock } from './shell-fetch-mock';

const REQUESTS = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    unitId: 'unit-1',
    justification: 'Reposicao de insumos',
    currencyCode: 'BRL',
    status: 'PENDING_APPROVAL',
    version: 2,
    lineCount: 1,
    totalAmount: '100',
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    unitId: 'unit-1',
    justification: 'Manutencao de frota',
    currencyCode: 'BRL',
    status: 'DRAFT',
    version: 1,
    lineCount: 2,
    totalAmount: '250',
    createdAt: '2026-09-19T12:00:00.000Z',
    updatedAt: '2026-09-19T12:00:00.000Z',
  },
];

const ORDERS = [
  {
    id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    requestId: REQUESTS[0]!.id,
    supplierId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    supplierName: 'Alfa Insumos',
    supplierTaxId: '11222333000181',
    unitId: 'unit-1',
    currencyCode: 'BRL',
    paymentTerms: '30 DDL',
    status: 'PARTIALLY_RECEIVED',
    version: 3,
    lineCount: 1,
    totalAmount: '100',
    receivedQuantity: '40',
    issuedAt: '2026-09-22T12:00:00.000Z',
    updatedAt: '2026-09-23T12:00:00.000Z',
  },
];

const INVOICES = [
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    unitId: 'unit-1',
    supplierId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    supplierName: 'Alfa Insumos',
    supplierTaxId: '11222333000181',
    invoiceNumber: 'NF-1001',
    issuedOn: '2026-09-22',
    dueDate: '2026-10-22',
    currencyCode: 'BRL',
    totalAmount: '100',
    status: 'DRAFT',
    version: 1,
    payableId: null,
    supplierPurchaseOrderId: ORDERS[0]!.id,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function page<T>(items: T[], searchParams: URLSearchParams, matches?: (item: T, q: string) => boolean): {
  items: T[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
} {
  const limit = Number(searchParams.get('limit') ?? '20');
  const offset = Number(searchParams.get('offset') ?? '0');
  const q = searchParams.get('q')?.trim() ?? '';
  const filtered = q.length > 0 && matches ? items.filter((item) => matches(item, q)) : items;
  return { items: filtered.slice(offset, offset + limit), limit, offset, total: filtered.length, totalPages: 1 };
}

export type ProcurementFetchMockOptions = {
  denied?: boolean;
};

/**
 * Tráfego determinístico do módulo de Compras. A sessão vem do mock de shell: sem ela o
 * AuthProvider expira a sessão e nenhuma lista chega ao servidor (falso "sem dados").
 */
export function createProcurementFetchMock(options: ProcurementFetchMockOptions = {}) {
  const shellMock = createShellFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const { pathname, searchParams } = parseRequestPath(input);

    if (pathname.endsWith('/procurement/requests') && method === 'GET') {
      if (options.denied) {
        return jsonResponse({ error: { code: 'PROCUREMENT_DENIED' } }, 403);
      }
      return jsonResponse(
        page(REQUESTS, searchParams, (item, q) =>
          item.justification.toLowerCase().includes(q.toLowerCase()),
        ),
      );
    }

    if (pathname.endsWith('/procurement/orders') && method === 'GET') {
      if (options.denied) {
        return jsonResponse({ error: { code: 'PROCUREMENT_DENIED' } }, 403);
      }
      return jsonResponse(
        page(ORDERS, searchParams, (item, q) =>
          (item.supplierName ?? '').toLowerCase().includes(q.toLowerCase()),
        ),
      );
    }

    if (pathname.endsWith('/supplier-invoices') && method === 'GET') {
      if (options.denied) {
        return jsonResponse({ error: { code: 'PROCUREMENT_DENIED' } }, 403);
      }
      return jsonResponse(
        page(INVOICES, searchParams, (item, q) =>
          item.invoiceNumber.toLowerCase().includes(q.toLowerCase()),
        ),
      );
    }

    if (pathname.includes('/procurement') || pathname.includes('/supplier-invoices')) {
      return jsonResponse({ error: { code: 'PROCUREMENT_NOT_FOUND' } }, 404);
    }

    return shellMock(input, init);
  });
}

export const PROCUREMENT_TEST_DATA = { REQUESTS, ORDERS, INVOICES };

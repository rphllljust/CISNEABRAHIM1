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

const REQUESTS = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    unitId: 'unit-1',
    justification: 'Reposicao de insumos criticos',
    currencyCode: 'BRL',
    status: 'PENDING_APPROVAL',
    version: 2,
    lineCount: 2,
    totalAmount: '1840',
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    unitId: 'unit-1',
    justification: 'Manutencao preventiva de frota',
    currencyCode: 'BRL',
    status: 'APPROVED',
    version: 3,
    lineCount: 1,
    totalAmount: '620',
    createdAt: '2026-09-19T12:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z',
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
    version: 4,
    lineCount: 2,
    totalAmount: '1840',
    receivedQuantity: '40',
    issuedAt: '2026-09-22T12:00:00.000Z',
    updatedAt: '2026-09-23T12:00:00.000Z',
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
    requestId: REQUESTS[1]!.id,
    supplierId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    supplierName: 'Delta Lub',
    supplierTaxId: '77888999000144',
    unitId: 'unit-1',
    currencyCode: 'BRL',
    paymentTerms: 'A vista',
    status: 'ISSUED',
    version: 1,
    lineCount: 1,
    totalAmount: '620',
    receivedQuantity: '0',
    issuedAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
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
    totalAmount: '1840',
    status: 'DRAFT',
    version: 1,
    payableId: null,
    supplierPurchaseOrderId: ORDERS[0]!.id,
  },
];

function searchParamsOf(route: Route): URLSearchParams {
  return new URL(route.request().url()).searchParams;
}

function pageOf<T>(items: T[], route: Route): Record<string, unknown> {
  const searchParams = searchParamsOf(route);
  const limit = Number(searchParams.get('limit') ?? '20');
  const offset = Number(searchParams.get('offset') ?? '0');
  const q = searchParams.get('q')?.trim().toLowerCase() ?? '';
  const matched = q.length === 0 ? items : items.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
  return {
    items: matched.slice(offset, offset + limit),
    limit,
    offset,
    total: matched.length,
    totalPages: matched.length > 0 ? 1 : 0,
  };
}

/**
 * Tráfego determinístico da superfície de Compras para a validação visual focada: as três listas
 * operacionais (solicitações, pedidos ao fornecedor, notas). Devolve `false` quando a rota não
 * pertence a esta fixture.
 */
export async function handleProcurementApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();

  const owned =
    pathname.startsWith('/api/v1/procurement') || pathname.startsWith('/api/v1/supplier-invoices');
  if (!owned) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'PROCUREMENT_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  if (pathname === '/api/v1/procurement/requests' && method === 'GET') {
    await fulfillJson(route, pageOf(REQUESTS, route));
    return true;
  }

  if (pathname === '/api/v1/procurement/orders' && method === 'GET') {
    await fulfillJson(route, pageOf(ORDERS, route));
    return true;
  }

  if (pathname === '/api/v1/supplier-invoices' && method === 'GET') {
    await fulfillJson(route, pageOf(INVOICES, route));
    return true;
  }

  // Sondas de capability e detalhes: 404 (não 403) é o que faz a sonda concluir que a capability
  // existe, mantendo visível a entrada "Nova solicitação".
  await fulfillJson(route, { error: { code: 'PROCUREMENT_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}

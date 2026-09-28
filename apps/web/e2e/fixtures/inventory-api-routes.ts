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

const WAREHOUSES = [
  { id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', unitId: 'unit-1', code: 'WH-CENTRAL', name: 'Depósito Central', status: 'ACTIVE' },
  { id: 'ffffffff-ffff-4fff-8fff-fffffffffff2', unitId: 'unit-1', code: 'WH-NORTE', name: 'Depósito Norte', status: 'ACTIVE' },
  { id: 'ffffffff-ffff-4fff-8fff-fffffffffff3', unitId: 'unit-1', code: 'WH-SUL', name: 'Depósito Sul', status: 'INACTIVE' },
];

const ITEMS = [
  { id: '99999999-9999-4999-8999-999999999991', unitId: 'unit-1', sku: 'SKU-CABO-10', name: 'Cabo de aço 10mm', status: 'ACTIVE' },
  { id: '99999999-9999-4999-8999-999999999992', unitId: 'unit-1', sku: 'SKU-MANILHA', name: 'Manilha forjada 5/8', status: 'ACTIVE' },
];

const MOVEMENTS = [
  {
    id: '88888888-8888-4888-8888-888888888881',
    warehouseId: WAREHOUSES[0]!.id,
    inventoryItemId: ITEMS[0]!.id,
    movementType: 'IN',
    quantity: '25',
    signedQuantity: '25',
    occurredOn: '2026-09-02',
    unitCost: '10',
    totalCost: '250',
    status: 'POSTED',
    description: 'Recebimento inicial',
    warehouseCode: 'WH-CENTRAL',
    warehouseName: 'Depósito Central',
    itemSku: 'SKU-CABO-10',
    itemName: 'Cabo de aço 10mm',
  },
  {
    id: '88888888-8888-4888-8888-888888888882',
    warehouseId: WAREHOUSES[1]!.id,
    inventoryItemId: ITEMS[1]!.id,
    movementType: 'OUT',
    quantity: '4',
    signedQuantity: '-4',
    occurredOn: '2026-09-03',
    unitCost: null,
    totalCost: null,
    status: 'POSTED',
    description: 'Saída para a OS 1042',
    warehouseCode: 'WH-NORTE',
    warehouseName: 'Depósito Norte',
    itemSku: 'SKU-MANILHA',
    itemName: 'Manilha forjada 5/8',
  },
];

const RESERVATIONS = [
  {
    id: '77777777-7777-4777-8777-777777777771',
    unitId: 'unit-1',
    warehouseId: WAREHOUSES[0]!.id,
    inventoryItemId: ITEMS[0]!.id,
    quantity: '5',
    status: 'ACTIVE',
    warehouseCode: 'WH-CENTRAL',
    warehouseName: 'Depósito Central',
    itemSku: 'SKU-CABO-10',
    itemName: 'Cabo de aço 10mm',
  },
];

function pageOf<T>(items: T[], route: Route): Record<string, unknown> {
  const searchParams = new URL(route.request().url()).searchParams;
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
 * Tráfego determinístico da superfície de Estoque para a validação visual focada: as quatro listas
 * operacionais. Devolve `false` quando a rota não pertence a esta fixture.
 */
export async function handleInventoryApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();

  if (!pathname.startsWith('/api/v1/inventory')) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'INVENTORY_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  if (method === 'GET') {
    if (pathname === '/api/v1/inventory/warehouses') {
      await fulfillJson(route, pageOf(WAREHOUSES, route));
      return true;
    }
    if (pathname === '/api/v1/inventory/items') {
      await fulfillJson(route, pageOf(ITEMS, route));
      return true;
    }
    if (pathname === '/api/v1/inventory/movements') {
      await fulfillJson(route, pageOf(MOVEMENTS, route));
      return true;
    }
    if (pathname === '/api/v1/inventory/reservations') {
      await fulfillJson(route, pageOf(RESERVATIONS, route));
      return true;
    }
  }

  await fulfillJson(route, { error: { code: 'INVENTORY_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}

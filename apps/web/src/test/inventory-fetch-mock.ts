import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { createShellFetchMock } from './shell-fetch-mock';

const WAREHOUSES = [
  { id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', unitId: 'unit-1', code: 'WH-ORIGIN', name: 'Depósito Central', status: 'ACTIVE' },
  { id: 'ffffffff-ffff-4fff-8fff-fffffffffff2', unitId: 'unit-1', code: 'WH-DEST', name: 'Depósito Norte', status: 'ACTIVE' },
];

const ITEMS = [
  {
    id: '99999999-9999-4999-8999-999999999991',
    unitId: 'unit-1',
    sku: 'SKU-CABO-10',
    name: 'Cabo de aço 10mm',
    status: 'ACTIVE',
    costingMethodStatus: 'UNDECIDED',
  },
];

const MOVEMENTS = [
  {
    id: '88888888-8888-4888-8888-888888888881',
    warehouseId: WAREHOUSES[0]!.id,
    inventoryItemId: ITEMS[0]!.id,
    movementType: 'IN',
    quantity: '25',
    signedQuantity: '25',
    counterpartWarehouseId: null,
    transferGroupId: null,
    transferLeg: null,
    reservationId: null,
    commandIdempotencyKey: 'cmd-1',
    occurredOn: '2026-09-02',
    unitCost: '10',
    totalCost: '250',
    costingRuleVersionId: null,
    originKind: null,
    status: 'POSTED',
    description: 'Recebimento inicial',
    warehouseCode: 'WH-ORIGIN',
    warehouseName: 'Depósito Central',
    itemSku: 'SKU-CABO-10',
    itemName: 'Cabo de aço 10mm',
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
    idempotencyKey: 'res-1',
    warehouseCode: 'WH-ORIGIN',
    warehouseName: 'Depósito Central',
    itemSku: 'SKU-CABO-10',
    itemName: 'Cabo de aço 10mm',
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function page<T>(items: T[], searchParams: URLSearchParams): Record<string, unknown> {
  const limit = Number(searchParams.get('limit') ?? '20');
  const offset = Number(searchParams.get('offset') ?? '0');
  const status = searchParams.get('status');
  const filtered = status ? items.filter((item) => (item as { status?: string }).status === status) : items;
  return { items: filtered.slice(offset, offset + limit), limit, offset, total: filtered.length, totalPages: 1 };
}

export type InventoryFetchMockOptions = { denied?: boolean };

/** Tráfego determinístico do Estoque. A sessão vem do mock de shell. */
export function createInventoryFetchMock(options: InventoryFetchMockOptions = {}) {
  const shellMock = createShellFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const { pathname, searchParams } = parseRequestPath(input);

    const listed =
      pathname.endsWith('/inventory/warehouses') ||
      pathname.endsWith('/inventory/items') ||
      pathname.endsWith('/inventory/movements') ||
      pathname.endsWith('/inventory/reservations');

    if (listed && method === 'GET') {
      if (options.denied) {
        return jsonResponse({ error: { code: 'INVENTORY_DENIED' } }, 403);
      }
      if (pathname.endsWith('/inventory/warehouses')) {
        return jsonResponse(page(WAREHOUSES, searchParams));
      }
      if (pathname.endsWith('/inventory/items')) {
        return jsonResponse(page(ITEMS, searchParams));
      }
      if (pathname.endsWith('/inventory/movements')) {
        return jsonResponse(page(MOVEMENTS, searchParams));
      }
      return jsonResponse(page(RESERVATIONS, searchParams));
    }

    if (pathname.includes('/inventory')) {
      return jsonResponse({ error: { code: 'INVENTORY_NOT_FOUND' } }, 404);
    }

    return shellMock(input, init);
  });
}

export const INVENTORY_TEST_DATA = { WAREHOUSES, ITEMS, MOVEMENTS, RESERVATIONS };

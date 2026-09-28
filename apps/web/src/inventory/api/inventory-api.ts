import {
  authHeaders,
  BACKOFFICE_PROBE_ID,
  jsonHeaders,
  probeReadAccess,
  requestJson,
} from '../../financial-ui/enterprise-api';

export type StockBalance = {
  warehouseId: string;
  inventoryItemId: string;
  onHand: string;
  reserved: string;
  available: string;
};

export type StockMovement = {
  id: string;
  warehouseId: string;
  inventoryItemId: string;
  movementType: string;
  quantity: string;
  signedQuantity: string;
  counterpartWarehouseId: string | null;
  transferGroupId: string | null;
  transferLeg: string | null;
  reservationId: string | null;
  commandIdempotencyKey: string;
  occurredOn: string;
  unitCost: string | null;
  totalCost: string | null;
  costingRuleVersionId: string | null;
  originKind: string | null;
};

export type PostStockMovementResult = {
  movements: StockMovement[];
  balance: StockBalance;
  idempotent: boolean;
};

export type StockReservation = {
  id: string;
  warehouseId: string;
  inventoryItemId: string;
  quantity: string;
  status: string;
  idempotencyKey: string;
};

export type Warehouse = { id: string; unitId: string; code: string; name: string; status: string };
export type InventoryItem = { id: string; unitId: string; sku: string; name: string; status: string };

/** Linha de movimento com as referências humanas resolvidas pelo servidor. */
export type StockMovementSummary = StockMovement & {
  status: string;
  description: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  itemSku: string | null;
  itemName: string | null;
};

export type StockReservationSummary = StockReservation & {
  unitId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  itemSku: string | null;
  itemName: string | null;
};

export type InventoryListParams = {
  limit: number;
  offset: number;
  status?: string;
  unitId?: string;
  warehouseId?: string;
  inventoryItemId?: string;
  movementType?: string;
  q?: string;
};

function listQuery(params: InventoryListParams): string {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  for (const key of ['status', 'unitId', 'warehouseId', 'inventoryItemId', 'movementType', 'q'] as const) {
    const value = params[key];
    if (value !== undefined && value.trim().length > 0) {
      search.set(key, value.trim());
    }
  }
  return search.toString();
}

export async function listWarehouses(
  params: InventoryListParams,
  signal?: AbortSignal,
): Promise<{ items: Warehouse[]; limit: number; offset: number; total: number; totalPages: number }> {
  return requestJson(`/api/v1/inventory/warehouses?${listQuery(params)}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listInventoryItems(
  params: InventoryListParams,
  signal?: AbortSignal,
): Promise<{ items: InventoryItem[]; limit: number; offset: number; total: number; totalPages: number }> {
  return requestJson(`/api/v1/inventory/items?${listQuery(params)}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listStockMovements(
  params: InventoryListParams,
  signal?: AbortSignal,
): Promise<{
  items: StockMovementSummary[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
}> {
  return requestJson(`/api/v1/inventory/movements?${listQuery(params)}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listStockReservations(
  params: InventoryListParams,
  signal?: AbortSignal,
): Promise<{
  items: StockReservationSummary[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
}> {
  return requestJson(`/api/v1/inventory/reservations?${listQuery(params)}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export function mapInventoryErrorToMessage(code: string | undefined, status: number): string {
  switch (code) {
    case 'INVENTORY_DENIED':
      return 'Você não tem permissão para esta operação de estoque.';
    case 'INVENTORY_NOT_FOUND':
      return 'Depósito, item ou saldo não encontrado.';
    case 'INVENTORY_INSUFFICIENT_STOCK':
      return 'Saldo insuficiente (decisão do servidor).';
    case 'INVENTORY_NEGATIVE_STOCK':
      return 'Estoque negativo não é autorizado para este item.';
    case 'INVENTORY_INVALID_TRANSFER':
      return 'A transferência exige um depósito de destino, distinto do depósito de origem.';
    case 'INVENTORY_INVALID_ADJUSTMENT':
      return 'O ajuste exige o efeito INCREASE ou DECREASE.';
    case 'INVENTORY_COSTING_RULE_NOT_CONFIGURED':
      return 'Nenhuma regra de custeio publicada cobre este item ou movimento.';
    case 'INVENTORY_COST_METHOD_NOT_DECIDED':
      return 'O método de custeio permanece indeciso no servidor.';
    default:
      if (status === 0) {
        return 'Não foi possível conectar ao servidor. Verifique sua conexão.';
      }
      if (status === 403) {
        return 'Você não tem permissão para esta operação de estoque.';
      }
      return 'Não foi possível concluir a operação de estoque.';
  }
}

export async function getStockBalance(
  warehouseId: string,
  inventoryItemId: string,
  signal?: AbortSignal,
): Promise<StockBalance> {
  return requestJson<StockBalance>(`/api/v1/inventory/balances/${warehouseId}/${inventoryItemId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createWarehouse(payload: Record<string, unknown>): Promise<Warehouse> {
  return requestJson<Warehouse>('/api/v1/inventory/warehouses', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function createInventoryItem(payload: Record<string, unknown>): Promise<InventoryItem> {
  return requestJson<InventoryItem>('/api/v1/inventory/items', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function postStockMovement(payload: Record<string, unknown>): Promise<PostStockMovementResult> {
  return requestJson<PostStockMovementResult>('/api/v1/inventory/movements', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function reserveStock(payload: Record<string, unknown>): Promise<StockReservation> {
  return requestJson<StockReservation>('/api/v1/inventory/reservations', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function releaseReservation(reservationId: string): Promise<StockReservation> {
  return requestJson<StockReservation>(`/api/v1/inventory/reservations/${reservationId}/release`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({}),
  });
}

export async function reverseStockMovement(payload: {
  unitId: string;
  commandIdempotencyKey: string;
  reversalKey: string;
}): Promise<PostStockMovementResult> {
  return requestJson<PostStockMovementResult>('/api/v1/inventory/movements/reverse', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export type CostingRule = { id: string; unitId: string; code: string; name: string; status: string };

export async function getCostingRule(costingRuleId: string, signal?: AbortSignal): Promise<CostingRule> {
  return requestJson<CostingRule>(`/api/v1/inventory/costing-rules/${costingRuleId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createCostingRule(payload: Record<string, unknown>): Promise<CostingRule> {
  return requestJson<CostingRule>('/api/v1/inventory/costing-rules', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function createCostingRuleVersion(
  costingRuleId: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; method: string; status: string; rowVersion: number }> {
  return requestJson(`/api/v1/inventory/costing-rules/${costingRuleId}/versions`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function publishCostingRuleVersion(
  versionId: string,
  payload: { rowVersion: number },
): Promise<unknown> {
  return requestJson(`/api/v1/inventory/costing-versions/${versionId}/publish`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function reconcileInventoryCost(
  warehouseId: string,
  inventoryItemId: string,
  signal?: AbortSignal,
): Promise<{ matches: boolean; movementCount: number }> {
  return requestJson(`/api/v1/inventory/cost-reconcile/${warehouseId}/${inventoryItemId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function reconcileStockQuantity(
  warehouseId: string,
  inventoryItemId: string,
  signal?: AbortSignal,
): Promise<{ matches: boolean; onHand: string; derivedOnHand: string }> {
  return requestJson(`/api/v1/inventory/reconcile/${warehouseId}/${inventoryItemId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function probeInventoryReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(
    `/api/v1/inventory/balances/${BACKOFFICE_PROBE_ID}/${BACKOFFICE_PROBE_ID}`,
    signal,
  );
}

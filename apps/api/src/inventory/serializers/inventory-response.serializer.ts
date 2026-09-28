import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import type {
  CostingRuleRow,
  CostingRuleVersionRow,
  InventoryItemRow,
  StockBalanceRow,
  StockMovementListRow,
  StockMovementRow,
  StockReservationListRow,
  StockReservationRow,
  WarehouseRow,
} from '../repositories/inventory.repository.types';

export type WarehouseResponse = {
  id: string;
  unitId: string;
  code: string;
  name: string;
  status: string;
};

export type InventoryItemResponse = {
  id: string;
  unitId: string;
  sku: string;
  name: string;
  status: string;
  allowsNegativeStock: boolean;
  costingMethodStatus: string;
};

export type StockMovementResponse = {
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

export type CostingRuleResponse = {
  id: string;
  unitId: string;
  code: string;
  name: string;
  status: string;
};

export type CostingRuleVersionResponse = {
  id: string;
  costingRuleId: string;
  versionNumber: number;
  status: string;
  method: string;
  sourceReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  rowVersion: number;
};

export type StockReservationResponse = {
  id: string;
  warehouseId: string;
  inventoryItemId: string;
  quantity: string;
  status: string;
  idempotencyKey: string;
};

export type StockBalanceResponse = {
  warehouseId: string;
  inventoryItemId: string;
  onHand: string;
  reserved: string;
  available: string;
};

export type PostMovementResponse = {
  movements: StockMovementResponse[];
  balance: StockBalanceResponse;
  idempotent: boolean;
};

export type WarehouseListResponse = {
  items: WarehouseResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type InventoryItemListResponse = {
  items: InventoryItemResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

/** Linha de movimento para leitura humana: depósito por código/nome e item por SKU/nome. */
export type StockMovementSummaryResponse = StockMovementResponse & {
  warehouseCode: string | null;
  warehouseName: string | null;
  itemSku: string | null;
  itemName: string | null;
  status: string;
  description: string;
};

export type StockMovementListResponse = {
  items: StockMovementSummaryResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type StockReservationSummaryResponse = StockReservationResponse & {
  unitId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  itemSku: string | null;
  itemName: string | null;
};

export type StockReservationListResponse = {
  items: StockReservationSummaryResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

function qty(value: string): string {
  return formatMoneyAmountForApi(value.startsWith('-') ? value.slice(1) : value)
    ? `${value.startsWith('-') ? '-' : ''}${formatMoneyAmountForApi(value.startsWith('-') ? value.slice(1) : value)}`
    : value;
}

export function toWarehouseResponse(row: WarehouseRow): WarehouseResponse {
  return { id: row.id, unitId: row.unit_id, code: row.code, name: row.name, status: row.status };
}

export function toInventoryItemResponse(row: InventoryItemRow): InventoryItemResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    sku: row.sku,
    name: row.name,
    status: row.status,
    allowsNegativeStock: row.allows_negative_stock,
    costingMethodStatus: row.costing_method_status,
  };
}

export function toStockMovementResponse(row: StockMovementRow): StockMovementResponse {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    inventoryItemId: row.inventory_item_id,
    movementType: row.movement_type,
    quantity: formatMoneyAmountForApi(row.quantity) ?? row.quantity,
    signedQuantity: qty(row.signed_quantity),
    counterpartWarehouseId: row.counterpart_warehouse_id,
    transferGroupId: row.transfer_group_id,
    transferLeg: row.transfer_leg,
    reservationId: row.reservation_id,
    commandIdempotencyKey: row.command_idempotency_key,
    occurredOn: row.occurred_on.slice(0, 10),
    unitCost: row.unit_cost ? formatMoneyAmountForApi(row.unit_cost) ?? row.unit_cost : null,
    totalCost: row.total_cost ? formatMoneyAmountForApi(row.total_cost) ?? row.total_cost : null,
    costingRuleVersionId: row.costing_rule_version_id,
    originKind: row.origin_kind,
  };
}

export function toStockMovementSummaryResponse(
  row: StockMovementListRow,
): StockMovementSummaryResponse {
  return {
    ...toStockMovementResponse(row),
    status: row.status,
    description: row.description,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    itemSku: row.item_sku,
    itemName: row.item_name,
  };
}

export function toStockReservationSummaryResponse(
  row: StockReservationListRow,
): StockReservationSummaryResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    warehouseId: row.warehouse_id,
    inventoryItemId: row.inventory_item_id,
    quantity: formatMoneyAmountForApi(row.quantity) ?? row.quantity,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    itemSku: row.item_sku,
    itemName: row.item_name,
  };
}

export function toCostingRuleResponse(row: CostingRuleRow): CostingRuleResponse {  return {
    id: row.id,
    unitId: row.unit_id,
    code: row.code,
    name: row.name,
    status: row.status,
  };
}

export function toCostingRuleVersionResponse(row: CostingRuleVersionRow): CostingRuleVersionResponse {
  return {
    id: row.id,
    costingRuleId: row.costing_rule_id,
    versionNumber: row.version_number,
    status: row.status,
    method: row.method,
    sourceReference: row.source_reference,
    effectiveFrom: row.effective_from.slice(0, 10),
    effectiveTo: row.effective_to ? row.effective_to.slice(0, 10) : null,
    rowVersion: row.row_version,
  };
}

export function toReservationResponse(row: StockReservationRow): StockReservationResponse {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    inventoryItemId: row.inventory_item_id,
    quantity: formatMoneyAmountForApi(row.quantity) ?? row.quantity,
    status: row.status,
    idempotencyKey: row.idempotency_key,
  };
}

export function toBalanceResponse(row: StockBalanceRow): StockBalanceResponse {
  return {
    warehouseId: row.warehouse_id,
    inventoryItemId: row.inventory_item_id,
    onHand: formatMoneyAmountForApi(row.on_hand) ?? row.on_hand,
    reserved: formatMoneyAmountForApi(row.reserved) ?? row.reserved,
    available: formatMoneyAmountForApi(row.available) ?? row.available,
  };
}

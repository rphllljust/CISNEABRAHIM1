export type WarehouseRow = {
  id: string;
  unit_id: string;
  code: string;
  name: string;
  status: string;
};

export type InventoryItemRow = {
  id: string;
  unit_id: string;
  sku: string;
  name: string;
  status: string;
  allows_negative_stock: boolean;
  costing_method_status: string;
};

export type StockMovementRow = {
  id: string;
  unit_id: string;
  warehouse_id: string;
  inventory_item_id: string;
  movement_type: string;
  status: string;
  quantity: string;
  signed_quantity: string;
  counterpart_warehouse_id: string | null;
  transfer_group_id: string | null;
  transfer_leg: string | null;
  adjustment_effect: string | null;
  reservation_id: string | null;
  reversal_of_movement_id: string | null;
  command_idempotency_key: string;
  idempotency_key: string;
  occurred_on: string;
  description: string;
  unit_cost: string | null;
  total_cost: string | null;
  costing_rule_version_id: string | null;
  origin_kind: string | null;
};

export type CostingRuleRow = {
  id: string;
  unit_id: string;
  code: string;
  name: string;
  status: string;
};

export type CostingRuleVersionRow = {
  id: string;
  costing_rule_id: string;
  version_number: number;
  status: string;
  method: string;
  required_context: unknown;
  effective_from: string;
  effective_to: string | null;
  source_reference: string;
  row_version: number;
  published_at: Date | null;
  published_by_identity_id: string | null;
};

export type StockReservationRow = {
  id: string;
  unit_id: string;
  warehouse_id: string;
  inventory_item_id: string;
  quantity: string;
  status: string;
  idempotency_key: string;
};

export type StockBalanceRow = {
  unit_id: string;
  warehouse_id: string;
  inventory_item_id: string;
  on_hand: string;
  reserved: string;
  available: string;
};

/** Linha de lista de movimento com as referências humanas resolvidas pelo servidor. */
export type StockMovementListRow = StockMovementRow & {
  warehouse_code: string | null;
  warehouse_name: string | null;
  item_sku: string | null;
  item_name: string | null;
};

/** Linha de lista de reserva com as referências humanas resolvidas pelo servidor. */
export type StockReservationListRow = StockReservationRow & {
  warehouse_code: string | null;
  warehouse_name: string | null;
  item_sku: string | null;
  item_name: string | null;
};

export type PersistMovementInput = {
  unitId: string;
  warehouseId: string;
  inventoryItemId: string;
  movementType: string;
  quantity: string;
  signedQuantity: string;
  counterpartWarehouseId?: string | null;
  transferGroupId?: string | null;
  transferLeg?: string | null;
  adjustmentEffect?: string | null;
  reservationId?: string | null;
  reversalOfMovementId?: string | null;
  commandIdempotencyKey: string;
  idempotencyKey: string;
  sourceKind?: string | null;
  sourceId?: string | null;
  occurredOn: string;
  description: string;
  actorIdentityId: string;
  unitCost?: string | null;
  totalCost?: string | null;
  costingRuleVersionId?: string | null;
  originKind?: string | null;
};

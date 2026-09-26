import type { PurchaseOrderBillingRuleInput, PurchaseOrderItemInput } from '../domain/purchase-order.validation';

export type ClientSnapshotSource = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  normalized_tax_id: string;
  status: string;
};

export type ServiceSnapshotSource = {
  service_definition_id: string;
  service_definition_version_id: string;
  code: string;
  name: string;
  version: number;
  version_status: string;
};

export type PurchaseOrderRow = {
  id: string;
  internal_code: string;
  client_id: string;
  unit_id: string;
  po_number: string;
  rc_number: string | null;
  issue_date: string | null;
  buyer_contact: Record<string, unknown>;
  service_manager: string | null;
  delivery_location: Record<string, unknown>;
  billing_location: Record<string, unknown>;
  currency_code: string;
  pricing_structure: string;
  total_amount: string | null;
  consumed_amount: string;
  authorized_overrun_amount: string;
  overrun_justification: string | null;
  overrun_authorized_at: string | null;
  overrun_authorized_by_identity_id: string | null;
  items_line_total_amount: string | null;
  payment_terms: string | null;
  payment_method: string | null;
  client_snapshot: Record<string, unknown> | null;
  commercial_snapshot: Record<string, unknown> | null;
  original_document_id: string | null;
  status: string;
  registered_at: string | null;
  registered_by_identity_id: string | null;
  cancelled_at: string | null;
  cancelled_by_identity_id: string | null;
  cancellation_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderItemRow = {
  id: string;
  purchase_order_id: string;
  line_number: number;
  description: string;
  service_definition_id: string | null;
  service_definition_version_id: string | null;
  service_snapshot: Record<string, unknown> | null;
  commercial_snapshot: Record<string, unknown> | null;
  quantity: string | null;
  unit_code: string | null;
  unit_price_amount: string | null;
  line_total_amount: string | null;
  rc_line_reference: string | null;
};

export type PurchaseOrderBillingRuleRow = {
  id: string;
  purchase_order_id: string;
  rule_type: string;
  rule_config: Record<string, unknown>;
  precedence_tier: string;
  created_at: string;
};

export type PurchaseOrderDocumentLinkRow = {
  id: string;
  purchase_order_id: string;
  document_id: string;
  link_purpose: string;
  created_at: string;
};

export type CreatePurchaseOrderPersistenceInput = {
  internalCode: string;
  clientId: string;
  unitId: string;
  poNumber: string;
  rcNumber?: string | null;
  issueDate?: string | null;
  buyerContact: Record<string, unknown>;
  serviceManager?: string | null;
  deliveryLocation: Record<string, unknown>;
  billingLocation: Record<string, unknown>;
  currencyCode: string;
  pricingStructure: string;
  totalAmount?: string | null;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  originalDocumentId?: string | null;
  items: PurchaseOrderItemInput[];
  billingRules: PurchaseOrderBillingRuleInput[];
  actorIdentityId: string;
};

export type UpdatePurchaseOrderDraftPersistenceInput = {
  purchaseOrderId: string;
  rowVersion: number;
  poNumber?: string;
  rcNumber?: string | null | undefined;
  issueDate?: string | null | undefined;
  buyerContact?: Record<string, unknown>;
  serviceManager?: string | null | undefined;
  deliveryLocation?: Record<string, unknown>;
  billingLocation?: Record<string, unknown>;
  currencyCode?: string;
  pricingStructure?: string;
  totalAmount?: string | null | undefined;
  paymentTerms?: string | null | undefined;
  paymentMethod?: string | null | undefined;
  originalDocumentId?: string | null | undefined;
  items?: PurchaseOrderItemInput[];
  billingRules?: PurchaseOrderBillingRuleInput[];
  actorIdentityId: string;
};

export type RegisterPurchaseOrderPersistenceInput = {
  purchaseOrderId: string;
  rowVersion: number;
  clientSnapshot: Record<string, unknown>;
  commercialSnapshot: Record<string, unknown>;
  itemsLineTotal: string | null;
  itemSnapshots: Array<{
    lineNumber: number;
    serviceSnapshot: Record<string, unknown> | null;
    commercialSnapshot: Record<string, unknown>;
  }>;
  actorIdentityId: string;
};

/**
 * Linha da cadeia relacionada do pedido de compra.
 *
 * Projecao comum de `rpt.read_service_requests`, `rpt.read_service_orders`,
 * `rpt.read_measurements`, `rpt.read_billing_records` e `rpt.read_billing_documents`.
 * `kind` discrimina a origem; `parent_id` liga medicao/faturamento a sua OS.
 */
export type PurchaseOrderLinkedRow = {
  kind: string;
  id: string;
  label: string;
  status: string;
  amount: string | null;
  currency_code: string | null;
  occurred_at: string;
  parent_id: string | null;
};

export type PurchaseRequestListRow = {
  id: string;
  unit_id: string;
  justification: string;
  currency_code: string;
  status: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  line_count: string;
  total_amount: string;
};

export type SupplierPurchaseOrderListRow = {
  id: string;
  request_id: string;
  supplier_id: string;
  unit_id: string;
  currency_code: string;
  payment_terms: string;
  status: string;
  version: number;
  issued_at: Date | string;
  updated_at: Date | string;
  line_count: string;
  total_amount: string;
  received_quantity: string;
};

/**
 * Linha de lista de solicitação: referencia-se pela justificativa, unidade, estado e valor
 * persistido — não pelo identificador técnico.
 */
export type PurchaseRequestSummaryResponse = {
  id: string;
  unitId: string;
  justification: string;
  currencyCode: string;
  status: string;
  version: number;
  lineCount: number;
  totalAmount: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Linha de lista de pedido ao fornecedor: a referência do fornecedor vem resolvida pelo servidor
 * (razão social, nome fantasia, CNPJ), e o progresso de recebimento acompanha a linha.
 */
export type SupplierPurchaseOrderSummaryResponse = {
  id: string;
  requestId: string;
  supplierId: string;
  supplierName: string | null;
  supplierTaxId: string | null;
  unitId: string;
  currencyCode: string;
  paymentTerms: string;
  status: string;
  version: number;
  lineCount: number;
  totalAmount: string;
  receivedQuantity: string;
  issuedAt: string;
  updatedAt: string;
};

export type PurchaseRequestListResponse = {
  items: PurchaseRequestSummaryResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type SupplierPurchaseOrderListResponse = {
  items: SupplierPurchaseOrderSummaryResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type PurchaseRequestLineRow = {
  id: string;
  line_number: number;
  description: string;
  quantity: string;
  unit_amount: string;
  line_amount: string;
};

export type PurchaseRequestRow = {
  id: string;
  unit_id: string;
  requester_identity_id: string;
  justification: string;
  currency_code: string;
  status: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  submitted_at: Date | string | null;
  cancelled_at: Date | string | null;
  cancel_reason: string | null;
};

export type SupplierPurchaseOrderLineRow = {
  id: string;
  request_line_id: string;
  line_number: number;
  description: string;
  ordered_quantity: string;
  received_quantity: string;
  unit_amount: string;
  line_amount: string;
};

export type SupplierPurchaseOrderRow = {
  id: string;
  request_id: string;
  supplier_id: string;
  unit_id: string;
  currency_code: string;
  payment_terms: string;
  status: string;
  version: number;
  issued_at: Date | string;
  updated_at: Date | string;
  cancelled_at: Date | string | null;
  cancel_reason: string | null;
};

export type GoodsReceiptRow = {
  id: string;
  supplier_purchase_order_id: string;
  status: string;
  currency_code: string;
  received_at: Date | string;
  actor_identity_id: string;
  idempotency_key: string;
  payable_id: string | null;
};

export type PurchaseRequestResponse = {
  id: string;
  unitId: string;
  requesterIdentityId: string;
  justification: string;
  currencyCode: string;
  status: string;
  version: number;
  lines: Array<{
    id: string;
    lineNumber: number;
    description: string;
    quantity: string;
    unitAmount: string;
    lineAmount: string;
  }>;
};

export type SupplierPurchaseOrderResponse = {
  id: string;
  requestId: string;
  supplierId: string;
  /** Referência humana do fornecedor resolvida pelo servidor; `null` se o cadastro não existir. */
  supplierName: string | null;
  supplierLegalName: string | null;
  supplierTaxId: string | null;
  unitId: string;
  currencyCode: string;
  paymentTerms: string;
  status: string;
  version: number;
  lines: Array<{
    id: string;
    lineNumber: number;
    description: string;
    orderedQuantity: string;
    receivedQuantity: string;
    unitAmount: string;
    lineAmount: string;
  }>;
  receipts: Array<{
    id: string;
    payableId: string | null;
    idempotencyKey: string;
    status: string;
  }>;
};

export function toPurchaseRequestResponse(
  row: PurchaseRequestRow,
  lines: PurchaseRequestLineRow[],
): PurchaseRequestResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    requesterIdentityId: row.requester_identity_id,
    justification: row.justification,
    currencyCode: row.currency_code,
    status: row.status,
    version: row.version,
    lines: lines.map((line) => ({
      id: line.id,
      lineNumber: line.line_number,
      description: line.description,
      quantity: line.quantity,
      unitAmount: line.unit_amount,
      lineAmount: line.line_amount,
    })),
  };
}

export function toSupplierPurchaseOrderResponse(
  row: SupplierPurchaseOrderRow,
  lines: SupplierPurchaseOrderLineRow[],
  receipts: GoodsReceiptRow[],
  supplier?: { legal_name: string; trade_name: string | null; normalized_tax_id: string } | null,
): SupplierPurchaseOrderResponse {
  return {
    id: row.id,
    requestId: row.request_id,
    supplierId: row.supplier_id,
    supplierName: supplier ? (supplier.trade_name ?? supplier.legal_name) : null,
    supplierLegalName: supplier?.legal_name ?? null,
    supplierTaxId: supplier?.normalized_tax_id ?? null,
    unitId: row.unit_id,
    currencyCode: row.currency_code,
    paymentTerms: row.payment_terms,
    status: row.status,
    version: row.version,
    lines: lines.map((line) => ({
      id: line.id,
      lineNumber: line.line_number,
      description: line.description,
      orderedQuantity: line.ordered_quantity,
      receivedQuantity: line.received_quantity,
      unitAmount: line.unit_amount,
      lineAmount: line.line_amount,
    })),
    receipts: receipts.map((item) => ({
      id: item.id,
      payableId: item.payable_id,
      idempotencyKey: item.idempotency_key,
      status: item.status,
    })),
  };
}

export function toPurchaseRequestSummaryResponse(
  row: PurchaseRequestListRow,
): PurchaseRequestSummaryResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    justification: row.justification,
    currencyCode: row.currency_code,
    status: row.status,
    version: row.version,
    lineCount: Number(row.line_count),
    totalAmount: row.total_amount,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export function toSupplierPurchaseOrderSummaryResponse(
  row: SupplierPurchaseOrderListRow,
  supplier: { legalName: string; tradeName: string | null; taxId: string } | null,
): SupplierPurchaseOrderSummaryResponse {
  return {
    id: row.id,
    requestId: row.request_id,
    supplierId: row.supplier_id,
    supplierName: supplier ? (supplier.tradeName ?? supplier.legalName) : null,
    supplierTaxId: supplier?.taxId ?? null,
    unitId: row.unit_id,
    currencyCode: row.currency_code,
    paymentTerms: row.payment_terms,
    status: row.status,
    version: row.version,
    lineCount: Number(row.line_count),
    totalAmount: row.total_amount,
    receivedQuantity: row.received_quantity,
    issuedAt: row.issued_at instanceof Date ? row.issued_at.toISOString() : String(row.issued_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

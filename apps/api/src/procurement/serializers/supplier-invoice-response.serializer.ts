export type SupplierInvoiceRow = {
  id: string;
  unit_id: string;
  supplier_id: string;
  invoice_number: string;
  issued_on: string;
  due_date: string;
  currency_code: string;
  total_amount: string;
  payment_terms: string;
  supplier_purchase_order_id: string | null;
  goods_receipt_id: string | null;
  payable_id: string | null;
  status: string;
  version: number;
  idempotency_key: string;
  created_at: Date | string;
  updated_at: Date | string;
  validated_at: Date | string | null;
};

export type SupplierInvoiceListRow = {
  id: string;
  unit_id: string;
  supplier_id: string;
  invoice_number: string;
  issued_on: string;
  due_date: string;
  currency_code: string;
  total_amount: string;
  status: string;
  version: number;
  payable_id: string | null;
  supplier_purchase_order_id: string | null;
  supplier_legal_name: string | null;
  supplier_trade_name: string | null;
  supplier_tax_id: string | null;
  created_at: Date | string;
};

/**
 * Linha de lista de nota do fornecedor: número, fornecedor (referência humana resolvida pelo
 * servidor), valor, vencimento e estado.
 */
export type SupplierInvoiceSummaryResponse = {
  id: string;
  unitId: string;
  supplierId: string;
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string;
  issuedOn: string;
  dueDate: string;
  currencyCode: string;
  totalAmount: string;
  status: string;
  version: number;
  payableId: string | null;
  supplierPurchaseOrderId: string | null;
};

export type SupplierInvoiceListResponse = {
  items: SupplierInvoiceSummaryResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export function toSupplierInvoiceSummaryResponse(
  row: SupplierInvoiceListRow,
): SupplierInvoiceSummaryResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_legal_name
      ? (row.supplier_trade_name ?? row.supplier_legal_name)
      : null,
    supplierTaxId: row.supplier_tax_id,
    invoiceNumber: row.invoice_number,
    issuedOn: String(row.issued_on).slice(0, 10),
    dueDate: String(row.due_date).slice(0, 10),
    currencyCode: row.currency_code,
    totalAmount: row.total_amount,
    status: row.status,
    version: row.version,
    payableId: row.payable_id,
    supplierPurchaseOrderId: row.supplier_purchase_order_id,
  };
}

export type SupplierInvoiceResponse = {
  id: string;
  unitId: string;
  supplierId: string;
  invoiceNumber: string;
  issuedOn: string;
  dueDate: string;
  currencyCode: string;
  totalAmount: string;
  paymentTerms: string;
  supplierPurchaseOrderId: string | null;
  goodsReceiptId: string | null;
  payableId: string | null;
  status: string;
  version: number;
};

export function toSupplierInvoiceResponse(row: SupplierInvoiceRow): SupplierInvoiceResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    supplierId: row.supplier_id,
    invoiceNumber: row.invoice_number,
    issuedOn: String(row.issued_on).slice(0, 10),
    dueDate: String(row.due_date).slice(0, 10),
    currencyCode: row.currency_code,
    totalAmount: row.total_amount,
    paymentTerms: row.payment_terms,
    supplierPurchaseOrderId: row.supplier_purchase_order_id,
    goodsReceiptId: row.goods_receipt_id,
    payableId: row.payable_id,
    status: row.status,
    version: row.version,
  };
}

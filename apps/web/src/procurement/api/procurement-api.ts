import {
  authHeaders,
  BACKOFFICE_PROBE_ID,
  jsonHeaders,
  probeReadAccess,
  requestJson,
} from '../../financial-ui/enterprise-api';

export type PurchaseRequest = {
  id: string;
  unitId: string;
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

export type SupplierPurchaseOrderReceipt = {
  id: string;
  payableId: string | null;
  idempotencyKey: string;
  status: string;
};

export type SupplierPurchaseOrder = {
  id: string;
  requestId: string;
  supplierId: string;
  /** Referência humana do fornecedor resolvida pelo servidor; `null` sem cadastro. */
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
  receipts: SupplierPurchaseOrderReceipt[];
};

export type SupplierInvoice = {
  id: string;
  unitId: string;
  supplierId: string;
  invoiceNumber: string;
  issuedOn: string;
  dueDate: string;
  totalAmount: string;
  currencyCode: string;
  paymentTerms: string;
  supplierPurchaseOrderId: string | null;
  goodsReceiptId: string | null;
  status: string;
  version: number;
  payableId: string | null;
};

export type ThreeWayMatch = {
  id: string;
  unitId: string;
  supplierPurchaseOrderId: string;
  goodsReceiptId: string | null;
  supplierInvoiceId: string | null;
  classification: string;
  reasons: string[];
  orderedQuantity: string;
  receivedQuantity: string;
  orderedAmount: string;
  receivedAmount: string;
  invoicedAmount: string;
  receiptCount: number;
  invoiceCount: number;
};

/** Linha de lista: identifica a solicitação por justificativa, estado e valor persistido. */
export type PurchaseRequestSummary = {
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

/** Linha de lista: fornecedor por nome/CNPJ e progresso de recebimento do pedido. */
export type SupplierPurchaseOrderSummary = {
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
  items: PurchaseRequestSummary[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type SupplierPurchaseOrderListResponse = {
  items: SupplierPurchaseOrderSummary[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type SupplierInvoiceListResponse = {
  items: SupplierInvoiceSummary[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

/** Linha de lista de nota: número, fornecedor por referência humana, valor e estado. */
export type SupplierInvoiceSummary = {
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

export async function listSupplierInvoices(
  params: { limit: number; offset: number; status?: string; q?: string },
  signal?: AbortSignal,
): Promise<SupplierInvoiceListResponse> {
  return requestJson<SupplierInvoiceListResponse>(
    `/api/v1/supplier-invoices?${buildListQuery(params)}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

export async function listPurchaseRequests(
  params: { limit: number; offset: number; status?: string; q?: string },
  signal?: AbortSignal,
): Promise<PurchaseRequestListResponse> {
  return requestJson<PurchaseRequestListResponse>(
    `/api/v1/procurement/requests?${buildListQuery(params)}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

export async function listSupplierPurchaseOrders(
  params: { limit: number; offset: number; status?: string; supplierId?: string; q?: string },
  signal?: AbortSignal,
): Promise<SupplierPurchaseOrderListResponse> {
  return requestJson<SupplierPurchaseOrderListResponse>(
    `/api/v1/procurement/orders?${buildListQuery(params)}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

function buildListQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') {
      continue;
    }
    search.set(key, String(value).trim());
  }
  return search.toString();
}

/**
 * Referências de fornecedor para seleção humana. Usa a listagem do cadastro de fornecedores —
 * a mesma autoridade que valida a criação do pedido — em vez de exigir que o operador cole um
 * identificador técnico.
 */
export async function searchSupplierOptions(
  term: string,
  signal?: AbortSignal,
): Promise<Array<{ id: string; label: string; taxId: string }>> {
  const search = new URLSearchParams({ limit: '20', offset: '0' });
  if (term.trim().length > 0) {
    search.set('q', term.trim());
  }
  const response = await requestJson<{
    items: Array<{ id: string; legalName: string; tradeName: string | null; taxId: string }>;
  }>(`/api/v1/suppliers?${search.toString()}`, { method: 'GET', headers: authHeaders(), signal });
  return response.items.map((item) => ({
    id: item.id,
    label: item.tradeName ?? item.legalName,
    taxId: item.taxId,
  }));
}

export async function getPurchaseRequest(requestId: string, signal?: AbortSignal): Promise<PurchaseRequest> {
  return requestJson<PurchaseRequest>(`/api/v1/procurement/requests/${requestId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createPurchaseRequest(payload: Record<string, unknown>): Promise<PurchaseRequest> {
  return requestJson<PurchaseRequest>('/api/v1/procurement/requests', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function submitPurchaseRequest(
  requestId: string,
  payload: { version: number },
): Promise<PurchaseRequest> {
  return requestJson<PurchaseRequest>(`/api/v1/procurement/requests/${requestId}/submit`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function approvePurchaseRequest(
  requestId: string,
  payload: { version: number },
): Promise<PurchaseRequest> {
  return requestJson<PurchaseRequest>(`/api/v1/procurement/requests/${requestId}/approve`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function rejectPurchaseRequest(
  requestId: string,
  payload: { version: number; reason?: string },
): Promise<PurchaseRequest> {
  return requestJson<PurchaseRequest>(`/api/v1/procurement/requests/${requestId}/reject`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function issuePurchaseOrder(
  requestId: string,
  payload: { version: number; supplierId: string; paymentTerms?: string },
): Promise<SupplierPurchaseOrder> {
  return requestJson<SupplierPurchaseOrder>(`/api/v1/procurement/requests/${requestId}/issue-order`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function getPurchaseOrder(orderId: string, signal?: AbortSignal): Promise<SupplierPurchaseOrder> {
  return requestJson<SupplierPurchaseOrder>(`/api/v1/procurement/orders/${orderId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function receivePurchaseOrder(
  orderId: string,
  payload: Record<string, unknown>,
): Promise<SupplierPurchaseOrder> {
  return requestJson<SupplierPurchaseOrder>(`/api/v1/procurement/orders/${orderId}/receive`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function cancelPurchaseRequest(
  requestId: string,
  payload: { version: number; reason?: string },
): Promise<PurchaseRequest> {
  return requestJson<PurchaseRequest>(`/api/v1/procurement/requests/${requestId}/cancel`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function cancelPurchaseOrder(
  orderId: string,
  payload: { version: number; reason?: string },
): Promise<SupplierPurchaseOrder> {
  return requestJson<SupplierPurchaseOrder>(`/api/v1/procurement/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function getSupplierInvoice(invoiceId: string, signal?: AbortSignal): Promise<SupplierInvoice> {
  return requestJson<SupplierInvoice>(`/api/v1/supplier-invoices/${invoiceId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createSupplierInvoice(payload: Record<string, unknown>): Promise<SupplierInvoice> {
  return requestJson<SupplierInvoice>('/api/v1/supplier-invoices', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function validateSupplierInvoice(
  invoiceId: string,
  payload: Record<string, unknown>,
): Promise<SupplierInvoice> {
  return requestJson<SupplierInvoice>(`/api/v1/supplier-invoices/${invoiceId}/validate`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function computeThreeWayMatch(
  orderId: string,
  payload: Record<string, unknown>,
): Promise<ThreeWayMatch> {
  return requestJson<ThreeWayMatch>(`/api/v1/procurement/orders/${orderId}/three-way-match`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function getThreeWayMatch(matchId: string, signal?: AbortSignal): Promise<ThreeWayMatch> {
  return requestJson<ThreeWayMatch>(`/api/v1/three-way-matches/${matchId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function probeProcurementReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(`/api/v1/procurement/requests/${BACKOFFICE_PROBE_ID}`, signal);
}

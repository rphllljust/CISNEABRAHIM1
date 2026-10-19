import { type HistoryEventResponse } from '../../infrastructure/http/contracts';
import type {
  BillingDocumentHistoryEventRow,
  BillingDocumentItemRow,
  BillingDocumentRow,
} from '../repositories/billing-document.repository.types';

export type BillingDocumentItemResponse = {
  id: string;
  lineNumber: number;
  billingItemId: string | null;
  measurementItemId: string | null;
  unitCode: string;
  quantity: string;
  unitPrice: string | null;
  lineAmount: string;
  lineLabel: string;
  pricingLineSnapshot: Record<string, unknown>;
};

export type BillingDocumentHistoryEventResponse = HistoryEventResponse;

export type BillingDocumentDetailResponse = {
  id: string;
  billingRecordId: string;
  serviceOrderId: string;
  measurementId: string;
  clientId: string;
  unitId: string;
  documentNumber: string;
  sequenceYear: number;
  sequenceNumber: number;
  versionNumber: number;
  replacesDocumentId: string | null;
  status: string;
  documentCategory: string;
  emitterLegalName: string;
  emitterTaxId: string;
  emitterAddressSnapshot: Record<string, unknown>;
  clientLegalNameSnapshot: string;
  clientTaxIdSnapshot: string | null;
  billingAddressSnapshot: Record<string, unknown>;
  commercialReferenceSnapshot: Record<string, unknown>;
  proposalId: string | null;
  purchaseOrderId: string | null;
  purchaseOrderNumberSnapshot: string | null;
  customerPurchaseOrderNumberSnapshot: string | null;
  contractReference: string | null;
  currencyCode: string;
  paymentTerms: string;
  dueDate: string | null;
  totalAmount: string;
  issuedAt: string;
  storedDocumentId: string | null;
  artifactSha256: string | null;
  artifactByteSize: number | null;
  cancelledAt: string | null;
  cancelledByIdentityId: string | null;
  cancelReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  items: BillingDocumentItemResponse[];
  historyEvents: BillingDocumentHistoryEventResponse[];
};

function toItemResponse(row: BillingDocumentItemRow): BillingDocumentItemResponse {
  return {
    id: row.id,
    lineNumber: row.line_number,
    billingItemId: row.billing_item_id,
    measurementItemId: row.measurement_item_id,
    unitCode: row.unit_code,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineAmount: row.line_amount,
    lineLabel: row.line_label,
    pricingLineSnapshot: row.pricing_line_snapshot,
  };
}

function sanitizeHistoryPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.toLowerCase().includes('storage_key') || key.toLowerCase() === 'storagekey') {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function toHistoryResponse(row: BillingDocumentHistoryEventRow): BillingDocumentHistoryEventResponse {
  return {
    id: row.id,
    eventType: row.event_type,
    payload: sanitizeHistoryPayload(row.payload),
    actorIdentityId: row.actor_identity_id,
    occurredAt: row.occurred_at,
  };
}

export function toBillingDocumentDetailResponse(
  row: BillingDocumentRow,
  items: BillingDocumentItemRow[],
  historyEvents: BillingDocumentHistoryEventRow[],
): BillingDocumentDetailResponse {
  return {
    id: row.id,
    billingRecordId: row.billing_record_id,
    serviceOrderId: row.service_order_id,
    measurementId: row.measurement_id,
    clientId: row.client_id,
    unitId: row.unit_id,
    documentNumber: row.document_number,
    sequenceYear: row.sequence_year,
    sequenceNumber: Number(row.sequence_number),
    versionNumber: row.version_number,
    replacesDocumentId: row.replaces_document_id,
    status: row.status,
    documentCategory: row.document_category,
    emitterLegalName: row.emitter_legal_name,
    emitterTaxId: row.emitter_tax_id,
    emitterAddressSnapshot: row.emitter_address_snapshot,
    clientLegalNameSnapshot: row.client_legal_name_snapshot,
    clientTaxIdSnapshot: row.client_tax_id_snapshot,
    billingAddressSnapshot: row.billing_address_snapshot,
    commercialReferenceSnapshot: row.commercial_reference_snapshot,
    proposalId: row.proposal_id,
    purchaseOrderId: row.purchase_order_id,
    purchaseOrderNumberSnapshot: row.purchase_order_number_snapshot,
    customerPurchaseOrderNumberSnapshot: row.customer_purchase_order_number_snapshot,
    contractReference: row.contract_reference,
    currencyCode: row.currency_code,
    paymentTerms: row.payment_terms,
    dueDate: row.due_date,
    totalAmount: row.total_amount,
    issuedAt: row.issued_at,
    storedDocumentId: row.stored_document_id,
    artifactSha256: row.artifact_sha256,
    artifactByteSize: row.artifact_byte_size ? Number(row.artifact_byte_size) : null,
    cancelledAt: row.cancelled_at,
    cancelledByIdentityId: row.cancelled_by_identity_id,
    cancelReason: row.cancel_reason,
    rowVersion: row.row_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map(toItemResponse),
    historyEvents: historyEvents.map(toHistoryResponse),
  };
}

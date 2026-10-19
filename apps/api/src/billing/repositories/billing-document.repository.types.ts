import type { BillingItemRow, BillingRecordRow } from './billing.repository.types';

export type BillingDocumentRow = {
  id: string;
  billing_record_id: string;
  service_order_id: string;
  measurement_id: string;
  client_id: string;
  unit_id: string;
  document_number: string;
  sequence_year: number;
  sequence_number: string;
  version_number: number;
  replaces_document_id: string | null;
  status: string;
  document_category: string;
  emitter_legal_name: string;
  emitter_tax_id: string;
  emitter_address_snapshot: Record<string, unknown>;
  client_legal_name_snapshot: string;
  client_tax_id_snapshot: string | null;
  billing_address_snapshot: Record<string, unknown>;
  commercial_reference_snapshot: Record<string, unknown>;
  proposal_id: string | null;
  purchase_order_id: string | null;
  purchase_order_number_snapshot: string | null;
  customer_purchase_order_number_snapshot: string | null;
  contract_reference: string | null;
  currency_code: string;
  payment_terms: string;
  due_date: string | null;
  total_amount: string;
  issued_at: string;
  stored_document_id: string | null;
  artifact_sha256: string | null;
  artifact_byte_size: string | null;
  cancelled_at: string | null;
  cancelled_by_identity_id: string | null;
  cancel_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  created_by_identity_id: string;
  updated_by_identity_id: string;
};

export type BillingDocumentItemRow = {
  id: string;
  billing_document_id: string;
  line_number: number;
  billing_item_id: string | null;
  measurement_item_id: string | null;
  unit_code: string;
  quantity: string;
  unit_price: string | null;
  line_amount: string;
  line_label: string;
  pricing_line_snapshot: Record<string, unknown>;
  created_at: string;
};

export type BillingDocumentHistoryEventRow = {
  id: string;
  billing_document_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor_identity_id: string | null;
  occurred_at: string;
};

export type BillingDocumentCommandIdempotencyRow = {
  id: string;
  billing_document_id: string | null;
  billing_record_id: string;
  command_name: string;
  idempotency_key: string;
  response_payload: Record<string, unknown>;
  created_at: string;
};

export type PurchaseOrderNumberRow = {
  po_number: string;
};

export type AllocatedDocumentNumber = {
  sequenceYear: number;
  sequenceNumber: number;
  documentNumber: string;
};

export type BillingDocumentItemDraft = {
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

export type IssueBillingDocumentPersistenceInput = {
  billingRecord: BillingRecordRow;
  billingItems: BillingItemRow[];
  purchaseOrderNumber: string | null;
  customerPurchaseOrderNumber: string | null;
  dueDate: string | null;
  issuedAt: string;
  actorIdentityId: string;
  idempotencyKey?: string | null;
  versionNumber: number;
  replacesDocumentId?: string | null;
  emitterLegalName: string;
  emitterTaxId: string;
  emitterAddressSnapshot: Record<string, unknown>;
};

export type PersistedBillingArtifact = {
  storedDocumentId: string;
  storedObjectId: string;
  storageKey: string;
  sha256: string;
  byteSize: number;
  originalFilename: string;
  title: string;
};

export type IssueBillingDocumentPersistenceResult = {
  outcome: 'created' | 'idempotent';
  billingDocument: BillingDocumentRow;
};

export type CancelBillingDocumentPersistenceInput = {
  billingDocumentId: string;
  billingRecordId: string;
  rowVersion: number;
  cancelReason: string;
  actorIdentityId: string;
  idempotencyKey?: string | null;
};

export type CancelBillingDocumentPersistenceResult = {
  outcome: 'cancelled' | 'idempotent';
  billingDocument: BillingDocumentRow;
};

export type ReplaceBillingDocumentPersistenceInput = IssueBillingDocumentPersistenceInput & {
  previousDocumentId: string;
  previousRowVersion: number;
  replaceReason: string;
};

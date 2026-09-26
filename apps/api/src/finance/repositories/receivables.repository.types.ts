export type ReceivableRow = {
  id: string;
  unit_id: string;
  client_id: string;
  origin_kind: string;
  origin_billing_document_id: string;
  origin_billing_record_id: string;
  origin_service_order_id: string;
  origin_measurement_id: string;
  principal: string;
  currency_code: string;
  due_date: string;
  payment_terms: string;
  external_reference: string | null;
  lifecycle: string;
  cancelled_at: string | null;
  cancelled_by_identity_id: string | null;
  cancel_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  created_by_identity_id: string;
  updated_by_identity_id: string;
};

export type ReceivableInstallmentRow = {
  id: string;
  receivable_id: string;
  installment_number: number;
  principal: string;
  due_date: string;
  created_at: string;
};

export type SettlementRow = {
  id: string;
  receivable_id: string;
  installment_id: string | null;
  amount: string;
  currency_code: string;
  status: string;
  settled_at: string;
  idempotency_key: string;
  external_reference: string | null;
  actor_identity_id: string;
  created_at: string;
  reversed_at: string | null;
  reversed_by_identity_id: string | null;
  reversal_reason: string | null;
  reversal_idempotency_key: string | null;
};

export type OpenReceivablePersistenceInput = {
  unitId: string;
  clientId: string;
  originBillingDocumentId: string;
  originBillingRecordId: string;
  originServiceOrderId: string;
  originMeasurementId: string;
  principal: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  externalReference: string | null;
  actorIdentityId: string;
  installments: Array<{ installmentNumber: number; principal: string; dueDate: string }>;
};

export type SettleReceivablePersistenceInput = {
  receivableId: string;
  amount: string;
  currencyCode: string;
  rowVersion: number;
  idempotencyKey: string;
  installmentId?: string;
  externalReference?: string;
  settledAt: string;
  actorIdentityId: string;
};

export type CancelReceivablePersistenceInput = {
  receivableId?: string;
  originBillingDocumentId?: string;
  rowVersion?: number;
  cancelReason: string;
  actorIdentityId: string;
  idempotencyKey?: string;
};

export type ReverseSettlementPersistenceInput = {
  receivableId: string;
  settlementId: string;
  reason: string;
  idempotencyKey: string;
  actorIdentityId: string;
};

export type ReverseSettlementPersistenceResult = {
  receivable: ReceivableRow;
  settlement: SettlementRow;
  idempotent: boolean;
};

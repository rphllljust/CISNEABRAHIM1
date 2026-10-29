export type BillingRecordRow = {
  id: string;
  service_order_id: string;
  measurement_id: string | null;
  entitlement_policy: string;
  client_id: string;
  unit_id: string;
  status: string;
  proposal_id: string | null;
  purchase_order_id: string | null;
  contract_reference: string | null;
  client_legal_name_snapshot: string;
  client_tax_id_snapshot: string | null;
  billing_address_snapshot: Record<string, unknown>;
  commercial_reference_snapshot: Record<string, unknown>;
  currency_code: string;
  payment_terms: string;
  payment_terms_source: string;
  payment_terms_authoritative: string | null;
  total_amount: string;
  prepared_at: string;
  prepared_by_identity_id: string;
  voided_at: string | null;
  voided_by_identity_id: string | null;
  void_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  created_by_identity_id: string;
  updated_by_identity_id: string;
};

export type BillingItemRow = {
  id: string;
  billing_record_id: string;
  line_number: number;
  measurement_item_id: string | null;
  source_execution_entry_id: string | null;
  unit_code: string;
  quantity: string;
  unit_price: string | null;
  line_amount: string;
  pricing_line_snapshot: Record<string, unknown>;
  line_label: string;
  created_at: string;
};

export type BillingHistoryEventRow = {
  id: string;
  billing_record_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor_identity_id: string | null;
  occurred_at: string;
};

export type BillingCommandIdempotencyRow = {
  id: string;
  billing_record_id: string | null;
  service_order_id: string;
  command_name: string;
  idempotency_key: string;
  response_payload: Record<string, unknown>;
  created_at: string;
};

export type {
  MeasurementForBillingRow,
  MeasurementItemForBillingRow,
} from '../../measurements/application/measurement-billing';


export type ClientBillingSnapshotRow = {
  id: string;
  legal_name: string;
  tax_id: string | null;
};

export type ClientAddressRow = {
  purpose: string;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

export type PurchaseOrderTermsRow = {
  id: string;
  payment_terms: string | null;
};

export type PrepareBillingPersistenceInput = {
  serviceOrderId: string;
  measurementId: string | null;
  measurementVersion: number | null;
  entitlementPolicy: string;
  clientId: string;
  unitId: string;
  proposalId: string | null;
  purchaseOrderId: string | null;
  contractReference: string | null;
  clientLegalNameSnapshot: string;
  clientTaxIdSnapshot: string | null;
  billingAddressSnapshot: Record<string, unknown>;
  commercialReferenceSnapshot: Record<string, unknown>;
  currencyCode: string;
  paymentTerms: string;
  paymentTermsSource: string;
  paymentTermsAuthoritative: string | null;
  totalAmount: string;
  actorIdentityId: string;
  items: Array<{
    measurementItemId: string | null;
    sourceExecutionEntryId: string | null;
    lineNumber: number;
    unitCode: string;
    quantity: string;
    unitPrice: string | null;
    lineAmount: string;
    pricingLineSnapshot: Record<string, unknown>;
    lineLabel: string;
  }>;
  idempotencyKey?: string;
};

export type PrepareBillingPersistenceResult =
  | { outcome: 'created'; billingRecord: BillingRecordRow }
  | { outcome: 'already_exists' }
  | { outcome: 'measurement_changed' }
  | { outcome: 'acceptance_blocked'; reason: 'CUSTOMER_ACCEPTANCE_PENDING' | 'CUSTOMER_ACCEPTANCE_REJECTED' | 'CUSTOMER_ACCEPTANCE_EVIDENCE_MISSING' }
  | { outcome: 'idempotent'; billingRecord: BillingRecordRow };

export type VoidBillingPersistenceInput = {
  billingRecordId: string;
  rowVersion: number;
  voidReason: string;
  actorIdentityId: string;
  idempotencyKey?: string;
};

export type VoidBillingPersistenceResult =
  | { outcome: 'voided'; billingRecord: BillingRecordRow }
  | { outcome: 'version_conflict' }
  | { outcome: 'invalid_state' }
  | { outcome: 'idempotent'; billingRecord: BillingRecordRow };

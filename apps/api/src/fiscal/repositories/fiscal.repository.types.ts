import type {
  FiscalItemDraft,
  FiscalPartyDraft,
  FiscalTaxDetailDraft,
} from '../domain/fiscal-document';

export type FiscalDocumentRow = {
  id: string;
  unit_id: string;
  status: string;
  source_kind: string;
  source_id: string | null;
  billing_document_id: string | null;
  establishment_id: string | null;
  description: string;
  currency_code: string;
  issued_on: string;
  certificate_ref: string | null;
  idempotency_key: string;
  row_version: number;
  submitted_at: string | null;
  authorized_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by_identity_id: string;
  updated_by_identity_id: string;
};

export type FiscalItemRow = {
  id: string;
  fiscal_document_id: string;
  line_number: number;
  description: string;
  quantity: string;
  unit_amount: string;
  line_amount: string;
  item_snapshot: Record<string, unknown>;
};

export type FiscalPartyRow = {
  id: string;
  fiscal_document_id: string;
  role: string;
  legal_name: string;
  tax_identifier: string;
  party_snapshot: Record<string, unknown>;
};

export type FiscalTaxDetailRow = {
  id: string;
  fiscal_document_id: string;
  line_number: number;
  component_label: string;
  amount: string;
  detail_snapshot: Record<string, unknown>;
};

export type FiscalEventRow = {
  id: string;
  fiscal_document_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  actor_identity_id: string;
};

export type FiscalAuthorizationRow = {
  id: string;
  fiscal_document_id: string;
  attempt_number: number;
  gateway_id: string;
  outcome: string;
  protocol_code: string | null;
  message: string | null;
  request_snapshot: Record<string, unknown>;
  response_snapshot: Record<string, unknown>;
  submitted_at: string;
  completed_at: string | null;
};

export type FiscalAggregate = {
  document: FiscalDocumentRow;
  items: FiscalItemRow[];
  parties: FiscalPartyRow[];
  taxDetails: FiscalTaxDetailRow[];
  events: FiscalEventRow[];
  authorizations: FiscalAuthorizationRow[];
};

/** Linha de listagem: documento + ultima tentativa de autorizacao (LATERAL, sem N+1). */
export type FiscalDocumentListRow = FiscalDocumentRow & {
  last_protocol_code: string | null;
  last_authorization_outcome: string | null;
};

export type CreateFiscalPersistenceInput = {
  unitId: string;
  sourceKind: string;
  sourceId?: string;
  billingDocumentId?: string;
  establishmentId?: string | null;
  description: string;
  currencyCode: string;
  issuedOn: string;
  certificateRef?: string;
  idempotencyKey: string;
  actorIdentityId: string;
  parties: FiscalPartyDraft[];
  items: FiscalItemDraft[];
  taxDetails: FiscalTaxDetailDraft[];
};

export type ReplaceFiscalSnapshotsInput = {
  fiscalDocumentId: string;
  rowVersion: number;
  actorIdentityId: string;
  parties: FiscalPartyDraft[];
  items: FiscalItemDraft[];
  taxDetails: FiscalTaxDetailDraft[];
};

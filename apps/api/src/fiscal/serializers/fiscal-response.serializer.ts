import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import {
  SRC006_FISCAL_CREDENTIALING,
  fiscalOfficialPresentation,
  type FiscalCredentialingSnapshot,
} from '../domain/fiscal-credentialing';
import type { FiscalAggregate, FiscalDocumentListRow } from '../repositories/fiscal.repository.types';

export type FiscalDocumentResponse = {
  id: string;
  unitId: string;
  status: string;
  sourceKind: string;
  sourceId: string | null;
  billingDocumentId: string | null;
  description: string;
  currencyCode: string;
  issuedOn: string;
  certificateRef: string | null;
  idempotencyKey: string;
  rowVersion: number;
  parties: Array<{
    role: string;
    legalName: string;
    taxIdentifier: string;
    partySnapshot: Record<string, unknown>;
  }>;
  items: Array<{
    lineNumber: number;
    description: string;
    quantity: string;
    unitAmount: string;
    lineAmount: string;
    itemSnapshot: Record<string, unknown>;
  }>;
  taxDetails: Array<{
    lineNumber: number;
    componentLabel: string;
    amount: string;
    detailSnapshot: Record<string, unknown>;
  }>;
  events: Array<{ eventType: string; occurredAt: string }>;
  authorizations: Array<{
    attemptNumber: number;
    gatewayId: string;
    outcome: string;
    protocolCode: string | null;
    message: string | null;
    submittedAt: string;
    completedAt: string | null;
  }>;
  validityLegend: string;
  officialDanfe: 'BLOCKED' | 'ALLOWED';
};

export function toFiscalDocumentResponse(
  aggregate: FiscalAggregate,
  credentialing: FiscalCredentialingSnapshot = SRC006_FISCAL_CREDENTIALING,
): FiscalDocumentResponse {
  const latestProtocol =
    aggregate.authorizations.find((item) => item.protocol_code?.trim())?.protocol_code ?? null;
  const presentation = fiscalOfficialPresentation({
    status: aggregate.document.status,
    protocolCode: latestProtocol,
    credentialingApproved: credentialing.approved,
  });
  return {
    id: aggregate.document.id,
    unitId: aggregate.document.unit_id,
    status: aggregate.document.status,
    sourceKind: aggregate.document.source_kind,
    sourceId: aggregate.document.source_id,
    billingDocumentId: aggregate.document.billing_document_id,
    description: aggregate.document.description,
    currencyCode: aggregate.document.currency_code,
    issuedOn: aggregate.document.issued_on.slice(0, 10),
    certificateRef: aggregate.document.certificate_ref,
    idempotencyKey: aggregate.document.idempotency_key,
    rowVersion: aggregate.document.row_version,
    parties: aggregate.parties.map((party) => ({
      role: party.role,
      legalName: party.legal_name,
      taxIdentifier: party.tax_identifier,
      partySnapshot: party.party_snapshot,
    })),
    items: aggregate.items.map((item) => ({
      lineNumber: item.line_number,
      description: item.description,
      quantity: formatMoneyAmountForApi(item.quantity) ?? item.quantity,
      unitAmount: formatMoneyAmountForApi(item.unit_amount) ?? item.unit_amount,
      lineAmount: formatMoneyAmountForApi(item.line_amount) ?? item.line_amount,
      itemSnapshot: item.item_snapshot,
    })),
    taxDetails: aggregate.taxDetails.map((detail) => ({
      lineNumber: detail.line_number,
      componentLabel: detail.component_label,
      amount: formatMoneyAmountForApi(detail.amount) ?? detail.amount,
      detailSnapshot: detail.detail_snapshot,
    })),
    events: aggregate.events.map((event) => ({
      eventType: event.event_type,
      occurredAt: event.occurred_at,
    })),
    authorizations: aggregate.authorizations.map((authorization) => ({
      attemptNumber: authorization.attempt_number,
      gatewayId: authorization.gateway_id,
      outcome: authorization.outcome,
      protocolCode: authorization.protocol_code,
      message: authorization.message,
      submittedAt: authorization.submitted_at,
      completedAt: authorization.completed_at,
    })),
    validityLegend: presentation.validityLegend,
    officialDanfe: presentation.officialDanfe,
  };
}

export type FiscalDocumentListItemResponse = {
  id: string;
  unitId: string;
  status: string;
  sourceKind: string;
  sourceId: string | null;
  billingDocumentId: string | null;
  establishmentId: string | null;
  description: string;
  currencyCode: string;
  issuedOn: string;
  rowVersion: number;
  submittedAt: string | null;
  authorizedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lastProtocolCode: string | null;
  lastAuthorizationOutcome: string | null;
  createdAt: string;
};

export type FiscalDocumentPageResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: FiscalDocumentListItemResponse[];
};

export function toFiscalDocumentListItemResponse(
  row: FiscalDocumentListRow,
): FiscalDocumentListItemResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    status: row.status,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    billingDocumentId: row.billing_document_id,
    establishmentId: row.establishment_id,
    description: row.description,
    currencyCode: row.currency_code,
    issuedOn: row.issued_on.slice(0, 10),
    rowVersion: row.row_version,
    submittedAt: row.submitted_at,
    authorizedAt: row.authorized_at,
    rejectedAt: row.rejected_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    lastProtocolCode: row.last_protocol_code,
    lastAuthorizationOutcome: row.last_authorization_outcome,
    createdAt: row.created_at,
  };
}

export function toFiscalDocumentPageResponse(input: {
  page: number;
  pageSize: number;
  total: number;
  items: FiscalDocumentListRow[];
}): FiscalDocumentPageResponse {
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    items: input.items.map(toFiscalDocumentListItemResponse),
  };
}

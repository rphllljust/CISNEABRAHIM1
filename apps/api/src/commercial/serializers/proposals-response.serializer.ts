import { formatMoneyAmountForApi } from '../domain/money';
import { resolveCommercialItemFields } from '../domain/proposal-commercial-snapshot';
import { PROPOSAL_PRICING_STRUCTURES } from '../domain/proposal';
import {
  toDocumentLinkResponse,
  type DocumentLinkResponse,
} from '../../infrastructure/http/contracts';
import type {
  ProposalDocumentLinkRow,
  ProposalItemRow,
  ProposalListVersionRow,
  ProposalRow,
  ProposalVersionRow,
} from '../repositories/proposals.repository.types';

export type ProposalResponse = {
  id: string;
  proposalCode: string;
  clientId: string;
  unitId: string;
  title: string;
  currentVersionNumber: number | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type ProposalVersionResponse = {
  id: string;
  proposalId: string;
  versionNumber: number;
  status: string;
  pricingStructure: string;
  currencyCode: string;
  globalSalePrice: string | null;
  globalInternalCost: string | null;
  itemsSaleTotal: string | null;
  itemsInternalCostTotal: string | null;
  commercialTerms: Record<string, unknown>;
  clientSnapshot: Record<string, unknown> | null;
  validUntil: string | null;
  notes: string | null;
  issuedAt: string | null;
  issuedByIdentityId: string | null;
  supersededAt: string | null;
  acceptedAt: string | null;
  acceptedByIdentityId: string | null;
  acceptanceOriginCode: string | null;
  acceptanceEvidenceDocumentId: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  rowVersion: number;
  items: ProposalItemResponse[];
  documents: ProposalDocumentLinkResponse[];
};

export type ProposalItemResponse = {
  id: string;
  lineNumber: number;
  itemKind: string;
  description: string;
  serviceDefinitionId: string | null;
  serviceDefinitionVersionId: string | null;
  serviceSnapshot: Record<string, unknown> | null;
  commercialSnapshot: Record<string, unknown> | null;
  quantity: string | null;
  unitCode: string | null;
  unitSalePrice: string | null;
  unitInternalCost: string | null;
  lineSaleAmount: string | null;
  lineInternalCost: string | null;
};

export type ProposalDocumentLinkResponse = DocumentLinkResponse;

export type ProposalDetailResponse = {
  proposal: ProposalResponse;
  currentVersion: ProposalVersionResponse | null;
};

export function toProposalResponse(row: ProposalRow): ProposalResponse {
  return {
    id: row.id,
    proposalCode: row.proposal_code,
    clientId: row.client_id,
    unitId: row.unit_id,
    title: row.title,
    currentVersionNumber: row.current_version_number,
    rowVersion: row.row_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Item da LISTAGEM: a proposta acrescida da projecao da versao corrente.
 *
 * Nenhum campo e derivado de suposicao. Quando a proposta ainda nao tem versao
 * (`currentVersionNumber === null` nao encontra linha em `com.proposal_versions`), todos os
 * campos de versao vem `null` e a interface declara a ausencia.
 */
export type ProposalListItemResponse = ProposalResponse & {
  currentVersionStatus: string | null;
  currencyCode: string | null;
  validUntil: string | null;
  /** Valor de venda da versao corrente, conforme a regra de precificacao ja existente. */
  saleTotal: string | null;
};

/**
 * Valor de venda da versao corrente.
 *
 * Reusa a mesma regra que o dominio ja aplica em `assertIssueReady` e na emissao:
 * `GLOBAL_PRICE` -> `global_sale_price_amount`; `ITEMIZED` -> `items_sale_total_amount`
 * (soma das linhas, persistida na emissao). Nao recalcula nada e nao cria regra nova.
 */
function resolveProposalSaleTotal(version: ProposalListVersionRow): string | null {
  const amount =
    version.pricing_structure === PROPOSAL_PRICING_STRUCTURES.GlobalPrice
      ? version.global_sale_price_amount
      : version.items_sale_total_amount;
  return formatMoneyAmountForApi(amount);
}

export function toProposalListItemResponse(
  row: ProposalRow,
  currentVersion: ProposalListVersionRow | null,
): ProposalListItemResponse {
  return {
    ...toProposalResponse(row),
    currentVersionStatus: currentVersion?.status ?? null,
    currencyCode: currentVersion?.currency_code ?? null,
    validUntil: currentVersion?.valid_until ?? null,
    saleTotal: currentVersion ? resolveProposalSaleTotal(currentVersion) : null,
  };
}

export function toProposalItemResponse(row: ProposalItemRow): ProposalItemResponse {
  const commercial = resolveCommercialItemFields(row);
  return {
    id: row.id,
    lineNumber: row.line_number,
    itemKind: commercial.itemKind,
    description: commercial.description,
    serviceDefinitionId: row.service_definition_id,
    serviceDefinitionVersionId: row.service_definition_version_id,
    serviceSnapshot: row.service_snapshot,
    commercialSnapshot: row.commercial_snapshot,
    quantity: commercial.quantity,
    unitCode: commercial.unitCode,
    unitSalePrice: commercial.unitSalePrice,
    unitInternalCost: commercial.unitInternalCost,
    lineSaleAmount: commercial.lineSaleAmount,
    lineInternalCost: commercial.lineInternalCost,
  };
}

export function toProposalDocumentLinkResponse(
  row: ProposalDocumentLinkRow,
): ProposalDocumentLinkResponse {
  return toDocumentLinkResponse(row);
}

export function toProposalVersionResponse(
  version: ProposalVersionRow,
  items: ProposalItemRow[],
  documents: ProposalDocumentLinkRow[],
): ProposalVersionResponse {
  return {
    id: version.id,
    proposalId: version.proposal_id,
    versionNumber: version.version_number,
    status: version.status,
    pricingStructure: version.pricing_structure,
    currencyCode: version.currency_code,
    globalSalePrice: formatMoneyAmountForApi(version.global_sale_price_amount),
    globalInternalCost: formatMoneyAmountForApi(version.global_internal_cost_amount),
    itemsSaleTotal: formatMoneyAmountForApi(version.items_sale_total_amount),
    itemsInternalCostTotal: formatMoneyAmountForApi(version.items_internal_cost_total_amount),
    commercialTerms: version.commercial_terms ?? {},
    clientSnapshot: version.client_snapshot,
    validUntil: version.valid_until,
    notes: version.notes,
    issuedAt: version.issued_at,
    issuedByIdentityId: version.issued_by_identity_id,
    supersededAt: version.superseded_at,
    acceptedAt: version.accepted_at,
    acceptedByIdentityId: version.accepted_by_identity_id,
    acceptanceOriginCode: version.acceptance_origin_code,
    acceptanceEvidenceDocumentId: version.acceptance_evidence_document_id,
    rejectedAt: version.rejected_at,
    rejectionReason: version.rejection_reason,
    expiredAt: version.expired_at,
    cancelledAt: version.cancelled_at,
    cancellationReason: version.cancellation_reason,
    rowVersion: version.row_version,
    items: items.map(toProposalItemResponse),
    documents: documents.map(toProposalDocumentLinkResponse),
  };
}

export function buildProposalDetail(
  proposal: ProposalRow,
  version: ProposalVersionRow | null,
  items: ProposalItemRow[],
  documents: ProposalDocumentLinkRow[],
): ProposalDetailResponse {
  return {
    proposal: toProposalResponse(proposal),
    currentVersion: version
      ? toProposalVersionResponse(version, items, documents)
      : null,
  };
}

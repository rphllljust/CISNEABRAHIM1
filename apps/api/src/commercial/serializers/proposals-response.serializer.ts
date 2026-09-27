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
  ProposalLinkedRow,
  ProposalListVersionRow,
  ProposalRow,
  ProposalVersionRow,
  ProposalWorkbenchRow,
} from '../repositories/proposals.repository.types';
import type {
  ProposalNextStepCode,
  ProposalTransition,
} from '../domain/proposal-readiness';
import type { ProposalRevisionDiff } from '../domain/proposal-revision-diff';

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

/** Elo da cadeia comercial (origem ou destino), ja autorizado pelo modulo dono. */
export type ProposalLinkedResponse = {
  kind: string;
  id: string;
  label: string;
  status: string | null;
  occurredAt: string;
  /** Quando a relacao chega por intermedio de outro objeto (ex.: pedido de compra via OS). */
  viaLabel: string | null;
};

export type ProposalReadinessResponse = {
  nextStep: ProposalNextStepCode;
  nextStepTransition: ProposalTransition | null;
  availableTransitions: ProposalTransition[];
  blockers: string[];
};

/**
 * Visibilidade da projecao comercial.
 *
 * `includeInternalCost` e resolvido UMA vez por requisicao a partir de
 * `commercial:proposal:read-cost` (PDP + grants + contexto da proposta) e atravessa a serializacao:
 * o custo interno so sai daqui quando a resposta foi construida com essa visibilidade ligada.
 * Nenhum caminho de resposta tem default permissivo.
 */
export type ProposalCostVisibility = {
  includeInternalCost: boolean;
};

export const PROPOSAL_COST_HIDDEN: ProposalCostVisibility = { includeInternalCost: false };

/**
 * Mascara canonica de custo do CISNE (mesma semantica de `analytics/operational-profitability`):
 * o campo permanece na forma da resposta com `null` quando o ator nao tem visibilidade de custo.
 * O dado sensivel nunca e montado no JSON — nao existe "manda e esconde no React".
 */
function maskInternalCost(
  value: string | null,
  visibility: ProposalCostVisibility,
): string | null {
  return visibility.includeInternalCost ? value : null;
}

/**
 * O snapshot comercial do item e um objeto aninhado que tambem carrega custo interno
 * (`unitInternalCost` / `lineInternalCost`). Sem mascara-lo, a protecao dos campos planos seria
 * contornada por um alias equivalente dentro do snapshot.
 */
function maskCommercialSnapshot(
  snapshot: Record<string, unknown> | null,
  visibility: ProposalCostVisibility,
): Record<string, unknown> | null {
  if (!snapshot || visibility.includeInternalCost) {
    return snapshot;
  }
  return {
    ...snapshot,
    unitInternalCost: null,
    lineInternalCost: null,
  };
}

export type ProposalRelatedResponse = {
  client: { id: string; name: string } | null;
};

/** Revisao comercial: uma linha de `com.proposal_versions`, com o que ela substituiu. */
export type ProposalRevisionSummaryResponse = {
  versionNumber: number;
  status: string;
  saleTotal: string | null;
  currencyCode: string;
  validUntil: string | null;
  createdAt: string;
  issuedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  supersededAt: string | null;
  isCurrent: boolean;
  supersedesVersionNumber: number | null;
  itemCount: number;
};

export type ProposalDetailResponse = {
  proposal: ProposalResponse;
  currentVersion: ProposalVersionResponse | null;
  related: ProposalRelatedResponse;
  revisions: ProposalRevisionSummaryResponse[];
  revisionComparison: ProposalRevisionDiff | null;
  /**
   * Apenas os elos que o ator pode ler no modulo dono. Elo negado e OMITIDO em silencio — a resposta
   * nao declara existencia de vinculo oculto (mesmo padrao do pedido de compra e das solicitacoes).
   */
  linkedChain: ProposalLinkedResponse[];
  readiness: ProposalReadinessResponse;
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
 * Item da LISTAGEM: a proposta acrescida da projecao da versao corrente e do contexto comercial
 * ja autorizado (nome do cliente e solicitacao de origem).
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
  /** Nome do cliente quando o modulo CLIENTES autoriza; `null` quando nao autoriza. */
  clientName: string | null;
  revisionNumber: number | null;
  revisionCount: number;
  /** Solicitacoes de origem que o ator PODE ler; quando nenhuma e legivel, vem vazio. */
  originRequests: Array<{ id: string; requestCode: string; status: string }>;
  issuedAt: string | null;
  acceptedAt: string | null;
};

export type ProposalListEnrichment = {
  clientName: string | null;
  originRequests: Array<{ id: string; requestCode: string; status: string }>;
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
  enrichment: ProposalListEnrichment = { clientName: null, originRequests: [] },
): ProposalListItemResponse {
  return {
    ...toProposalResponse(row),
    currentVersionStatus: currentVersion?.status ?? null,
    currencyCode: currentVersion?.currency_code ?? null,
    validUntil: currentVersion?.valid_until ?? null,
    saleTotal: currentVersion ? resolveProposalSaleTotal(currentVersion) : null,
    clientName: enrichment.clientName,
    revisionNumber: row.current_version_number,
    revisionCount: 0,
    originRequests: enrichment.originRequests,
    issuedAt: null,
    acceptedAt: null,
  };
}

/**
 * Item da fila comercial a partir da projecao de trabalho (proposta + versao corrente + contagem
 * de revisoes calculada no banco).
 */
export function toProposalWorkbenchItemResponse(
  row: ProposalWorkbenchRow,
  enrichment: ProposalListEnrichment,
): ProposalListItemResponse {
  const saleTotal = row.pricing_structure
    ? resolveProposalSaleTotal({
        proposal_id: row.id,
        status: row.current_version_status ?? '',
        currency_code: row.currency_code ?? '',
        pricing_structure: row.pricing_structure,
        global_sale_price_amount: row.global_sale_price_amount,
        items_sale_total_amount: row.items_sale_total_amount,
        valid_until: row.valid_until,
      })
    : null;

  return {
    ...toProposalResponse(row),
    currentVersionStatus: row.current_version_status,
    currencyCode: row.currency_code,
    validUntil: row.valid_until,
    saleTotal,
    clientName: enrichment.clientName,
    revisionNumber: row.revision_number,
    revisionCount: row.revision_count,
    originRequests: enrichment.originRequests,
    issuedAt: row.issued_at,
    acceptedAt: row.accepted_at,
  };
}

export function toProposalLinkedResponse(row: ProposalLinkedRow): ProposalLinkedResponse {
  return {
    kind: row.kind,
    id: row.id,
    label: row.label,
    status: row.status,
    occurredAt: row.occurred_at,
    viaLabel: row.via_label,
  };
}

export function toProposalRevisionSummaryResponse(
  version: ProposalVersionRow,
  currentVersionNumber: number | null,
  itemCount: number,
  previousVersionNumber: number | null,
): ProposalRevisionSummaryResponse {
  return {
    versionNumber: version.version_number,
    status: version.status,
    saleTotal: resolveProposalSaleTotal({
      proposal_id: version.proposal_id,
      status: version.status,
      currency_code: version.currency_code,
      pricing_structure: version.pricing_structure,
      global_sale_price_amount: version.global_sale_price_amount,
      items_sale_total_amount: version.items_sale_total_amount,
      valid_until: version.valid_until,
    }),
    currencyCode: version.currency_code,
    validUntil: version.valid_until,
    createdAt: version.created_at,
    issuedAt: version.issued_at,
    acceptedAt: version.accepted_at,
    rejectedAt: version.rejected_at,
    expiredAt: version.expired_at,
    cancelledAt: version.cancelled_at,
    supersededAt: version.superseded_at,
    isCurrent: currentVersionNumber === version.version_number,
    supersedesVersionNumber: previousVersionNumber,
    itemCount,
  };
}

export function toProposalItemResponse(
  row: ProposalItemRow,
  visibility: ProposalCostVisibility = PROPOSAL_COST_HIDDEN,
): ProposalItemResponse {
  const commercial = resolveCommercialItemFields(row);
  return {
    id: row.id,
    lineNumber: row.line_number,
    itemKind: commercial.itemKind,
    description: commercial.description,
    serviceDefinitionId: row.service_definition_id,
    serviceDefinitionVersionId: row.service_definition_version_id,
    serviceSnapshot: row.service_snapshot,
    commercialSnapshot: maskCommercialSnapshot(row.commercial_snapshot, visibility),
    quantity: commercial.quantity,
    unitCode: commercial.unitCode,
    unitSalePrice: commercial.unitSalePrice,
    unitInternalCost: maskInternalCost(commercial.unitInternalCost, visibility),
    lineSaleAmount: commercial.lineSaleAmount,
    lineInternalCost: maskInternalCost(commercial.lineInternalCost, visibility),
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
  visibility: ProposalCostVisibility = PROPOSAL_COST_HIDDEN,
): ProposalVersionResponse {
  return {
    id: version.id,
    proposalId: version.proposal_id,
    versionNumber: version.version_number,
    status: version.status,
    pricingStructure: version.pricing_structure,
    currencyCode: version.currency_code,
    globalSalePrice: formatMoneyAmountForApi(version.global_sale_price_amount),
    globalInternalCost: maskInternalCost(
      formatMoneyAmountForApi(version.global_internal_cost_amount),
      visibility,
    ),
    itemsSaleTotal: formatMoneyAmountForApi(version.items_sale_total_amount),
    itemsInternalCostTotal: maskInternalCost(
      formatMoneyAmountForApi(version.items_internal_cost_total_amount),
      visibility,
    ),
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
    items: items.map((item) => toProposalItemResponse(item, visibility)),
    documents: documents.map(toProposalDocumentLinkResponse),
  };
}

export function buildProposalDetail(
  proposal: ProposalRow,
  version: ProposalVersionRow | null,
  items: ProposalItemRow[],
  documents: ProposalDocumentLinkRow[],
  extras: {
    related?: ProposalRelatedResponse;
    revisions?: ProposalRevisionSummaryResponse[];
    revisionComparison?: ProposalRevisionDiff | null;
    linkedChain?: ProposalLinkedRow[];
    readiness?: ProposalReadinessResponse;
  } = {},
  visibility: ProposalCostVisibility = PROPOSAL_COST_HIDDEN,
): ProposalDetailResponse {
  return {
    proposal: toProposalResponse(proposal),
    currentVersion: version
      ? toProposalVersionResponse(version, items, documents, visibility)
      : null,
    related: extras.related ?? { client: null },
    revisions: extras.revisions ?? [],
    revisionComparison: extras.revisionComparison ?? null,
    linkedChain: (extras.linkedChain ?? []).map(toProposalLinkedResponse),
    readiness:
      extras.readiness ?? {
        nextStep: 'CLOSED',
        nextStepTransition: null,
        availableTransitions: [],
        blockers: [],
      },
  };
}

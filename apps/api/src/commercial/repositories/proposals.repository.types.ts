import type {
  ProposalItemInput,
  UpdateProposalDraftInput,
} from '../domain/proposal.validation';

export type ProposalRow = {
  id: string;
  proposal_code: string;
  client_id: string;
  unit_id: string;
  title: string;
  current_version_number: number | null;
  row_version: number;
  created_at: string;
  updated_at: string;
};

/**
 * Versao CORRENTE de uma proposta, projetada para a listagem.
 *
 * Todos os campos ja existem em `com.proposal_versions`. A relacao com "corrente" usa
 * `com.proposals.current_version_number`, que tambem ja existe. Nenhuma coluna ou tabela nova.
 */
export type ProposalListVersionRow = {
  proposal_id: string;
  status: string;
  currency_code: string;
  pricing_structure: string;
  global_sale_price_amount: string | null;
  items_sale_total_amount: string | null;
  valid_until: string | null;
};

export type ProposalVersionRow = {
  id: string;
  proposal_id: string;
  version_number: number;
  status: string;
  pricing_structure: string;
  currency_code: string;
  global_sale_price_amount: string | null;
  global_internal_cost_amount: string | null;
  items_sale_total_amount: string | null;
  items_internal_cost_total_amount: string | null;
  commercial_terms: Record<string, unknown>;
  client_snapshot: Record<string, unknown> | null;
  valid_until: string | null;
  notes: string | null;
  issued_at: string | null;
  issued_by_identity_id: string | null;
  superseded_at: string | null;
  accepted_at: string | null;
  accepted_by_identity_id: string | null;
  acceptance_origin_code: string | null;
  acceptance_evidence_document_id: string | null;
  rejected_at: string | null;
  rejected_by_identity_id: string | null;
  rejection_reason: string | null;
  expired_at: string | null;
  cancelled_at: string | null;
  cancelled_by_identity_id: string | null;
  cancellation_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
};

export type ProposalItemRow = {
  id: string;
  proposal_version_id: string;
  line_number: number;
  item_kind: string;
  description: string;
  service_definition_id: string | null;
  service_definition_version_id: string | null;
  service_snapshot: Record<string, unknown> | null;
  commercial_snapshot: Record<string, unknown> | null;
  quantity: string | null;
  unit_code: string | null;
  unit_sale_price_amount: string | null;
  unit_internal_cost_amount: string | null;
  line_sale_amount: string | null;
  line_internal_cost_amount: string | null;
};

export type ProposalDocumentLinkRow = {
  id: string;
  proposal_version_id: string;
  document_id: string;
  link_purpose: string;
  created_at: string;
};

export type ClientSnapshotSource = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  normalized_tax_id: string;
  status: string;
};

export type ServiceSnapshotSource = {
  service_definition_id: string;
  service_definition_version_id: string;
  code: string;
  name: string;
  version: number;
  version_status: string;
};

export type CreateProposalPersistenceInput = {
  proposalCode: string;
  clientId: string;
  unitId: string;
  title: string;
  pricingStructure: string;
  currencyCode: string;
  globalSalePrice: string | null;
  globalInternalCost: string | null;
  commercialTerms: Record<string, unknown>;
  validUntil?: string | null;
  notes?: string | null;
  items: ProposalItemInput[];
  actorIdentityId: string;
};

export type UpdateProposalDraftPersistenceInput = UpdateProposalDraftInput & {
  proposalId: string;
  versionNumber: number;
  actorIdentityId: string;
};

/**
 * Linha da FILA COMERCIAL: a proposta com a projecao da versao corrente e a contagem de revisoes.
 *
 * Tudo ja existe em `com.proposals` / `com.proposal_versions`. As contagens sao subconsultas
 * escalares agregadas — nenhuma consulta por linha.
 */
export type ProposalWorkbenchRow = ProposalRow & {
  current_version_status: string | null;
  pricing_structure: string | null;
  currency_code: string | null;
  global_sale_price_amount: string | null;
  items_sale_total_amount: string | null;
  valid_until: string | null;
  revision_number: number | null;
  issued_at: string | null;
  accepted_at: string | null;
  superseded_at: string | null;
  revision_count: number;
  prior_revision_count: number;
};

/** Rotulo humano de cliente resolvido em lote (nunca um lookup por linha). */
export type ProposalClientLabelRow = {
  id: string;
  legal_name: string;
  trade_name: string | null;
};

/** Solicitacao de servico ligada a proposta, projetada para a origem comercial. */
export type ProposalLinkedRow = {
  kind: string;
  id: string;
  label: string;
  status: string | null;
  occurred_at: string;
  unit_id: string;
  client_id: string | null;
  /** Preenchido quando a relacao chega por intermedio de outro objeto (pedido via OS). */
  via_label: string | null;
  /** Preenchido apenas no agrupamento de origem: a proposta que a solicitacao referencia. */
  proposal_id: string | null;
};

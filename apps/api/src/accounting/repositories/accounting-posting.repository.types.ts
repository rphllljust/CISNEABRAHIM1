export type PostingRuleRow = {
  id: string;
  unit_id: string;
  code: string;
  name: string;
  origin_kind: string;
  event_kind: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PostingRuleVersionRow = {
  id: string;
  posting_rule_id: string;
  version_number: number;
  status: string;
  debit_account_id: string;
  credit_account_id: string;
  required_context: string[];
  effective_from: string;
  effective_to: string | null;
  source_reference: string;
  row_version: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PostingRequestRow = {
  id: string;
  unit_id: string;
  origin_kind: string;
  event_kind: string;
  source_id: string;
  source_reference: string;
  idempotency_key: string;
  posting_rule_id: string;
  posting_rule_version_id: string;
  journal_entry_id: string | null;
  status: string;
  amount: string;
  currency_code: string;
  occurred_on: string;
  context: Record<string, unknown>;
  actor_identity_id: string;
  created_at: string;
  updated_at: string;
};

export type PersistPostingRuleInput = {
  unitId: string;
  code: string;
  name: string;
  originKind: string;
  eventKind: string;
  actorIdentityId: string;
};

/** Linha de rastreabilidade: pedido de lancamento + numero do lancamento gerado (LEFT JOIN). */
export type PostingRequestListRow = PostingRequestRow & {
  journal_entry_number: string | null;
  journal_entry_status: string | null;
  journal_entry_posted_at: Date | null;
};

export type PostingRequestListFilter = {
  unitId: string;
  status?: string;
  originKind?: string;
  eventKind?: string;
  occurredFrom?: string;
  occurredTo?: string;
  page: number;
  pageSize: number;
};

export type PersistPostingRuleVersionInput = {
  postingRuleId: string;
  debitAccountId: string;
  creditAccountId: string;
  requiredContext: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceReference: string;
  actorIdentityId: string;
};

export type PersistPostingRequestInput = {
  unitId: string;
  originKind: string;
  eventKind: string;
  sourceId: string;
  sourceReference: string;
  idempotencyKey: string;
  postingRuleId: string;
  postingRuleVersionId: string;
  journalEntryId: string;
  amount: string;
  currencyCode: string;
  occurredOn: string;
  context: Record<string, unknown>;
  actorIdentityId: string;
};

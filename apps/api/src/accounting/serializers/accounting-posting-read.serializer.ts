import type { PostingRequestListRow } from '../repositories/accounting-posting.repository.types';
import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';

function money(value: string): string {
  return formatMoneyAmountForApi(value) ?? value;
}

/**
 * Item de rastreabilidade: liga o evento de negocio (origem + evento + referencia) ao
 * lancamento contabil gerado, sem recalcular nada. Valores vem do snapshot persistido.
 */
export type PostingRequestListItemResponse = {
  id: string;
  unitId: string;
  originKind: string;
  eventKind: string;
  sourceId: string;
  sourceReference: string;
  amount: string;
  currencyCode: string;
  occurredOn: string;
  status: string;
  postingRuleId: string;
  postingRuleVersionId: string;
  actorIdentityId: string;
  createdAt: string;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  journalEntryStatus: string | null;
  journalEntryPostedAt: string | null;
};

export type PostingRequestPageResponse = {
  unitId: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  statusCounts: Record<string, number>;
  items: PostingRequestListItemResponse[];
};

export function toPostingRequestListItemResponse(
  row: PostingRequestListRow,
): PostingRequestListItemResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    originKind: row.origin_kind,
    eventKind: row.event_kind,
    sourceId: row.source_id,
    sourceReference: row.source_reference,
    amount: money(row.amount),
    currencyCode: row.currency_code,
    occurredOn: row.occurred_on.slice(0, 10),
    status: row.status,
    postingRuleId: row.posting_rule_id,
    postingRuleVersionId: row.posting_rule_version_id,
    actorIdentityId: row.actor_identity_id,
    createdAt: new Date(row.created_at).toISOString(),
    journalEntryId: row.journal_entry_id,
    journalEntryNumber: row.journal_entry_number,
    journalEntryStatus: row.journal_entry_status,
    journalEntryPostedAt: row.journal_entry_posted_at
      ? new Date(row.journal_entry_posted_at).toISOString()
      : null,
  };
}

export function toPostingRequestPageResponse(input: {
  unitId: string;
  page: number;
  pageSize: number;
  total: number;
  statusCounts: Record<string, number>;
  items: PostingRequestListRow[];
}): PostingRequestPageResponse {
  return {
    unitId: input.unitId,
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages: input.pageSize > 0 ? Math.ceil(input.total / input.pageSize) : 0,
    statusCounts: input.statusCounts,
    items: input.items.map(toPostingRequestListItemResponse),
  };
}

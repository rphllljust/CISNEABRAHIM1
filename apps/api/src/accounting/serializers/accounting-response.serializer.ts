import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import { reconstructLedger } from '../domain/ledger';
import type {
  AccountingAccountRow,
  AccountingPeriodRow,
  ChartOfAccountsRow,
  JournalAggregate,
  JournalEntryLineRow,
  JournalEntryRow,
} from '../repositories/accounting.repository.types';

export type ChartResponse = {
  id: string;
  unitId: string;
  code: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type AccountResponse = {
  id: string;
  chartId: string;
  parentId: string | null;
  code: string;
  name: string;
  class: string;
  status: string;
};

export type PeriodCloseCheckResponse = {
  kind: string;
  result: string;
  blocking: boolean;
  observedCount: number;
  detail: string;
};

export type PeriodResponse = {
  id: string;
  chartId: string;
  unitId: string;
  code: string;
  startsOn: string;
  endsOn: string;
  status: string;
  reopenCount: number;
  rowVersion: number;
  closedAt: string | null;
  reopenedAt: string | null;
  closeChecks: PeriodCloseCheckResponse[];
};

export type JournalLineResponse = {
  id: string;
  lineNumber: number;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  accountClass?: string;
  accountStatus?: string;
  direction: string;
  amount: string;
  description: string | null;
};

export type JournalResponse = {
  id: string;
  chartId: string;
  periodId: string;
  unitId: string;
  status: string;
  kind: string;
  description: string;
  occurredOn: string;
  currencyCode: string;
  sourceKind: string;
  sourceId: string;
  sourceReference: string;
  idempotencyKey: string;
  reversesEntryId: string | null;
  /**
   * Lancamento de estorno que anulou este, quando existir. Ausente na lista (consulta em
   * lote nao carrega o vinculo reverso) e presente no detalhe.
   */
  reversedByEntryId: string | null;
  reversedByEntryNumber: number | null;
  entryNumber: number | null;
  postedAt: string | null;
  postedBy: string | null;
  rowVersion: number;
  debitTotal: string;
  creditTotal: string;
  balanced: boolean;
  lines: JournalLineResponse[];
};

export type LedgerReconstructionResponse = {
  chartId: string;
  totalDebits: string;
  totalCredits: string;
  balanced: boolean;
  accounts: Array<{ accountId: string; debits: string; credits: string }>;
};

export function toChartResponse(row: ChartOfAccountsRow): ChartResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    code: row.code,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAccountResponse(row: AccountingAccountRow): AccountResponse {
  return {
    id: row.id,
    chartId: row.chart_id,
    parentId: row.parent_id,
    code: row.code,
    name: row.name,
    class: row.class,
    status: row.status,
  };
}

export function toPeriodResponse(
  row: AccountingPeriodRow,
  closeChecks: PeriodCloseCheckResponse[] = [],
): PeriodResponse {
  return {
    id: row.id,
    chartId: row.chart_id,
    unitId: row.unit_id,
    code: row.code,
    startsOn: row.starts_on.slice(0, 10),
    endsOn: row.ends_on.slice(0, 10),
    status: row.status,
    reopenCount: row.reopen_count,
    rowVersion: row.row_version,
    closedAt: row.closed_at,
    reopenedAt: row.reopened_at,
    closeChecks,
  };
}

/**
 * `reversal` e opcional: a lista de lancamentos nao carrega o vinculo reverso para nao
 * introduzir consulta por linha. O detalhe do lancamento carrega e informa.
 */
export function toJournalResponse(
  aggregate: JournalAggregate,
  reversal: JournalEntryRow | null = null,
): JournalResponse {
  const reconstruction = reconstructLedger(
    aggregate.lines.map((line) => ({
      accountId: line.account_id,
      direction: line.direction,
      amount: line.amount,
    })),
  );
  return {
    id: aggregate.entry.id,
    chartId: aggregate.entry.chart_id,
    periodId: aggregate.entry.period_id,
    unitId: aggregate.entry.unit_id,
    status: aggregate.entry.status,
    kind: aggregate.entry.kind,
    description: aggregate.entry.description,
    occurredOn: aggregate.entry.occurred_on.slice(0, 10),
    currencyCode: aggregate.entry.currency_code,
    sourceKind: aggregate.entry.source_kind,
    sourceId: aggregate.entry.source_id,
    sourceReference: aggregate.entry.source_reference,
    idempotencyKey: aggregate.entry.idempotency_key,
    reversesEntryId: aggregate.entry.reverses_entry_id,
    reversedByEntryId: reversal?.id ?? null,
    reversedByEntryNumber: reversal?.entry_number ?? null,
    entryNumber: aggregate.entry.entry_number,
    postedAt: aggregate.entry.posted_at,
    postedBy: aggregate.entry.posted_by_identity_id,
    rowVersion: aggregate.entry.row_version,
    debitTotal: formatMoneyAmountForApi(reconstruction.totalDebits) ?? reconstruction.totalDebits,
    creditTotal: formatMoneyAmountForApi(reconstruction.totalCredits) ?? reconstruction.totalCredits,
    balanced: reconstruction.balanced,
    lines: aggregate.lines.map(toLineResponse),
  };
}

export function toLedgerReconstructionResponse(
  chartId: string,
  lines: JournalEntryLineRow[],
): LedgerReconstructionResponse {
  const reconstruction = reconstructLedger(
    lines.map((line) => ({
      accountId: line.account_id,
      direction: line.direction,
      amount: line.amount,
    })),
  );
  return {
    chartId,
    totalDebits: formatMoneyAmountForApi(reconstruction.totalDebits) ?? reconstruction.totalDebits,
    totalCredits: formatMoneyAmountForApi(reconstruction.totalCredits) ?? reconstruction.totalCredits,
    balanced: reconstruction.balanced,
    accounts: Object.entries(reconstruction.byAccount).map(([accountId, totals]) => ({
      accountId,
      debits: formatMoneyAmountForApi(totals.debits) ?? totals.debits,
      credits: formatMoneyAmountForApi(totals.credits) ?? totals.credits,
    })),
  };
}

function toLineResponse(
  line: JournalEntryLineRow & {
    account_code?: string;
    account_name?: string;
    account_class?: string;
    account_status?: string;
  },
): JournalLineResponse {
  const response: JournalLineResponse = {
    id: line.id,
    lineNumber: line.line_number,
    accountId: line.account_id,
    direction: line.direction,
    amount: formatMoneyAmountForApi(line.amount) ?? line.amount,
    description: line.description,
  };
  if (line.account_code !== undefined) {
    response.accountCode = line.account_code;
    response.accountName = line.account_name;
    response.accountClass = line.account_class;
    response.accountStatus = line.account_status;
  }
  return response;
}

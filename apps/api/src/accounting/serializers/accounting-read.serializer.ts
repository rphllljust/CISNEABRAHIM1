import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import type {
  AccountingJournalListItem,
  AccountingPeriodRow,
  ChartOfAccountsRow,
  LedgerMovementRow,
  PeriodCloseCheckDetailRow,
  PeriodCloseRunDetailRow,
} from '../repositories/accounting.repository.types';
import type {
  AccountResponse,
  ChartResponse,
  JournalResponse,
  PeriodResponse,
} from './accounting-response.serializer';
import {
  toAccountResponse,
  toChartResponse,
  toJournalResponse,
  toPeriodResponse,
} from './accounting-response.serializer';

function money(value: string): string {
  return formatMoneyAmountForApi(value) ?? value;
}

export type ChartsListResponse = {
  unitId: string;
  items: ChartResponse[];
};

export type AccountsListResponse = {
  chartId: string;
  items: AccountResponse[];
};

export type PeriodsListResponse = {
  chartId: string;
  items: PeriodResponse[];
};

/**
 * Descoberta de periodo pela UNIDADE, sem exigir o plano de contas.
 *
 * A referencia humana e o proprio `code` do periodo mais o intervalo de datas — o identificador
 * tecnico existe apenas para endereçar as acoes ja autorizadas.
 */
export type PeriodsByUnitListResponse = {
  unitId: string;
  items: PeriodResponse[];
};

export type JournalPageResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: JournalResponse[];
};

export type SideBalance = {
  side: 'DEBIT' | 'CREDIT';
  amount: string;
};

export type AccountLedgerMovementResponse = {
  journalEntryId: string;
  occurredOn: string;
  description: string;
  sourceReference: string;
  kind: string;
  direction: string;
  amount: string;
  runningBalance: SideBalance;
};

export type AccountLedgerResponse = {
  periodId: string;
  account: {
    id: string;
    code: string;
    name: string;
    class: string;
    status: string;
    normalBalance: string;
  } | null;
  source: 'POSTED_JOURNAL_ENTRY';
  openingBalance: SideBalance;
  periodDebits: string;
  periodCredits: string;
  closingBalance: SideBalance;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  movements: AccountLedgerMovementResponse[];
};

export type PeriodCloseCheckDetailResponse = {
  kind: string;
  result: string;
  blocking: boolean;
  observedCount: number;
  detail: string;
};

export type PeriodCloseRunResponse = {
  id: string;
  status: string;
  createdAt: string;
  checks: PeriodCloseCheckDetailResponse[];
};

export type CloseRunsResponse = {
  periodId: string;
  runs: PeriodCloseRunResponse[];
};

export function toChartsListResponse(unitId: string, rows: ChartOfAccountsRow[]): ChartsListResponse {
  return { unitId, items: rows.map(toChartResponse) };
}

export function toAccountsListResponse(chartId: string, rows: Array<Parameters<typeof toAccountResponse>[0]>): AccountsListResponse {
  return { chartId, items: rows.map(toAccountResponse) };
}

export function toPeriodsListResponse(
  chartId: string,
  rows: AccountingPeriodRow[],
): PeriodsListResponse {
  return { chartId, items: rows.map((row) => toPeriodResponse(row)) };
}

export function toJournalPageResponse(input: {
  page: number;
  pageSize: number;
  total: number;
  items: AccountingJournalListItem[];
}): JournalPageResponse {
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages: Math.ceil(input.total / input.pageSize),
    items: input.items.map((item) => toJournalResponse(item)),
  };
}

export function toAccountLedgerResponse(input: {
  periodId: string;
  account:
    | { id: string; code: string; name: string; class: string; status: string; normalBalance: string }
    | null;
  openingBalance: SideBalance;
  periodDebits: string;
  periodCredits: string;
  closingBalance: SideBalance;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  movements: Array<LedgerMovementRow & { runningBalance: SideBalance }>;
}): AccountLedgerResponse {
  return {
    periodId: input.periodId,
    account: input.account,
    source: 'POSTED_JOURNAL_ENTRY',
    openingBalance: { side: input.openingBalance.side, amount: money(input.openingBalance.amount) },
    periodDebits: money(input.periodDebits),
    periodCredits: money(input.periodCredits),
    closingBalance: { side: input.closingBalance.side, amount: money(input.closingBalance.amount) },
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages: input.totalPages,
    movements: input.movements.map((movement) => ({
      journalEntryId: movement.journal_entry_id,
      occurredOn: movement.occurred_on.slice(0, 10),
      description: movement.description,
      sourceReference: movement.source_reference,
      kind: movement.kind,
      direction: movement.direction,
      amount: money(movement.amount),
      runningBalance: {
        side: movement.runningBalance.side,
        amount: money(movement.runningBalance.amount),
      },
    })),
  };
}

export function toCloseRunsResponse(
  periodId: string,
  runs: Array<{ run: PeriodCloseRunDetailRow; checks: PeriodCloseCheckDetailRow[] }>,
): CloseRunsResponse {
  return {
    periodId,
    runs: runs.map(({ run, checks }) => ({
      id: run.id,
      status: run.status,
      createdAt: run.created_at,
      checks: checks.map((check) => ({
        kind: check.kind,
        result: check.result,
        blocking: check.blocking,
        observedCount: check.observed_count,
        detail: check.detail,
      })),
    })),
  };
}

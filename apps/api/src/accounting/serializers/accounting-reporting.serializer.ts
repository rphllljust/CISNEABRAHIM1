import {
  compareMoneyAmounts,
  formatMoneyAmountForApi,
  moneyAmountsEqual,
  subtractMoneyAmounts,
  sumMoneyAmounts,
} from '../../platform/kernel/money-math';
import {
  balanceSheetFromTotals,
  formatReportAmount,
  incomeStatementFromTotals,
  trialBalanceFromTotals,
  type AccountPeriodTotals,
} from '../domain/reporting';
import type {
  AccountingAccountRow,
  JournalAggregate,
  LedgerMovementRow,
} from '../repositories/accounting.repository.types';
import { toJournalResponse, type JournalResponse } from './accounting-response.serializer';

export type JournalBookResponse = {
  periodId: string;
  source: 'POSTED_JOURNAL_ENTRY';
  entries: JournalResponse[];
  totalDebits: string;
  totalCredits: string;
  difference: string;
  balanced: boolean;
};

export type GeneralLedgerAccountResponse = {
  accountId: string;
  code: string;
  name: string;
  class: string;
  openingDebits: string;
  openingCredits: string;
  periodDebits: string;
  periodCredits: string;
  closingDebits: string;
  closingCredits: string;
  closingBalanceDebit: string;
  closingBalanceCredit: string;
  movements: Array<{
    journalEntryId: string;
    occurredOn: string;
    description: string;
    sourceReference: string;
    kind: string;
    direction: string;
    amount: string;
  }>;
};

export type GeneralLedgerResponse = {
  periodId: string;
  source: 'POSTED_JOURNAL_ENTRY';
  accounts: GeneralLedgerAccountResponse[];
};

export type TrialBalanceResponse = {
  periodId: string;
  source: 'POSTED_JOURNAL_ENTRY';
  accounts: Array<{
    accountId: string;
    code: string;
    name: string;
    class: string;
    debit: string;
    credit: string;
  }>;
  totalDebits: string;
  totalCredits: string;
  difference: string;
  balanced: boolean;
};

export type IncomeStatementResponse = {
  periodId: string;
  source: 'POSTED_JOURNAL_ENTRY';
  available: boolean;
  revenue: string;
  expense: string;
  netIncome: string;
};

export type BalanceSheetResponse = {
  periodId: string;
  source: 'POSTED_JOURNAL_ENTRY';
  available: boolean;
  assets: string;
  liabilities: string;
  equity: string;
  netIncome: string;
  balanced: boolean;
};

function money(value: string): string {
  return formatReportAmount(value);
}

export function toJournalBookResponse(
  periodId: string,
  aggregates: JournalAggregate[],
): JournalBookResponse {
  const entries = aggregates.map((aggregate) => toJournalResponse(aggregate));
  const totalDebits = sumMoneyAmounts(entries.map((entry) => entry.debitTotal));
  const totalCredits = sumMoneyAmounts(entries.map((entry) => entry.creditTotal));
  const balanced = moneyAmountsEqual(totalDebits, totalCredits);
  const difference = balanced
    ? '0.0000'
    : compareMoneyAmounts(totalDebits, totalCredits) > 0
      ? subtractMoneyAmounts(totalDebits, totalCredits)
      : subtractMoneyAmounts(totalCredits, totalDebits);
  return {
    periodId,
    source: 'POSTED_JOURNAL_ENTRY',
    entries,
    totalDebits: money(totalDebits),
    totalCredits: money(totalCredits),
    difference: money(difference),
    balanced,
  };
}

export function toTrialBalanceResponse(
  periodId: string,
  rows: AccountPeriodTotals[],
): TrialBalanceResponse {
  const trial = trialBalanceFromTotals(rows);
  return {
    periodId,
    source: 'POSTED_JOURNAL_ENTRY',
    accounts: rows.map((row) => ({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      class: row.class,
      debit: money(row.trialDebit),
      credit: money(row.trialCredit),
    })),
    totalDebits: money(trial.totalDebits),
    totalCredits: money(trial.totalCredits),
    difference: money(trial.difference),
    balanced: trial.balanced,
  };
}

export function toGeneralLedgerResponse(
  periodId: string,
  rows: AccountPeriodTotals[],
  movementsByAccount: Record<string, LedgerMovementRow[]>,
): GeneralLedgerResponse {
  return {
    periodId,
    source: 'POSTED_JOURNAL_ENTRY',
    accounts: rows.map((row) => ({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      class: row.class,
      openingDebits: money(row.openingDebits),
      openingCredits: money(row.openingCredits),
      periodDebits: money(row.periodDebits),
      periodCredits: money(row.periodCredits),
      closingDebits: money(row.closingDebits),
      closingCredits: money(row.closingCredits),
      closingBalanceDebit: money(row.trialDebit),
      closingBalanceCredit: money(row.trialCredit),
      movements: (movementsByAccount[row.accountId] ?? []).map((movement) => ({
        journalEntryId: movement.journal_entry_id,
        occurredOn: movement.occurred_on.slice(0, 10),
        description: movement.description,
        sourceReference: movement.source_reference,
        kind: movement.kind,
        direction: movement.direction,
        amount: formatMoneyAmountForApi(movement.amount) ?? movement.amount,
      })),
    })),
  };
}

export function toIncomeStatementResponse(
  periodId: string,
  accounts: AccountingAccountRow[],
  rows: AccountPeriodTotals[],
): IncomeStatementResponse {
  const statement = incomeStatementFromTotals(
    accounts.map((account) => ({ id: account.id, class: account.class })),
    rows,
  );
  return {
    periodId,
    source: 'POSTED_JOURNAL_ENTRY',
    available: statement.available,
    revenue: money(statement.revenue),
    expense: money(statement.expense),
    netIncome: money(statement.netIncome),
  };
}

export function toBalanceSheetResponse(
  periodId: string,
  accounts: AccountingAccountRow[],
  rows: AccountPeriodTotals[],
): BalanceSheetResponse {
  const mapped = accounts.map((account) => ({ id: account.id, class: account.class }));
  const sheet = balanceSheetFromTotals(mapped, rows);
  return {
    periodId,
    source: 'POSTED_JOURNAL_ENTRY',
    available: sheet.available,
    assets: money(sheet.assets),
    liabilities: money(sheet.liabilities),
    equity: money(sheet.equity),
    netIncome: money(sheet.netIncome),
    balanced: sheet.balanced,
  };
}

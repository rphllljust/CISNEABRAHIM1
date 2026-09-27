import { asBudgetIsoDate, type BudgetComparisonLine } from '../domain/budget';
import type {
  BudgetLineRow,
  BudgetPeriodRow,
  BudgetRow,
  BudgetVersionRow,
} from '../repositories/budget.repository.types';

export type BudgetSummaryResponse = {
  id: string;
  unitId: string;
  code: string;
  name: string;
  currencyCode: string;
  status: string;
  rowVersion: number;
  updatedAt: string;
};

export type BudgetListResponse = {
  items: BudgetSummaryResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

/** Linha de lista: o orçamento é identificado por código e nome. */
export function toBudgetSummaryResponse(row: BudgetRow): BudgetSummaryResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    code: row.code,
    name: row.name,
    currencyCode: row.currency_code,
    status: row.status,
    rowVersion: row.row_version,
    updatedAt: String(row.updated_at),
  };
}

export type BudgetLineResponse = {
  id: string;
  periodId: string;
  lineNumber: number;
  amount: string;
  costCenterCode: string | null;
  expenseCategoryId: string | null;
  accountId: string | null;
};

export type BudgetPeriodResponse = {
  id: string;
  periodKey: string;
  startsOn: string;
  endsOn: string;
  status: string;
  lines: BudgetLineResponse[];
};

export type BudgetVersionResponse = {
  id: string;
  versionNumber: number;
  status: string;
  approvedAt: string | null;
  periods: BudgetPeriodResponse[];
};

export type BudgetResponse = {
  id: string;
  unitId: string;
  code: string;
  name: string;
  currencyCode: string;
  status: string;
  rowVersion: number;
  versions: BudgetVersionResponse[];
};

export type BudgetComparisonResponse = {
  budgetId: string;
  versionId: string;
  versionNumber: number;
  currencyCode: string;
  budgeted: string;
  actual: string;
  variance: string;
  lines: BudgetComparisonLine[];
};

function asDay(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return asBudgetIsoDate(value);
}

export function toBudgetResponse(
  budget: BudgetRow,
  versions: Array<{ version: BudgetVersionRow; periods: Array<{ period: BudgetPeriodRow; lines: BudgetLineRow[] }> }>,
): BudgetResponse {
  return {
    id: budget.id,
    unitId: budget.unit_id,
    code: budget.code,
    name: budget.name,
    currencyCode: budget.currency_code,
    status: budget.status,
    rowVersion: budget.row_version,
    versions: versions.map((item) => ({
      id: item.version.id,
      versionNumber: item.version.version_number,
      status: item.version.status,
      approvedAt: item.version.approved_at ? item.version.approved_at.toISOString() : null,
      periods: item.periods.map((periodItem) => ({
        id: periodItem.period.id,
        periodKey: periodItem.period.period_key,
        startsOn: asDay(periodItem.period.starts_on) ?? '',
        endsOn: asDay(periodItem.period.ends_on) ?? '',
        status: periodItem.period.status,
        lines: periodItem.lines.map((line) => ({
          id: line.id,
          periodId: line.budget_period_id,
          lineNumber: line.line_number,
          amount: line.amount,
          costCenterCode: line.cost_center_code,
          expenseCategoryId: line.expense_category_id,
          accountId: line.account_id,
        })),
      })),
    })),
  };
}

import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import type { BankStatementListRow } from '../repositories/bank-reconciliation.repository.types';

/**
 * Resumo de extrato para descoberta. Contém apenas o que a lista precisa exibir e o que o
 * servidor realmente persistiu: identidade, referência humana da conta, período, status e os
 * totais agregados das linhas. Nada é calculado financeiramente no navegador.
 */
export type BankStatementSummaryResponse = {
  id: string;
  unitId: string;
  financialAccountId: string;
  financialAccount: {
    code: string;
    name: string;
    label: string;
  };
  sourceKind: string;
  sourceReference: string;
  periodStartsOn: string;
  periodEndsOn: string;
  currencyCode: string;
  status: string;
  lineCount: number;
  matchedLineCount: number;
  unreconciledLineCount: number;
  debitTotal: string;
  creditTotal: string;
};

export type BankStatementListResponse = {
  items: BankStatementSummaryResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

function money(value: string): string {
  return formatMoneyAmountForApi(value) ?? value;
}

export function toBankStatementSummaryResponse(
  row: BankStatementListRow,
): BankStatementSummaryResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    financialAccountId: row.financial_account_id,
    financialAccount: {
      code: row.account_code,
      name: row.account_name,
      label: `${row.account_code} — ${row.account_name}`,
    },
    sourceKind: row.source_kind,
    sourceReference: row.source_reference,
    periodStartsOn: row.period_starts_on,
    periodEndsOn: row.period_ends_on,
    currencyCode: row.currency_code,
    status: row.status,
    lineCount: Number(row.line_count),
    matchedLineCount: Number(row.matched_line_count),
    unreconciledLineCount: Number(row.unreconciled_line_count),
    debitTotal: money(row.debit_total),
    creditTotal: money(row.credit_total),
  };
}

import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import type {
  BankStatementLineRow,
  BankStatementRow,
  ReconciliationMatchRow,
  ReconciliationRow,
} from '../repositories/bank-reconciliation.repository.types';

export type BankStatementLineResponse = {
  id: string;
  lineNumber: number;
  occurredOn: string;
  direction: string;
  amount: string;
  description: string;
  sourceLineKey: string;
  matchStatus: string;
  duplicate: boolean;
};

export type BankStatementResponse = {
  id: string;
  unitId: string;
  financialAccountId: string;
  currencyCode: string;
  sourceKind: string;
  sourceReference: string;
  periodStartsOn: string;
  periodEndsOn: string;
  status: string;
  idempotent: boolean;
  lines: BankStatementLineResponse[];
};

export type ReconciliationResponse = {
  id: string;
  bankStatementId: string;
  bankStatementLineId: string;
  status: string;
  matchMethod: string;
  matchCriteria: string;
  match: {
    targetKind: string;
    targetId: string;
    financialTransactionId: string;
    amount: string;
  } | null;
};

function money(value: string): string {
  return formatMoneyAmountForApi(value) ?? value;
}

export function toStatementResponse(
  statement: BankStatementRow,
  lines: Array<BankStatementLineRow & { duplicate?: boolean }>,
  idempotent: boolean,
): BankStatementResponse {
  return {
    id: statement.id,
    unitId: statement.unit_id,
    financialAccountId: statement.financial_account_id,
    currencyCode: statement.currency_code,
    sourceKind: statement.source_kind,
    sourceReference: statement.source_reference,
    periodStartsOn: statement.period_starts_on,
    periodEndsOn: statement.period_ends_on,
    status: statement.status,
    idempotent,
    lines: lines.map((line) => ({
      id: line.id,
      lineNumber: Number(line.line_number),
      occurredOn: line.occurred_on,
      direction: line.direction,
      amount: money(line.amount),
      description: line.description,
      sourceLineKey: line.source_line_key,
      matchStatus: line.match_status,
      duplicate: line.duplicate === true,
    })),
  };
}

export function toReconciliationResponse(
  row: ReconciliationRow,
  match: ReconciliationMatchRow | null,
): ReconciliationResponse {
  return {
    id: row.id,
    bankStatementId: row.bank_statement_id,
    bankStatementLineId: row.bank_statement_line_id,
    status: row.status,
    matchMethod: row.match_method,
    matchCriteria: row.match_criteria,
    match: match
      ? {
          targetKind: match.target_kind,
          targetId: match.target_id,
          financialTransactionId: match.financial_transaction_id,
          amount: money(match.amount),
        }
      : null,
  };
}

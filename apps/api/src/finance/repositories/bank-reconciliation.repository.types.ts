export type BankStatementRow = {
  id: string;
  unit_id: string;
  financial_account_id: string;
  source_kind: string;
  source_reference: string;
  period_starts_on: string;
  period_ends_on: string;
  currency_code: string;
  status: string;
  idempotency_key: string;
  file_checksum: string | null;
};

export type BankStatementLineRow = {
  id: string;
  bank_statement_id: string;
  line_number: number;
  occurred_on: string;
  direction: string;
  amount: string;
  description: string;
  source_line_key: string;
  match_status: string;
  fingerprint: string | null;
  identity_kind: string;
};

export type BankStatementImportRow = {
  id: string;
  unit_id: string;
  financial_account_id: string;
  bank_statement_id: string | null;
  format: string;
  file_name: string;
  file_checksum: string;
  byte_size: number;
  status: string;
  rejection_code: string | null;
  line_count: number;
  imported_line_count: number;
  duplicate_line_count: number;
  idempotency_key: string;
};

export type ReconciliationRow = {
  id: string;
  unit_id: string;
  bank_statement_id: string;
  bank_statement_line_id: string;
  status: string;
  match_method: string;
  match_criteria: string;
  created_by_identity_id: string;
};

export type ReconciliationMatchRow = {
  id: string;
  reconciliation_id: string;
  bank_statement_line_id: string;
  target_kind: string;
  target_id: string;
  financial_transaction_id: string;
  amount: string;
  is_active: boolean;
};

/**
 * Linha de descoberta de extrato. Traz apenas o que a lista precisa: identidade do extrato,
 * referência humana da conta, período, status e os totais agregados das linhas persistidas.
 */
export type BankStatementListRow = {
  id: string;
  unit_id: string;
  financial_account_id: string;
  account_code: string;
  account_name: string;
  source_kind: string;
  source_reference: string;
  period_starts_on: string;
  period_ends_on: string;
  currency_code: string;
  status: string;
  line_count: number;
  matched_line_count: number;
  unreconciled_line_count: number;
  debit_total: string;
  credit_total: string;
};

export type EligibleMovementRow = {
  id: string;
  account_id: string;
  direction: string;
  amount: string;
  occurred_on: string;
  origin_kind: string;
  origin_id: string;
  transfer_id: string | null;
};

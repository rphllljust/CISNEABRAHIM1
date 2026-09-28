import {
  authHeaders,
  BACKOFFICE_PROBE_ID,
  BackofficeApiError,
  jsonHeaders,
  probeReadAccess,
  requestJson,
} from '../../financial-ui/enterprise-api';
import type {
  AutoMatchResult,
  BankStatement,
  BankStatementListResponse,
  FinancialAccount,
  PayableAgingResponse,
  PayableDetail,
  ReceivableDetail,
  ReconciliationMatch,
  TreasuryReconciliation,
  TreasuryTransfer,
  ExpenseDetail,
  BudgetDetail,
  BudgetComparison,
  CashForecast,
  CollectionCase,
} from '../types/finance.types';

export { BackofficeApiError };

/** Linha de lista de despesa: descrição, centro de custo, valor, vencimento e estado. */
export type ExpenseSummary = {
  id: string;
  unitId: string;
  description: string;
  costCenterCode: string;
  totalAmount: string;
  currencyCode: string;
  dueDate: string;
  status: string;
  version: number;
  createdAt: string;
};

export async function listExpenses(
  params: { limit: number; offset: number; status?: string; q?: string },
  signal?: AbortSignal,
): Promise<{ items: ExpenseSummary[]; limit: number; offset: number; total: number; totalPages: number }> {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.q && params.q.trim().length > 0) {
    search.set('q', params.q.trim());
  }
  return requestJson(`/api/v1/finance/expenses?${search.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listReceivables(signal?: AbortSignal): Promise<ReceivableDetail[]> {
  return requestJson<ReceivableDetail[]>('/api/v1/finance/receivables', {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getReceivable(receivableId: string, signal?: AbortSignal): Promise<ReceivableDetail> {
  return requestJson<ReceivableDetail>(`/api/v1/finance/receivables/${receivableId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function settleReceivable(
  receivableId: string,
  payload: { amount: string; rowVersion: number; idempotencyKey: string; installmentId?: string },
): Promise<ReceivableDetail> {
  return requestJson<ReceivableDetail>(`/api/v1/finance/receivables/${receivableId}/settlements`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function cancelReceivable(
  receivableId: string,
  payload: { rowVersion: number; cancelReason: string; idempotencyKey?: string },
): Promise<ReceivableDetail> {
  return requestJson<ReceivableDetail>(`/api/v1/finance/receivables/${receivableId}/cancel`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function listPayables(signal?: AbortSignal): Promise<PayableDetail[]> {
  return requestJson<PayableDetail[]>('/api/v1/finance/payables', {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getPayablesAging(signal?: AbortSignal): Promise<PayableAgingResponse> {
  return requestJson<PayableAgingResponse>('/api/v1/finance/payables/aging', {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getPayable(payableId: string, signal?: AbortSignal): Promise<PayableDetail> {
  return requestJson<PayableDetail>(`/api/v1/finance/payables/${payableId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function payPayable(
  payableId: string,
  payload: {
    amount: string;
    rowVersion: number;
    idempotencyKey: string;
    paymentReference: string;
    installmentId?: string;
  },
): Promise<PayableDetail> {
  return requestJson<PayableDetail>(`/api/v1/finance/payables/${payableId}/payments`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function cancelPayable(
  payableId: string,
  payload: { rowVersion: number; cancelReason: string; idempotencyKey?: string },
): Promise<PayableDetail> {
  return requestJson<PayableDetail>(`/api/v1/finance/payables/${payableId}/cancel`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

/**
 * Estorna um pagamento já lançado. Rota real do backend:
 * POST /finance/payables/:payableId/payments/:paymentId/reverse
 * (payables.controller.ts). O servidor valida rowVersion do título, motivo e a
 * idempotência; amount é opcional e assume o valor original do pagamento.
 */
export async function reversePayable(
  payableId: string,
  paymentId: string,
  payload: {
    rowVersion: number;
    idempotencyKey: string;
    paymentReference: string;
    amount?: string;
    reason: string;
  },
): Promise<PayableDetail> {
  return requestJson<PayableDetail>(
    `/api/v1/finance/payables/${payableId}/payments/${paymentId}/reverse`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    },
  );
}

export async function listTreasuryAccounts(signal?: AbortSignal): Promise<FinancialAccount[]> {
  return requestJson<FinancialAccount[]>('/api/v1/finance/treasury/accounts', {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function openTreasuryAccount(payload: {
  unitId: string;
  kind: string;
  code: string;
  name: string;
  currencyCode: string;
  overdraftAllowed?: boolean;
  openingAmount?: string;
  bank?: { bankCode: string; agency: string; accountNumber: string };
  cash?: { locationCode: string };
}): Promise<FinancialAccount> {
  return requestJson<FinancialAccount>('/api/v1/finance/treasury/accounts', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function postTreasuryMovement(
  accountId: string,
  payload: {
    direction: string;
    amount: string;
    rowVersion: number;
    idempotencyKey: string;
    reference: string;
    originKind: string;
    originId: string;
    originReference: string;
    occurredAt?: string;
  },
): Promise<FinancialAccount> {
  return requestJson<FinancialAccount>(
    `/api/v1/finance/treasury/accounts/${accountId}/movements`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    },
  );
}

export async function createTreasuryTransfer(payload: {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  rowVersionFrom: number;
  rowVersionTo: number;
  idempotencyKey: string;
  reference: string;
  originId: string;
  originReference: string;
  occurredAt?: string;
}): Promise<TreasuryTransfer> {
  return requestJson<TreasuryTransfer>('/api/v1/finance/treasury/transfers', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function reverseTreasuryMovement(
  transactionId: string,
  payload: {
    rowVersion: number;
    idempotencyKey: string;
    reference: string;
    reason: string;
    amount?: string;
  },
): Promise<FinancialAccount> {
  return requestJson<FinancialAccount>(
    `/api/v1/finance/treasury/movements/${transactionId}/reverse`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    },
  );
}

export async function reverseTreasuryTransfer(
  transferId: string,
  payload: {
    rowVersion: number;
    rowVersionTo: number;
    idempotencyKey: string;
    reference: string;
    reason: string;
  },
): Promise<TreasuryTransfer> {
  return requestJson<TreasuryTransfer>(
    `/api/v1/finance/treasury/transfers/${transferId}/reverse`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    },
  );
}

export async function getTreasuryAccount(accountId: string, signal?: AbortSignal): Promise<FinancialAccount> {
  return requestJson<FinancialAccount>(`/api/v1/finance/treasury/accounts/${accountId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getTreasuryReconciliation(
  accountId: string,
  signal?: AbortSignal,
): Promise<TreasuryReconciliation> {
  return requestJson<TreasuryReconciliation>(
    `/api/v1/finance/treasury/accounts/${accountId}/reconciliation`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

export async function getBankStatement(statementId: string, signal?: AbortSignal): Promise<BankStatement> {
  return requestJson<BankStatement>(`/api/v1/finance/bank-reconciliation/statements/${statementId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function importBankFile(payload: {
  unitId: string;
  financialAccountId: string;
  fileName: string;
  content: string;
  declaredFormat?: string | null;
  idempotencyKey?: string | null;
}): Promise<BankStatement> {
  return requestJson<BankStatement>('/api/v1/finance/bank-reconciliation/statements/import', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function autoMatchStatement(statementId: string): Promise<AutoMatchResult> {
  return requestJson<AutoMatchResult>(
    `/api/v1/finance/bank-reconciliation/statements/${statementId}/auto-match`,
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({}) },
  );
}

export async function confirmReconciliation(reconciliationId: string): Promise<ReconciliationMatch> {
  return requestJson<ReconciliationMatch>(
    `/api/v1/finance/bank-reconciliation/reconciliations/${reconciliationId}/confirm`,
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({}) },
  );
}

export async function unreconcileReconciliation(reconciliationId: string): Promise<ReconciliationMatch> {
  return requestJson<ReconciliationMatch>(
    `/api/v1/finance/bank-reconciliation/reconciliations/${reconciliationId}/unreconcile`,
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({}) },
  );
}

/** Vincula manualmente uma linha do extrato a um movimento financeiro (POST /finance/bank-reconciliation/matches). */
export async function matchBankStatementLine(payload: {
  bankStatementLineId: string;
  financialTransactionId: string;
}): Promise<ReconciliationMatch> {
  return requestJson<ReconciliationMatch>('/api/v1/finance/bank-reconciliation/matches', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

/**
 * Descoberta de extratos bancários (GET /finance/bank-statements).
 *
 * Filtros e paginação são resolvidos pelo servidor; a tela nunca pede a lista inteira para
 * filtrar no navegador.
 */
export async function listBankStatements(
  params: {
    limit: number;
    offset: number;
    status?: string;
    financialAccountId?: string;
    dateFrom?: string;
    dateTo?: string;
  },
  signal?: AbortSignal,
): Promise<BankStatementListResponse> {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.financialAccountId) {
    search.set('financialAccountId', params.financialAccountId);
  }
  if (params.dateFrom) {
    search.set('dateFrom', params.dateFrom);
  }
  if (params.dateTo) {
    search.set('dateTo', params.dateTo);
  }
  return requestJson(`/api/v1/finance/bank-statements?${search.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function probeReceivableListAccess(signal?: AbortSignal): Promise<boolean> {
  return probeList('/api/v1/finance/receivables', signal);
}

export async function probePayableListAccess(signal?: AbortSignal): Promise<boolean> {
  return probeList('/api/v1/finance/payables', signal);
}

export async function probeTreasuryListAccess(signal?: AbortSignal): Promise<boolean> {
  return probeList('/api/v1/finance/treasury/accounts', signal);
}

/**
 * Sonda a capacidade de leitura de conciliação pela DESCOBERTA de extratos — a mesma autoridade
 * que a mesa de trabalho usa. Antes sondava um extrato inexistente por identificador; a listagem é
 * a porta de entrada real da tela e responde à mesma concessão.
 */
export async function probeReconciliationReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeList('/api/v1/finance/bank-statements?limit=1&offset=0', signal);
}

export async function getExpense(expenseId: string, signal?: AbortSignal): Promise<ExpenseDetail> {
  return requestJson<ExpenseDetail>(`/api/v1/finance/expenses/${expenseId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createExpense(payload: Record<string, unknown>): Promise<ExpenseDetail> {
  return requestJson<ExpenseDetail>('/api/v1/finance/expenses', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function submitExpense(expenseId: string, payload: { version: number }): Promise<ExpenseDetail> {
  return requestJson<ExpenseDetail>(`/api/v1/finance/expenses/${expenseId}/submit`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function approveExpense(expenseId: string, payload: { version: number }): Promise<ExpenseDetail> {
  return requestJson<ExpenseDetail>(`/api/v1/finance/expenses/${expenseId}/approve`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function rejectExpense(
  expenseId: string,
  payload: { version: number; reason: string },
): Promise<ExpenseDetail> {
  return requestJson<ExpenseDetail>(`/api/v1/finance/expenses/${expenseId}/reject`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

/** Linha de lista de orçamento: código, nome, moeda e estado. */
export type BudgetSummary = {
  id: string;
  unitId: string;
  code: string;
  name: string;
  currencyCode: string;
  status: string;
  rowVersion: number;
  updatedAt: string;
};

export async function listBudgets(
  params: { limit: number; offset: number; status?: string; q?: string },
  signal?: AbortSignal,
): Promise<{ items: BudgetSummary[]; limit: number; offset: number; total: number; totalPages: number }> {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.q && params.q.trim().length > 0) {
    search.set('q', params.q.trim());
  }
  return requestJson(`/api/v1/finance/budgets?${search.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getBudget(budgetId: string, signal?: AbortSignal): Promise<BudgetDetail> {
  return requestJson<BudgetDetail>(`/api/v1/finance/budgets/${budgetId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function compareBudget(budgetId: string, signal?: AbortSignal): Promise<BudgetComparison> {
  return requestJson<BudgetComparison>(`/api/v1/finance/budgets/${budgetId}/comparison`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createBudget(payload: Record<string, unknown>): Promise<BudgetDetail> {
  return requestJson<BudgetDetail>('/api/v1/finance/budgets', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function addBudgetPeriod(budgetId: string, payload: Record<string, unknown>): Promise<BudgetDetail> {
  return requestJson<BudgetDetail>(`/api/v1/finance/budgets/${budgetId}/periods`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function addBudgetLine(budgetId: string, payload: Record<string, unknown>): Promise<BudgetDetail> {
  return requestJson<BudgetDetail>(`/api/v1/finance/budgets/${budgetId}/lines`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function approveBudget(budgetId: string): Promise<BudgetDetail> {
  return requestJson<BudgetDetail>(`/api/v1/finance/budgets/${budgetId}/approve`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({}),
  });
}

export async function createBudgetVersion(budgetId: string): Promise<BudgetDetail> {
  return requestJson<BudgetDetail>(`/api/v1/finance/budgets/${budgetId}/versions`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({}),
  });
}

export async function getCashForecast(
  query: { unitId: string; currencyCode: string; asOf?: string; horizonEndsOn?: string },
  signal?: AbortSignal,
): Promise<CashForecast> {
  const params = new URLSearchParams({ unitId: query.unitId, currencyCode: query.currencyCode });
  if (query.asOf) {
    params.set('asOf', query.asOf);
  }
  if (query.horizonEndsOn) {
    params.set('horizonEndsOn', query.horizonEndsOn);
  }
  return requestJson<CashForecast>(`/api/v1/finance/cash-forecast?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getCurrentCollection(
  receivableId: string,
  signal?: AbortSignal,
): Promise<CollectionCase> {
  return requestJson<CollectionCase>(`/api/v1/finance/receivables/${receivableId}/collections/current`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function openCollection(receivableId: string): Promise<CollectionCase> {
  return requestJson<CollectionCase>(`/api/v1/finance/receivables/${receivableId}/collections`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({}),
  });
}

export async function recordCollectionAction(
  collectionId: string,
  payload: { kind: string; notes?: string; idempotencyKey: string },
): Promise<CollectionCase> {
  return requestJson<CollectionCase>(`/api/v1/finance/collections/${collectionId}/actions`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function recordCollectionPromise(
  collectionId: string,
  payload: { promisedAmount: string; promisedOn: string; notes?: string; idempotencyKey: string },
): Promise<CollectionCase> {
  return requestJson<CollectionCase>(`/api/v1/finance/collections/${collectionId}/promises`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function probeExpenseReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(`/api/v1/finance/expenses/${BACKOFFICE_PROBE_ID}`, signal);
}

export async function probeBudgetReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(`/api/v1/finance/budgets/${BACKOFFICE_PROBE_ID}`, signal);
}

export async function probeForecastReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(
    `/api/v1/finance/cash-forecast?unitId=${BACKOFFICE_PROBE_ID}&currencyCode=BRL`,
    signal,
  );
}

async function probeList(path: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await requestJson<unknown>(path, { method: 'GET', headers: authHeaders(), signal });
    return true;
  } catch (error) {
    if (error instanceof BackofficeApiError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.kind === 'denied') {
        return false;
      }
    }
    return false;
  }
}

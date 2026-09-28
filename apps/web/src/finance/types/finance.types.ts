export type ReceivableInstallment = {
  id: string;
  installmentNumber: number;
  principal: string;
  dueDate: string;
};

export type Settlement = {
  id: string;
  installmentId: string | null;
  amount: string;
  currencyCode: string;
  status: string;
  settledAt: string;
  idempotencyKey: string;
  externalReference: string | null;
};

export type ReceivableDetail = {
  id: string;
  unitId: string;
  clientId: string;
  origin: {
    kind: string;
    billingDocumentId: string;
    billingRecordId: string;
    serviceOrderId: string;
    measurementId: string;
  };
  principal: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  externalReference: string | null;
  status: string;
  remainingBalance: string;
  settledAmount: string;
  lifecycle: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  installments: ReceivableInstallment[];
  settlements: Settlement[];
};

export type PayableInstallment = {
  id: string;
  installmentNumber: number;
  principal: string;
  dueDate: string;
};

export type Payment = {
  id: string;
  installmentId: string;
  kind: string;
  amount: string;
  currencyCode: string;
  paidAt: string;
  idempotencyKey: string;
  paymentReference: string;
  originKind: string;
  originId: string;
  originReference: string;
  reversesPaymentId: string | null;
  actorIdentityId: string;
  createdAt: string;
};

export type PayableDetail = {
  id: string;
  unitId: string;
  counterpartyId: string;
  origin: { kind: string; id: string; reference: string };
  expenseCategoryId: string;
  costCenter: { id: string; code: string };
  principal: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  externalReference: string | null;
  status: string;
  agingBucket: string;
  remainingBalance: string;
  paidAmount: string;
  lifecycle: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  installments: PayableInstallment[];
  payments: Payment[];
};

export type PayableAgingSummary = Record<string, { count: number; remaining: string }>;

export type PayableAgingResponse = {
  asOf: string;
  buckets: PayableAgingSummary;
};

export type FinancialAccountMovement = {
  id: string;
  accountId: string;
  direction: string;
  amount: string;
  currencyCode: string;
  occurredAt: string;
  status: string;
  idempotencyKey: string;
  reference: string;
  originKind: string;
  originId: string;
  originReference: string;
  transferId: string | null;
  reversesTransactionId: string | null;
  actorIdentityId: string;
  createdAt: string;
};

export type TreasuryTransfer = {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  kind: string;
  amount: string;
  currencyCode: string;
  occurredAt: string;
  idempotencyKey: string;
  reference: string;
  originKind: string;
  originId: string;
  originReference: string;
  reversesTransferId: string | null;
  actorIdentityId: string;
  createdAt: string;
  legs: FinancialAccountMovement[];
};

export type FinancialAccount = {
  id: string;
  unitId: string;
  kind: string;
  code: string;
  name: string;
  currencyCode: string;
  overdraftAllowed: boolean;
  lifecycle: string;
  rowVersion: number;
  balance: string;
  bank: { bankCode: string; agency: string; accountNumber: string } | null;
  cash: { locationCode: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type TreasuryReconciliation = {
  accountId: string;
  balance: string;
  credits: string;
  debits: string;
  movementCount: number;
};

export type BankStatementLine = {
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

export type BankStatement = {
  id: string;
  unitId: string;
  financialAccountId: string;
  sourceKind: string;
  sourceReference: string;
  periodStartsOn: string;
  periodEndsOn: string;
  status: string;
  idempotent: boolean;
  lines: BankStatementLine[];
};

/**
 * Resumo de extrato para a mesa de conciliação.
 *
 * Tudo aqui vem persistido pelo servidor: identidade, referência humana da conta, período, status
 * e os totais agregados das linhas. O navegador não soma nem infere situação de conciliação.
 */
export type BankStatementSummary = {
  id: string;
  unitId: string;
  financialAccountId: string;
  financialAccount: { code: string; name: string; label: string };
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
  items: BankStatementSummary[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type ReconciliationMatch = {
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

export type AutoMatchResult = {
  statementId: string;
  suggested: ReconciliationMatch[];
  reviewRequired: string[];
  unmatched: string[];
  autoMatchedConfirmed: number;
};

export type FinanceCapabilities = {
  canListReceivables: boolean;
  canListPayables: boolean;
  canListTreasury: boolean;
  canReadReconciliation: boolean;
};

export type ExpenseItem = {
  id: string;
  lineNumber: number;
  description: string;
  amount: string;
};

export type ExpenseDetail = {
  id: string;
  unitId: string;
  requesterIdentityId: string;
  expenseCategoryId: string;
  costCenterId: string;
  costCenterCode: string;
  totalAmount: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  description: string;
  receiptDocumentId: string | null;
  reimbursable: boolean;
  status: string;
  version: number;
  items: ExpenseItem[];
  approval: {
    id: string;
    decision: string;
    actorIdentityId: string;
    approvalRuleId: string | null;
    reason: string | null;
  } | null;
  reimbursement: {
    id: string;
    payableId: string;
    amount: string;
    currencyCode: string;
  } | null;
};

export type BudgetLine = {
  id: string;
  periodId: string;
  lineNumber: number;
  amount: string;
  costCenterCode: string | null;
  expenseCategoryId: string | null;
  accountId: string | null;
};

export type BudgetPeriod = {
  id: string;
  periodKey: string;
  startsOn: string;
  endsOn: string;
  status: string;
  lines: BudgetLine[];
};

export type BudgetVersion = {
  id: string;
  versionNumber: number;
  status: string;
  approvedAt: string | null;
  periods: BudgetPeriod[];
};

export type BudgetDetail = {
  id: string;
  unitId: string;
  code: string;
  name: string;
  currencyCode: string;
  status: string;
  rowVersion: number;
  versions: BudgetVersion[];
};

export type BudgetComparison = {
  budgetId: string;
  versionId: string;
  versionNumber: number;
  currencyCode: string;
  budgeted: string;
  actual: string;
  variance: string;
};

export type CashForecast = {
  status: 'PROJECTED' | 'NO_DATA';
  unitId: string;
  currencyCode: string;
  asOf: string;
  horizonEndsOn: string;
  realized: { cashBalance: string; inflows: string; outflows: string };
  forecast: { inflows: string; outflows: string; overdueInflows: string; overdueOutflows: string; net: string };
  projectedCash: { amount: string };
  lines: Array<{ kind: string; amount: string; sourceKind?: string }>;
};

export type CollectionCase = {
  id: string;
  receivableId: string;
  unitId: string;
  clientId: string;
  status: string;
  openedBecauseOverdue: boolean;
  promisedDueDate: string | null;
  version: number;
  openedAt: string;
  closedAt: string | null;
  actions: Array<{ id: string; kind: string; notes: string | null; actorIdentityId: string; occurredAt: string }>;
  promises: Array<{ id: string; promisedAmount: string; promisedOn: string; status: string }>;
};

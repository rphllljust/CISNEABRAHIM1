export type ChartStatus = 'ACTIVE' | 'INACTIVE';
export type AccountClass = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type AccountStatus = 'ACTIVE' | 'INACTIVE';
export type PeriodStatus = 'OPEN' | 'CLOSED';
export type JournalStatus = 'DRAFT' | 'POSTED';
export type JournalKind = 'ENTRY' | 'REVERSAL';
export type JournalDirection = 'DEBIT' | 'CREDIT';
export type NormalBalance = 'DEBIT' | 'CREDIT';
export type PeriodCloseRunStatus = 'SUCCEEDED' | 'BLOCKED';
export type PeriodCloseCheckResult = 'PASS' | 'FAIL' | 'INFORMATIONAL';

export type ChartOfAccounts = {
  id: string;
  unitId: string;
  code: string;
  name: string;
  status: ChartStatus;
  createdAt: string;
  updatedAt: string;
};

export type Account = {
  id: string;
  chartId: string;
  parentId: string | null;
  code: string;
  name: string;
  class: AccountClass;
  status: AccountStatus;
};

export type PeriodCloseCheck = {
  kind: string;
  result: PeriodCloseCheckResult;
  blocking: boolean;
  observedCount: number;
  detail: string;
};

export type AccountingPeriod = {
  id: string;
  chartId: string;
  unitId: string;
  code: string;
  startsOn: string;
  endsOn: string;
  status: PeriodStatus;
  reopenCount: number;
  rowVersion: number;
  closedAt: string | null;
  reopenedAt: string | null;
  closeChecks: PeriodCloseCheck[];
};

export type JournalLine = {
  id: string;
  lineNumber: number;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  accountClass?: AccountClass;
  accountStatus?: AccountStatus;
  direction: JournalDirection;
  amount: string;
  description: string | null;
};

export type JournalEntry = {
  id: string;
  chartId: string;
  periodId: string;
  unitId: string;
  status: JournalStatus;
  kind: JournalKind;
  description: string;
  occurredOn: string;
  currencyCode: string;
  sourceKind: string;
  sourceId: string;
  sourceReference: string;
  idempotencyKey: string;
  reversesEntryId: string | null;
  /** Lancamento de estorno que anulou este. Presente no detalhe; nulo na lista. */
  reversedByEntryId: string | null;
  reversedByEntryNumber: number | null;
  entryNumber: number | null;
  postedAt: string | null;
  postedBy: string | null;
  rowVersion: number;
  debitTotal: string;
  creditTotal: string;
  balanced: boolean;
  lines: JournalLine[];
};

/** Rastreabilidade evento de negocio -> lancamento contabil (acc.accounting_posting_requests). */
export type PostingRequestListItem = {
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

export type PostingRequestPage = {
  unitId: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  statusCounts: Record<string, number>;
  items: PostingRequestListItem[];
};

export type LedgerReconstruction = {
  chartId: string;
  totalDebits: string;
  totalCredits: string;
  balanced: boolean;
  accounts: Array<{ accountId: string; debits: string; credits: string }>;
};

export type JournalBook = {
  periodId: string;
  source: string;
  entries: JournalEntry[];
  totalDebits: string;
  totalCredits: string;
  difference: string;
  balanced: boolean;
};

export type GeneralLedgerAccount = {
  accountId: string;
  code: string;
  name: string;
  class: AccountClass;
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
    direction: JournalDirection;
    amount: string;
  }>;
};

export type GeneralLedger = {
  periodId: string;
  source: string;
  accounts: GeneralLedgerAccount[];
};

export type TrialBalance = {
  periodId: string;
  source: string;
  accounts: Array<{
    accountId: string;
    code: string;
    name: string;
    class: AccountClass;
    debit: string;
    credit: string;
  }>;
  totalDebits: string;
  totalCredits: string;
  difference: string;
  balanced: boolean;
};

export type IncomeStatement = {
  periodId: string;
  source: string;
  available: boolean;
  revenue: string;
  expense: string;
  netIncome: string;
};

export type BalanceSheet = {
  periodId: string;
  source: string;
  available: boolean;
  assets: string;
  liabilities: string;
  equity: string;
  netIncome: string;
  balanced: boolean;
};

// Contratos das consultas criadas para a UI (listagens server-side)
export type ChartsList = { unitId: string; items: ChartOfAccounts[] };
export type AccountsList = { chartId: string; items: Account[] };
export type PeriodsList = { chartId: string; items: AccountingPeriod[] };

export type JournalListPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: JournalEntry[];
};

export type SideBalance = { side: NormalBalance; amount: string };

export type AccountLedgerMovement = {
  journalEntryId: string;
  occurredOn: string;
  description: string;
  sourceReference: string;
  kind: JournalKind;
  direction: JournalDirection;
  amount: string;
  runningBalance: SideBalance;
};

export type AccountLedger = {
  periodId: string;
  account: {
    id: string;
    code: string;
    name: string;
    class: AccountClass;
    status: AccountStatus;
    normalBalance: NormalBalance;
  } | null;
  source: string;
  openingBalance: SideBalance;
  periodDebits: string;
  periodCredits: string;
  closingBalance: SideBalance;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  movements: AccountLedgerMovement[];
};

export type PeriodCloseRun = {
  id: string;
  status: PeriodCloseRunStatus;
  createdAt: string;
  checks: PeriodCloseCheck[];
};

export type CloseRuns = {
  periodId: string;
  runs: PeriodCloseRun[];
};

export type FixedAssetRegister = {
  id: string;
  unitId: string;
  operationalAssetId: string;
  currencyCode: string;
  usefulLifeMonths: number;
  costCenterCode: string | null;
  status: string;
  rowVersion: number;
  bookValue: string;
  acquiredOn: string | null;
  disposedOn: string | null;
  movements: Array<{
    id: string;
    kind: string;
    status: string;
    amount: string;
    occurredOn: string;
    journalEntryId: string | null;
  }>;
};

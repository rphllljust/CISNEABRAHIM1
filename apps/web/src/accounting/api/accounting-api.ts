import {
  authHeaders,
  BACKOFFICE_PROBE_ID,
  BackofficeApiError,
  jsonHeaders,
  probeReadAccess,
  requestJson,
} from '../../financial-ui/enterprise-api';
import type {
  Account,
  AccountLedger,
  AccountsList,
  AccountingPeriod,
  BalanceSheet,
  ChartOfAccounts,
  ChartsList,
  CloseRuns,
  FixedAssetRegister,
  GeneralLedger,
  IncomeStatement,
  JournalBook,
  JournalEntry,
  JournalListPage,
  LedgerReconstruction,
  PeriodsList,
  TrialBalance,
} from '../types/accounting.types';

export { BackofficeApiError };

export async function getChart(chartId: string, signal?: AbortSignal): Promise<ChartOfAccounts> {
  return requestJson<ChartOfAccounts>(`/api/v1/accounting/charts/${chartId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function reconstructLedger(chartId: string, signal?: AbortSignal): Promise<LedgerReconstruction> {
  return requestJson<LedgerReconstruction>(
    `/api/v1/accounting/ledger?chartId=${encodeURIComponent(chartId)}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

export async function getJournal(journalId: string, signal?: AbortSignal): Promise<JournalEntry> {
  return requestJson<JournalEntry>(`/api/v1/accounting/journals/${journalId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function postJournal(
  journalId: string,
  payload: { rowVersion: number },
): Promise<JournalEntry> {
  return requestJson<JournalEntry>(`/api/v1/accounting/journals/${journalId}/post`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function reverseJournal(
  journalId: string,
  payload: { rowVersion: number; reason: string },
): Promise<JournalEntry> {
  return requestJson<JournalEntry>(`/api/v1/accounting/journals/${journalId}/reverse`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function getJournalBook(periodId: string, signal?: AbortSignal): Promise<JournalBook> {
  return requestJson<JournalBook>(`/api/v1/accounting/periods/${periodId}/journal`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getGeneralLedger(periodId: string, signal?: AbortSignal): Promise<GeneralLedger> {
  return requestJson<GeneralLedger>(`/api/v1/accounting/periods/${periodId}/general-ledger`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getTrialBalance(periodId: string, signal?: AbortSignal): Promise<TrialBalance> {
  return requestJson<TrialBalance>(`/api/v1/accounting/periods/${periodId}/trial-balance`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getIncomeStatement(
  periodId: string,
  signal?: AbortSignal,
): Promise<IncomeStatement> {
  return requestJson<IncomeStatement>(`/api/v1/accounting/periods/${periodId}/income-statement`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getBalanceSheet(periodId: string, signal?: AbortSignal): Promise<BalanceSheet> {
  return requestJson<BalanceSheet>(`/api/v1/accounting/periods/${periodId}/balance-sheet`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function closePeriod(
  periodId: string,
  payload: { rowVersion: number; reason: string },
): Promise<AccountingPeriod> {
  return requestJson<AccountingPeriod>(`/api/v1/accounting/periods/${periodId}/close`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function reopenPeriod(
  periodId: string,
  payload: { rowVersion: number; reason: string },
): Promise<AccountingPeriod> {
  return requestJson<AccountingPeriod>(`/api/v1/accounting/periods/${periodId}/reopen`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function probeAccountingReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(`/api/v1/accounting/charts/${BACKOFFICE_PROBE_ID}`, signal);
}

export async function getFixedAsset(registerId: string, signal?: AbortSignal): Promise<FixedAssetRegister> {
  return requestJson<FixedAssetRegister>(`/api/v1/accounting/fixed-assets/${registerId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function lookupFixedAsset(
  query: { unitId: string; operationalAssetId: string },
  signal?: AbortSignal,
): Promise<FixedAssetRegister> {
  const params = new URLSearchParams(query);
  return requestJson<FixedAssetRegister>(`/api/v1/accounting/fixed-assets?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function registerFixedAsset(payload: Record<string, unknown>): Promise<FixedAssetRegister> {
  return requestJson<FixedAssetRegister>('/api/v1/accounting/fixed-assets', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function acquireFixedAsset(
  registerId: string,
  payload: Record<string, unknown>,
): Promise<FixedAssetRegister> {
  return requestJson<FixedAssetRegister>(`/api/v1/accounting/fixed-assets/${registerId}/acquire`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function disposeFixedAsset(
  registerId: string,
  payload: Record<string, unknown>,
): Promise<FixedAssetRegister> {
  return requestJson<FixedAssetRegister>(`/api/v1/accounting/fixed-assets/${registerId}/dispose`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function depreciateFixedAsset(registerId: string): Promise<FixedAssetRegister> {
  return requestJson<FixedAssetRegister>(`/api/v1/accounting/fixed-assets/${registerId}/depreciate`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({}),
  });
}

export async function transferFixedAsset(
  registerId: string,
  payload: Record<string, unknown>,
): Promise<FixedAssetRegister> {
  return requestJson<FixedAssetRegister>(`/api/v1/accounting/fixed-assets/${registerId}/transfer`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function reverseFixedAssetAcquisition(
  registerId: string,
  payload: { reason: string },
): Promise<FixedAssetRegister> {
  return requestJson<FixedAssetRegister>(`/api/v1/accounting/fixed-assets/${registerId}/reverse`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function probeFixedAssetReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(`/api/v1/accounting/fixed-assets/${BACKOFFICE_PROBE_ID}`, signal);
}

export async function listCharts(unitId: string, signal?: AbortSignal): Promise<ChartsList> {
  const params = new URLSearchParams({ unitId });
  return requestJson<ChartsList>(`/api/v1/accounting/charts?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listAccounts(chartId: string, signal?: AbortSignal): Promise<AccountsList> {
  return requestJson<AccountsList>(`/api/v1/accounting/charts/${chartId}/accounts`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listPeriods(
  chartId: string,
  status?: 'OPEN' | 'CLOSED',
  signal?: AbortSignal,
): Promise<PeriodsList> {
  const params = status ? new URLSearchParams({ status }) : '';
  return requestJson<PeriodsList>(
    `/api/v1/accounting/charts/${chartId}/periods${params ? `?${params.toString()}` : ''}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

export type JournalListQuery = {
  periodId?: string;
  status?: 'DRAFT' | 'POSTED';
  kind?: 'ENTRY' | 'REVERSAL';
  occurredFrom?: string;
  occurredTo?: string;
  sourceKind?: string;
  accountId?: string;
  page: number;
  pageSize: number;
};

export async function listJournals(
  chartId: string,
  query: JournalListQuery,
  signal?: AbortSignal,
): Promise<JournalListPage> {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));
  if (query.periodId) params.set('periodId', query.periodId);
  if (query.status) params.set('status', query.status);
  if (query.kind) params.set('kind', query.kind);
  if (query.occurredFrom) params.set('occurredFrom', query.occurredFrom);
  if (query.occurredTo) params.set('occurredTo', query.occurredTo);
  if (query.sourceKind) params.set('sourceKind', query.sourceKind);
  if (query.accountId) params.set('accountId', query.accountId);
  return requestJson<JournalListPage>(`/api/v1/accounting/charts/${chartId}/journals?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getAccountLedger(
  periodId: string,
  accountId: string,
  page: number,
  pageSize = 30,
  signal?: AbortSignal,
): Promise<AccountLedger> {
  const params = new URLSearchParams({
    accountId,
    page: String(page),
    pageSize: String(pageSize),
  });
  return requestJson<AccountLedger>(`/api/v1/accounting/periods/${periodId}/ledger?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getPeriodCloseRuns(periodId: string, signal?: AbortSignal): Promise<CloseRuns> {
  return requestJson<CloseRuns>(`/api/v1/accounting/periods/${periodId}/close-runs`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function updateAccount(
  chartId: string,
  accountId: string,
  payload: { name?: string; status?: 'ACTIVE' | 'INACTIVE' },
): Promise<Account> {
  return requestJson<Account>(`/api/v1/accounting/charts/${chartId}/accounts/${accountId}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function createAccount(
  chartId: string,
  payload: { code: string; name: string; class: string; parentId?: string },
): Promise<Account> {
  return requestJson<Account>(`/api/v1/accounting/charts/${chartId}/accounts`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

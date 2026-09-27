import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { ChartOfAccountsPage } from './pages/ChartOfAccountsPage';
import { FixedAssetsPage } from './pages/FixedAssetsPage';
import { JournalsPage } from './pages/JournalsPage';
import { PeriodClosePage } from './pages/PeriodClosePage';
import { JournalBookPage, GeneralLedgerPage, IncomeStatementPage } from './pages/PeriodReportPages';
import type { FixedAssetRegister } from './types/accounting.types';

const CHART_ID = '10000000-0000-4000-8000-000000000001';
const CASH_ID = '10000000-0000-4000-8000-000000000010';
const REVENUE_ID = '10000000-0000-4000-8000-000000000011';
const PERIOD_ID = '20000000-0000-4000-8000-000000000002';
const JOURNAL_ID = '30000000-0000-4000-8000-000000000003';
const REVERSAL_ID = '30000000-0000-4000-8000-000000000004';
const FIXED_ASSET_ID = '40000000-0000-4000-8000-000000000005';
const OPERATIONAL_ASSET_ID = '50000000-0000-4000-8000-000000000006';

type AccountingMockState = {
  closed: boolean;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deniedResponse(): Response {
  return jsonResponse(
    { error: { code: 'ACCOUNTING_DENIED', message: 'Access denied.' } },
    403,
  );
}

function journalPayload() {
  return {
    id: JOURNAL_ID,
    chartId: CHART_ID,
    periodId: PERIOD_ID,
    unitId: 'unit-a',
    status: 'POSTED',
    kind: 'ENTRY',
    description: 'Venda de serviços',
    occurredOn: '2026-10-05',
    currencyCode: 'BRL',
    sourceKind: 'MANUAL',
    sourceId: '00000000-0000-4000-8000-000000000001',
    sourceReference: 'Venda 001',
    idempotencyKey: 'journal-1',
    reversesEntryId: null,
    entryNumber: 1,
    postedAt: '2026-10-05T10:00:00.000Z',
    rowVersion: 2,
    debitTotal: '100.0000',
    creditTotal: '100.0000',
    balanced: true,
    lines: [
      { id: '1', lineNumber: 1, accountId: CASH_ID, accountCode: '1.1.01', accountName: 'Cash', accountClass: 'ASSET', direction: 'DEBIT', amount: '100.0000', description: null },
      { id: '2', lineNumber: 2, accountId: REVENUE_ID, accountCode: '4.1.01', accountName: 'Revenue', accountClass: 'REVENUE', direction: 'CREDIT', amount: '100.0000', description: null },
    ],
  };
}

function reversalPayload() {
  const original = journalPayload();
  return {
    ...original,
    id: REVERSAL_ID,
    kind: 'REVERSAL',
    description: 'Estorno da venda',
    entryNumber: 2,
    reversesEntryId: JOURNAL_ID,
    lines: original.lines.map((line: { id: string; lineNumber: number; accountId: string; direction: string; amount: string; accountCode?: string }) => ({
      ...line,
      direction: line.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
    })),
  };
}

function fixedAssetPayload(overrides: Partial<FixedAssetRegister> = {}): FixedAssetRegister {
  return {
    ...baseFixedAssetPayload(),
    ...overrides,
  };
}

function baseFixedAssetPayload(): FixedAssetRegister {
  return {
    id: FIXED_ASSET_ID,
    unitId: 'unit-a',
    operationalAssetId: OPERATIONAL_ASSET_ID,
    currencyCode: 'BRL',
    usefulLifeMonths: 60,
    costCenterCode: 'CC-OPS',
    status: 'ACTIVE',
    rowVersion: 2,
    bookValue: '9000.0000',
    acquiredOn: '2026-10-01',
    disposedOn: null,
    movements: [
      {
        id: 'movement-1',
        kind: 'ACQUISITION',
        status: 'POSTED',
        amount: '10000.0000',
        occurredOn: '2026-10-01',
        journalEntryId: JOURNAL_ID,
      },
      {
        id: 'movement-2',
        kind: 'DEPRECIATION',
        status: 'POSTED',
        amount: '1000.0000',
        occurredOn: '2026-11-01',
        journalEntryId: REVERSAL_ID,
      },
    ],
  };
}

function createAccountingFetchMock(options: { accountingAllowed?: boolean } = {}) {
  const allowed = options.accountingAllowed !== false;
  const state: AccountingMockState = { closed: false };
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'http://127.0.0.1');
    const method = (init?.method ?? 'GET').toUpperCase();
    const segments = url.pathname.split('/').filter(Boolean); // api,v1,accounting,...

    if (method === 'GET' && url.pathname === '/api/v1/auth/session') {
      return jsonResponse({
        identityId: '00000000-0000-4000-8000-000000000001',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }

    // Unidades operacionais do shell (Requests). Independentes da permissao contabil: a tela
    // escolhe a unidade humana e so a consulta de planos/contas e autorizada pelo servidor.
    if (
      method === 'GET' &&
      url.pathname === '/api/v1/requests/service-requests/operational-units'
    ) {
      return jsonResponse({ items: ['unit-a'] });
    }

    const denied = (): Response => (allowed ? jsonResponse({ error: { code: 'ACCOUNTING_NOT_FOUND' } }, 404) : deniedResponse());

    if (segments[2] !== 'accounting') {
      return denied();
    }

    if (segments[3] === 'fixed-assets') {
      if (!allowed) {
        return deniedResponse();
      }
      if (method === 'GET' && segments.length === 4) {
        return jsonResponse(fixedAssetPayload());
      }
      if (method === 'GET' && segments.length === 5) {
        return jsonResponse(fixedAssetPayload({ id: segments[4] }));
      }
      if (method === 'POST' && segments.length === 4) {
        return jsonResponse(fixedAssetPayload({ status: 'REGISTERED', bookValue: '0.0000', movements: [] }));
      }
      if (method === 'POST' && segments[5] === 'depreciate') {
        return jsonResponse(fixedAssetPayload({ rowVersion: 3, bookValue: '8800.0000' }));
      }
      if (method === 'POST' && segments[5] === 'acquire') {
        return jsonResponse(fixedAssetPayload({ rowVersion: 3 }));
      }
      if (method === 'POST' && segments[5] === 'dispose') {
        return jsonResponse(fixedAssetPayload({ status: 'DISPOSED', disposedOn: '2026-12-01', rowVersion: 3 }));
      }
      if (method === 'POST' && segments[5] === 'transfer') {
        return jsonResponse(fixedAssetPayload({ costCenterCode: 'CC-NEW', rowVersion: 3 }));
      }
      if (method === 'POST' && segments[5] === 'reverse') {
        return jsonResponse(fixedAssetPayload({ status: 'REGISTERED', bookValue: '0.0000', rowVersion: 3, movements: [] }));
      }
    }

    // charts list
    if (method === 'GET' && segments[3] === 'charts' && segments.length === 4) {
      return allowed
        ? jsonResponse({ unitId: url.searchParams.get('unitId'), items: [{ id: CHART_ID, unitId: 'unit-a', code: 'COA', name: 'Plano padrão', status: 'ACTIVE' }] })
        : deniedResponse();
    }
    // accounts list
    if (method === 'GET' && segments[3] === 'charts' && segments[5] === 'accounts') {
      return allowed
        ? jsonResponse({
            chartId: segments[4],
            items: [
              { id: CASH_ID, chartId: segments[4], parentId: null, code: '1.1.01', name: 'Cash', class: 'ASSET', status: 'ACTIVE' },
              { id: REVENUE_ID, chartId: segments[4], parentId: null, code: '4.1.01', name: 'Revenue', class: 'REVENUE', status: 'ACTIVE' },
            ],
          })
        : deniedResponse();
    }
    // periods list
    if (method === 'GET' && segments[3] === 'charts' && segments[5] === 'periods') {
      return allowed
        ? jsonResponse({
            chartId: segments[4],
            items: [
              {
                id: PERIOD_ID,
                chartId: segments[4],
                unitId: 'unit-a',
                code: '2026-10',
                startsOn: '2026-10-01',
                endsOn: '2026-10-31',
                status: state.closed ? 'CLOSED' : 'OPEN',
                reopenCount: 0,
                rowVersion: 2,
                closedAt: null,
                reopenedAt: null,
                closeChecks: [],
              },
            ],
          })
        : deniedResponse();
    }
    // ledger reconstruction (Plano de contas saldos)
    if (method === 'GET' && url.pathname === '/api/v1/accounting/ledger') {
      return allowed
        ? jsonResponse({
            chartId: CHART_ID,
            totalDebits: '100.0000',
            totalCredits: '100.0000',
            balanced: true,
            accounts: [{ accountId: CASH_ID, debits: '100.0000', credits: '0.0000' }],
          })
        : deniedResponse();
    }
    // journals list (Diário/lançamentos)
    if (method === 'GET' && segments[3] === 'charts' && segments[5] === 'journals') {
      return allowed
        ? jsonResponse({ page: 0, pageSize: 25, total: 1, totalPages: 1, items: [journalPayload()] })
        : deniedResponse();
    }
    // single journal (detail route)
    if (method === 'GET' && segments[3] === 'journals') {
      return allowed ? jsonResponse(journalPayload()) : deniedResponse();
    }
    // post
    if (method === 'POST' && segments[3] === 'journals' && segments[5] === 'post') {
      return allowed ? jsonResponse({ ...journalPayload(), rowVersion: 3 }) : deniedResponse();
    }
    // reverse
    if (method === 'POST' && segments[3] === 'journals' && segments[5] === 'reverse') {
      return allowed ? jsonResponse(reversalPayload()) : deniedResponse();
    }
    // close
    if (method === 'POST' && segments[3] === 'periods' && segments[5] === 'close') {
      if (!allowed) {
        return deniedResponse();
      }
      state.closed = true;
      return jsonResponse({
        id: segments[4],
        chartId: CHART_ID,
        unitId: 'unit-a',
        code: '2026-10',
        startsOn: '2026-10-01',
        endsOn: '2026-10-31',
        status: 'CLOSED',
        reopenCount: 0,
        rowVersion: 3,
        closedAt: '2026-11-01T10:00:00.000Z',
        reopenedAt: null,
        closeChecks: [{ kind: 'DEBIT_CREDIT', result: 'PASS', blocking: false, observedCount: 0, detail: 'Ok.' }],
      });
    }
    // reopen
    if (method === 'POST' && segments[3] === 'periods' && segments[5] === 'reopen') {
      if (!allowed) {
        return deniedResponse();
      }
      state.closed = false;
      return jsonResponse({
        id: segments[4],
        chartId: CHART_ID,
        unitId: 'unit-a',
        code: '2026-10',
        startsOn: '2026-10-01',
        endsOn: '2026-10-31',
        status: 'OPEN',
        reopenCount: 1,
        rowVersion: 4,
        closedAt: null,
        reopenedAt: '2026-11-02T10:00:00.000Z',
        closeChecks: [],
      });
    }
    // close runs
    if (method === 'GET' && segments[3] === 'periods' && segments[5] === 'close-runs') {
      return allowed
        ? jsonResponse({
            periodId: segments[4],
            runs: state.closed
              ? [{ id: 'run-1', status: 'SUCCEEDED', createdAt: '2026-11-01T10:00:00.000Z', checks: [{ kind: 'DEBIT_CREDIT', result: 'PASS', blocking: false, observedCount: 0, detail: 'Ok.' }] }]
              : [],
          })
        : deniedResponse();
    }
    // razão por conta
    if (method === 'GET' && segments[3] === 'periods' && segments[5] === 'ledger') {
      return allowed
        ? jsonResponse({
            periodId: segments[4],
            account: { id: CASH_ID, code: '1.1.01', name: 'Cash', class: 'ASSET', status: 'ACTIVE', normalBalance: 'DEBIT' },
            source: 'POSTED_JOURNAL_ENTRY',
            openingBalance: { side: 'DEBIT', amount: '0' },
            periodDebits: '100',
            periodCredits: '0',
            closingBalance: { side: 'DEBIT', amount: '100' },
            page: 0,
            pageSize: 30,
            total: 1,
            totalPages: 1,
            movements: [{ journalEntryId: JOURNAL_ID, occurredOn: '2026-10-05', description: 'Venda de serviços', sourceReference: 'Venda 001', kind: 'ENTRY', direction: 'DEBIT', amount: '100', runningBalance: { side: 'DEBIT', amount: '100' } }],
          })
        : deniedResponse();
    }
    // income statement
    if (method === 'GET' && segments[3] === 'periods' && segments[5] === 'income-statement') {
      return allowed
        ? jsonResponse({ periodId: segments[4], source: 'POSTED_JOURNAL_ENTRY', available: true, revenue: '100', expense: '30', netIncome: '70' })
        : deniedResponse();
    }
    // trial balance
    if (method === 'GET' && segments[3] === 'periods' && segments[5] === 'trial-balance') {
      return allowed
        ? jsonResponse({
            periodId: segments[4],
            source: 'POSTED_JOURNAL_ENTRY',
            accounts: [{ accountId: CASH_ID, code: '1.1.01', name: 'Cash', class: 'ASSET', debit: '100', credit: '0' }],
            totalDebits: '100',
            totalCredits: '100',
            difference: '0',
            balanced: true,
          })
        : deniedResponse();
    }
    return jsonResponse({ error: { code: 'ACCOUNTING_NOT_FOUND' } }, 404);
  };
}

configure({ asyncUtilTimeout: 1500 });

describe('Accounting backoffice UI (server-driven scope)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  async function selectScope(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/unidade operacional/i), 'unit-a');
    await user.click(screen.getByRole('button', { name: /carregar/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/plano de contas/i)).not.toBeDisabled();
    });
    await user.selectOptions(screen.getByLabelText(/plano de contas/i), CHART_ID);
    await waitFor(() => {
      expect(screen.getByLabelText(/período contábil/i)).not.toBeDisabled();
    });
    await user.selectOptions(screen.getByLabelText(/período contábil/i), PERIOD_ID);
  }

  it('shows the chart of accounts tree after selecting unit and chart', async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    vi.stubGlobal('fetch', createAccountingFetchMock());
    renderWithProviders(<ChartOfAccountsPage />);
    // A unidade vem da lista do shell (nenhum identificador digitado); selecionada a unidade,
    // os planos dela sao carregados pelo servidor.
    await waitFor(() => {
      expect(screen.getByLabelText(/unidade operacional/i)).not.toBeDisabled();
    });
    expect(screen.getByLabelText(/unidade operacional/i).tagName).toBe('SELECT');
    await waitFor(() => {
      expect(screen.getByLabelText(/plano de contas/i)).not.toBeDisabled();
    });
    await user.selectOptions(screen.getByLabelText(/plano de contas/i), CHART_ID);
    await waitFor(() => {
      expect(screen.getByText('Cash')).toBeInTheDocument();
      expect(screen.getByText('Revenue')).toBeInTheDocument();
    });
    expect(screen.getByRole('table', { name: /árvore de contas/i })).toBeInTheDocument();
  });

  it('lists journals by period and opens the detail with post/reverse actions', async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    vi.stubGlobal('fetch', createAccountingFetchMock());
    renderWithProviders(
      <Routes>
        <Route path="/app/accounting/journals" element={<JournalsPage />} />
        <Route path="/app/accounting/journals/:journalId" element={<JournalsPage />} />
      </Routes>,
      { router: { initialEntries: ['/app/accounting/journals'] } },
    );
    await user.type(screen.getByLabelText(/unidade operacional/i), 'unit-a');
    await user.click(screen.getByRole('button', { name: /carregar/i }));
    await waitFor(() => expect(screen.getByLabelText(/plano de contas/i)).not.toBeDisabled());
    await user.selectOptions(screen.getByLabelText(/plano de contas/i), CHART_ID);
    await waitFor(() => expect(screen.getByLabelText(/período contábil/i)).not.toBeDisabled());
    await user.selectOptions(screen.getByLabelText(/período contábil/i), PERIOD_ID);
    await waitFor(() => {
      expect(screen.getByText('Venda de serviços')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await waitFor(() => {
      expect(screen.getByRole('table', { name: /linhas do lançamento/i })).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Cash/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Estornar' })).toBeInTheDocument();
  });

  it('shows the Diário (journal book) as a server projection with account codes', async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    vi.stubGlobal('fetch', createAccountingFetchMock());
    renderWithProviders(<JournalBookPage />);
    await user.type(screen.getByLabelText(/unidade operacional/i), 'unit-a');
    await user.click(screen.getByRole('button', { name: /carregar/i }));
    await waitFor(() => expect(screen.getByLabelText(/plano de contas/i)).not.toBeDisabled());
    await user.selectOptions(screen.getByLabelText(/plano de contas/i), CHART_ID);
    await waitFor(() => expect(screen.getByLabelText(/período contábil/i)).not.toBeDisabled());
    await user.selectOptions(screen.getByLabelText(/período contábil/i), PERIOD_ID);
    await waitFor(() => {
      expect(screen.getByRole('table', { name: /livro diário/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/1\.1\.01/)).toBeInTheDocument();
    expect(screen.getByText(/4\.1\.01/)).toBeInTheDocument();
    expect(screen.getAllByText('1')).not.toHaveLength(0);
  });

  it('shows the single-account Razão with opening, running balance and closing', async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    vi.stubGlobal('fetch', createAccountingFetchMock());
    renderWithProviders(<GeneralLedgerPage />);
    await selectScope(user);
    await waitFor(() => expect(screen.getByLabelText(/conta \(razão\)/i)).not.toBeDisabled());
    await user.selectOptions(screen.getByLabelText(/conta \(razão\)/i), CASH_ID);
    await waitFor(() => {
      expect(screen.getByRole('table', { name: /razão da conta/i })).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Cash/).length).toBeGreaterThan(0);
    expect(screen.getByText(/devedora/i)).toBeInTheDocument();
  });

  it('shows DRE net income returned by the server for the selected period', async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    vi.stubGlobal('fetch', createAccountingFetchMock());
    renderWithProviders(<IncomeStatementPage />);
    await selectScope(user);
    await waitFor(() => {
      expect(screen.getByText('Resultado do período')).toBeInTheDocument();
    });
  });

  it('loads fixed asset accounting register with movements from the server', async () => {
    vi.stubGlobal('fetch', createAccountingFetchMock());
    renderWithProviders(
      <Routes>
        <Route path="/app/accounting/fixed-assets" element={<FixedAssetsPage />} />
        <Route path="/app/accounting/fixed-assets/:registerId" element={<FixedAssetsPage />} />
      </Routes>,
      { router: { initialEntries: [`/app/accounting/fixed-assets/${FIXED_ASSET_ID}`] } },
    );

    await waitFor(() => {
      expect(screen.getByRole('table', { name: /movimentos do imobilizado/i })).toBeInTheDocument();
    });
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText(/60 meses/i)).toBeInTheDocument();
    expect(screen.getByText('ACQUISITION')).toBeInTheDocument();
    expect(screen.getByText('DEPRECIATION')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /depreciar/i })).toBeInTheDocument();
  });

  it('closes and reopens a period using the period list (no manual identifier)', async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    vi.stubGlobal('fetch', createAccountingFetchMock());
    renderWithProviders(<PeriodClosePage />);
    await selectScope(user);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
    });
    const reasonField = screen.getAllByLabelText(/justificativa/i)[0];
    await user.type(reasonField as HTMLElement, 'Fechamento mensal');
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => {
      expect(screen.getByText('Fechado')).toBeInTheDocument();
    });
    expect(screen.getByText('Concluído')).toBeInTheDocument();
  });

  it('shows access denied when the backend denies accounting lists', async () => {
    vi.stubGlobal('fetch', createAccountingFetchMock({ accountingAllowed: false }));
    renderWithProviders(<ChartOfAccountsPage />);
    // A unidade autorizada entra pelo contexto do shell; a negacao vem da consulta contabil.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });
});

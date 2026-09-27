import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock, MOCK_RECEIVABLE_ID, MOCK_STATEMENT_ID } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { formatMoneyBrl } from '../ui/format/money';
import { BankReconciliationPage } from './pages/BankReconciliationPage';
import { FinanceOverviewPage } from './pages/FinanceOverviewPage';
import { ReceivableDetailPage } from './pages/ReceivableDetailPage';
import { ReceivablesListPage } from './pages/ReceivablesListPage';

const VIEWPORTS = [320, 390, 768, 1024, 1440] as const;

/** URL efetivamente pedida ao servidor, sem stringificar objeto de requisição. */
function requestedUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

function applyViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width, writable: true });
  window.dispatchEvent(new Event('resize'));
}

describe('Finance backoffice UI', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('shows loading then titles from the backend', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<ReceivablesListPage />);
    expect(screen.getByText(/carregando contas a receber/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'AR-001' })).toBeInTheDocument();
    });
    expect(screen.getByRole('table', { name: /lista de contas a receber/i })).toBeInTheDocument();
    expect(screen.getAllByText(/1\.500/).length).toBeGreaterThan(0);
  });

  it('shows empty state when the server returns no titles', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ receivableCount: 0 }));
    renderWithProviders(<ReceivablesListPage />);
    await waitFor(() => {
      expect(screen.getByText(/nenhum título a receber/i)).toBeInTheDocument();
    });
  });

  it('shows permission denied from the API', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ receivableListAllowed: false }));
    renderWithProviders(<ReceivablesListPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });

  it('shows network failure with retry', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ networkError: true }));
    renderWithProviders(<ReceivablesListPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/conectar ao servidor/i);
    });
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('paginates large tables without inventing extra rows', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock({ receivableCount: 60 }));
    renderWithProviders(<ReceivablesListPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'AR-001' })).toBeInTheDocument();
    });
    expect(screen.getAllByRole('row')).toHaveLength(51);
    await user.click(screen.getByRole('button', { name: /próxima/i }));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'AR-051' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'AR-001' })).not.toBeInTheDocument();
  });

  it('overview uses counts and server aging, not a client-side balance total', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<FinanceOverviewPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(/quantidade de títulos a receber/i)).toHaveTextContent('2');
    });
    expect(screen.getByLabelText(/quantidade de títulos a pagar/i)).toHaveTextContent('1');
    expect(screen.queryByText(formatMoneyBrl('2300.0000'))).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: /aging de contas a pagar/i })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: /aging/i })).getByText(/800/)).toBeInTheDocument();
  });

  it('blocks double submit and surfaces version conflict', async () => {
    const settleCalls = { count: 0 };
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock({ settleConflict: true, settleCalls }));
    renderWithProviders(
      <Routes>
        <Route path="/app/finance/receivables/:receivableId" element={<ReceivableDetailPage />} />
      </Routes>,
      { router: { initialEntries: [`/app/finance/receivables/${MOCK_RECEIVABLE_ID}`] } },
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/valor/i)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/valor/i), '1500.0000');
    await user.click(screen.getByRole('button', { name: 'Receber' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Receber' });
    await Promise.all([user.click(confirm), user.click(confirm)]);
    await waitFor(() => {
      expect(screen.getByText(/versão do registro mudou/i)).toBeInTheDocument();
    });
    expect(settleCalls.count).toBe(1);
    expect(screen.queryByText(/recebido com sucesso/i)).not.toBeInTheDocument();
  });

  it('opens the workbench from the statement list without typing a technical identifier', async () => {
    const user = userEvent.setup();
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/app/finance/reconciliation" element={<BankReconciliationPage />} />
        <Route path="/app/finance/reconciliation/:statementId" element={<BankReconciliationPage />} />
      </Routes>,
      { router: { initialEntries: ['/app/finance/reconciliation'] } },
    );

    // A mesa abre pela lista real: nenhum campo de identificador técnico existe.
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'STMT-1' })).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/identificador do extrato/i)).not.toBeInTheDocument();
    expect(screen.getByText('BAN-1 — Conta principal')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'STMT-1' }));
    // A lista continua na tela: a contagem de linhas é a da tabela do extrato aberto.
    const linesTable = await screen.findByRole('table', { name: /linhas do extrato bancário/i });
    expect(within(linesTable).getAllByRole('row')).toHaveLength(51);
    expect(fetchMock.mock.calls.some(([input]) => requestedUrl(input).includes(MOCK_STATEMENT_ID))).toBe(true);
  });

  it('sends the statement status filter that arrived through the URL to the API', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/app/finance/reconciliation" element={<BankReconciliationPage />} />
      </Routes>,
      { router: { initialEntries: ['/app/finance/reconciliation?status=CLOSED'] } },
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => requestedUrl(input).includes('status=CLOSED')),
      ).toBe(true);
    });
  });

  it('keeps primary finance surfaces usable across required viewports', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    const { container } = renderWithProviders(<ReceivablesListPage />);
    await waitFor(() => {
      expect(screen.getByRole('table', { name: /lista de contas a receber/i })).toBeInTheDocument();
    });
    for (const width of VIEWPORTS) {
      applyViewport(width);
      expect(container.querySelector('table')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Contas a receber' })).toBeInTheDocument();
    }
  });
});

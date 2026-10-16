import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock, MOCK_RECEIVABLE_ID, MOCK_STATEMENT_ID } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { openPrimaryProcessContext } from '../test/workspace-ui-helpers';
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

/**
 * IDENTIDADE DA LINHA, lida do texto da célula de referência externa.
 *
 * A worklist foi movida para o padrão enterprise de linha: a navegação é `onRowClick` e a ação
 * visível é o botão "Prévia de AR-001" — não existe mais `<a>` na linha, e as asserções antigas
 * (`getByRole('link', { name: 'AR-001' })`) exigiam um contrato que a tela não publica mais. Ler a
 * identidade pelo `data-row-id` da linha de dado prova a MESMA coisa sem depender do elemento que
 * a tela escolheu para navegar.
 */
function rowIdentifiers(): string[] {
  return screen
    .getAllByTestId('dynamic-list-row')
    .map((row) => within(row).getByText(/^A[RP]-\d+$/).textContent ?? '');
}

describe('Finance backoffice UI', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('shows loading then titles from the backend', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<ReceivablesListPage />, { metadata: true });
    expect(screen.getByText(/carregando contas a receber/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-001');
    });
    expect(screen.getByRole('table', { name: /lista de contas a receber/i })).toBeInTheDocument();
    expect(screen.getAllByText(/1\.500/).length).toBeGreaterThan(0);
  });

  it('shows empty state when the server returns no titles', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ receivableCount: 0 }));
    renderWithProviders(<ReceivablesListPage />, { metadata: true });
    await waitFor(() => {
      expect(screen.getByText(/nenhum título a receber/i)).toBeInTheDocument();
    });
  });

  it('shows permission denied from the API', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ receivableListAllowed: false }));
    renderWithProviders(<ReceivablesListPage />, { metadata: true });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });

  it('shows network failure with retry', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ networkError: true }));
    renderWithProviders(<ReceivablesListPage />, { metadata: true });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/conectar ao servidor/i);
    });
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('paginates large tables without inventing extra rows', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock({ receivableCount: 60 }));
    renderWithProviders(<ReceivablesListPage />, { metadata: true });
    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-001');
    });
    /*
     * A página server-side traz 50 títulos: 50 linhas de dados + 1 linha de cabeçalho. A grade
     * não inventa linha, e a contagem é feita por `dynamic-list-row` (linha de DADO), não por
     * `role=row` — que incluiria o cabeçalho e o rodapé de agregação.
     */
    expect(screen.getAllByTestId('dynamic-list-row')).toHaveLength(50);
    await user.click(screen.getByRole('button', { name: /próxima/i }));
    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-051');
    });
    expect(rowIdentifiers()).not.toContain('AR-001');
  });

  it('uses authoritative portfolio metrics instead of counting the current page', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ receivableCount: 60 }));
    renderWithProviders(<ReceivablesListPage />, { metadata: true });
    await waitFor(() => {
      /*
       * A FAIXA DE SITUAÇÃO substituiu os cartões de drill-down. O número continua vindo do resumo
       * do SERVIDOR ("60" títulos no recorte), e não da página carregada — que traz 50. É essa
       * diferença entre 60 e 50 que prova que a tela não conta a amostra.
       *
       * "Recorte" é o único indicador SEM drilldown (ele não abre um subconjunto de si mesmo): por
       * isso ele é texto, e o valor é lido pelo rótulo do próprio grupo.
       */
      const strip = screen.getByLabelText(/situação financeira do recorte/i);
      const recorteValue = within(strip).getByText('Recorte').closest('div');
      expect(recorteValue).not.toBeNull();
      expect(within(recorteValue as HTMLElement).getByText('60')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('dynamic-list-row')).toHaveLength(50);
  });

  it('overview uses counts and server aging, not a client-side balance total', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<FinanceOverviewPage />);
    await openPrimaryProcessContext(userEvent.setup());
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
      {
        router: { initialEntries: [`/app/finance/receivables/${MOCK_RECEIVABLE_ID}`] },
        metadata: true,
      },
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Registrar recebimento' })).toBeInTheDocument();
    });
    /*
     * O formulário é PROGRESSIVO: o campo "Valor" só existe depois que o operador abre a ação de
     * recebimento. O teste antigo esperava o campo direto, sem abrir nada — media um estado que a
     * tela não oferece. Abrir é o caminho real.
     */
    await user.click(screen.getByRole('button', { name: 'Registrar recebimento' }));
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
    /*
     * A GRADE DE TRABALHO compara banco × CISNE numa tabela densa por movimento. O nome mudou
     * junto com a estrutura; a PAGINAÇÃO não: 50 linhas paginadas continuam rendendo 50 linhas de
     * corpo + cabeçalho = 51 `<tr>`, e é isso que o número abaixo prende. Renderizar o extrato
     * inteiro numa parede de blocos faria esta contagem deixar de significar paginação.
     */
    const linesTable = await screen.findByRole('table', {
      name: /movimentos do extrato bancário/i,
    });
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
    const { container } = renderWithProviders(<ReceivablesListPage />, { metadata: true });
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

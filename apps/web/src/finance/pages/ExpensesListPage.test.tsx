import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { createExpensesFetchMock, EXPENSES_TEST_DATA } from '../../test/expenses-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';
import { ExpensesListPage } from './ExpensesListPage';

describe('ExpensesListPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('lists expenses by description and cost center instead of an identifier', async () => {
    vi.stubGlobal('fetch', createExpensesFetchMock());
    renderWithProviders(<ExpensesListPage />, { metadata: true });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Combustível da frota' })).toHaveAttribute(
        'href',
        `/app/finance/expenses/${EXPENSES_TEST_DATA.EXPENSES[0]!.id}`,
      );
    });

    expect(screen.getByRole('table', { name: 'Lista de Despesas' })).toBeInTheDocument();
    expect(screen.getByText('CC-MANUT')).toBeInTheDocument();
    /*
     * FAIXA REAL DE REGISTROS, no padrão de worklist: "1–2 de 2". A versão anterior dizia
     * "2 despesa(s) no total", que só informava a página corrente e não situava o operador no
     * conjunto. A paginação continua server-side; o que mudou é o texto do rodapé.
     */
    expect(screen.getByText(/1–2 de 2/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/identificador da despesa/i),
    ).not.toBeInTheDocument();
  });

  it('sends search and status filter to the server', async () => {
    const fetchMock = createExpensesFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<ExpensesListPage />, { metadata: true });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Combustível da frota' })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Buscar'), 'CC-MANUT');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : ''));
      expect(urls.some((url) => url.includes('/finance/expenses') && url.includes('q=CC-MANUT'))).toBe(true);
    });

    await user.selectOptions(screen.getByLabelText('Status'), 'DRAFT');
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : ''));
      expect(urls.some((url) => url.includes('status=DRAFT'))).toBe(true);
    });
  });

  it('honors the status filter carried in the URL so the Ctrl+K command lands filtered', async () => {
    const fetchMock = createExpensesFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    // `view.expenses.submitted` navega para /app/finance/expenses?status=SUBMITTED.
    // Antes desta adocao a tela ignorava a query string e mostrava a lista inteira.
    renderWithProviders(<ExpensesListPage />, {
      router: { initialEntries: ['/app/finance/expenses?status=SUBMITTED'] },
      metadata: true,
    });

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : ''));
      expect(urls.some((url) => url.includes('/finance/expenses') && url.includes('status=SUBMITTED'))).toBe(true);
    });

    expect(screen.getByLabelText('Status')).toHaveValue('SUBMITTED');
  });

  it('shows the denied state when the server refuses the list grant', async () => {
    vi.stubGlobal('fetch', createExpensesFetchMock({ denied: true }));
    renderWithProviders(<ExpensesListPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });

  /*
   * PROCESSAMENTO EM LOTE — a capability que esta worklist não tinha.
   *
   * Antes: o operador marcava N despesas e repetia a ação uma a uma. Os testes abaixo provam o
   * caminho completo (seleção → barra → comando por registro) e, principalmente, que um lote
   * PARCIAL é relatado como parcial — nunca como sucesso.
   */
  it('processes only the selected expenses in bulk, one authorized command per record', async () => {
    const fetchMock = createExpensesFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<ExpensesListPage />, { metadata: true });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Combustível da frota' })).toBeInTheDocument();
    });

    // Seleciona APENAS a primeira despesa (DRAFT, a que pode ser enviada).
    const boxes = screen.getAllByTestId('dynamic-list-select-row');
    await user.click(boxes[0]!);

    await user.click(await screen.findByRole('button', { name: 'Enviar para aprovação' }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) =>
          call[1]?.method === 'POST' &&
          typeof call[0] === 'string' &&
          call[0].includes('/submit'),
      );
      expect(posts.length).toBe(1);
      // PROVA NEGATIVA: a despesa NÃO selecionada não é processada.
      expect(posts[0]![0]).toContain(EXPENSES_TEST_DATA.EXPENSES[0]!.id);
      expect(posts[0]![0]).not.toContain(EXPENSES_TEST_DATA.EXPENSES[1]!.id);
    });
  });

  it('reports a partial batch as partial instead of masking the failure', async () => {
    const failingId = EXPENSES_TEST_DATA.EXPENSES[1]!.id;
    const fetchMock = createExpensesFetchMock({ failCommandFor: [failingId] });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<ExpensesListPage />, { metadata: true });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Combustível da frota' })).toBeInTheDocument();
    });

    for (const box of screen.getAllByTestId('dynamic-list-select-row')) {
      await user.click(box);
    }
    await user.click(await screen.findByRole('button', { name: 'Aprovar' }));

    // O lote de 2 com 1 recusa tem de DIZER que 1 falhou — não pode sair limpo.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/1 de 2/);
    });
  });
});

import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderWithProviders } from '../../test/render-with-providers';
import { BudgetsListPage } from './BudgetsListPage';

/**
 * Resposta vazia e suficiente: o objetivo e observar a URL que a tela monta,
 * nao a renderizacao das linhas.
 */
function createBudgetsFetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/finance/budgets')) {
      return new Response(
        JSON.stringify({ items: [], limit: 20, offset: 0, total: 0, totalPages: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('BudgetsListPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('honors the status filter carried in the URL so the Ctrl+K command lands filtered', async () => {
    const fetchMock = createBudgetsFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    // `view.budgets.draft` navega para /app/finance/budgets?status=DRAFT.
    // Antes desta adocao a tela ignorava a query string e pedia a lista inteira.
    renderWithProviders(<BudgetsListPage />, {
      router: { initialEntries: ['/app/finance/budgets?status=DRAFT'] },
    });

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => {
        const input = call[0] as RequestInfo | URL;
        return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      });
      expect(urls.some((url) => url.includes('/finance/budgets') && url.includes('status=DRAFT'))).toBe(true);
    });

    expect(screen.getByLabelText('Status')).toHaveValue('DRAFT');
  });

  it('shows a contextual empty state with a way out when a filter is applied', async () => {
    vi.stubGlobal('fetch', createBudgetsFetchMock());

    renderWithProviders(<BudgetsListPage />, {
      router: { initialEntries: ['/app/finance/budgets?status=DRAFT'] },
    });

    await waitFor(() => {
      expect(screen.getByText(/nenhum orçamento encontrado para os filtros selecionados/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /limpar filtros/i })).toBeInTheDocument();
  });
});

import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderWithProviders } from '../../test/render-with-providers';
import { BudgetsListPage } from './BudgetsListPage';

/**
 * Resposta vazia e suficiente: o objetivo e observar a URL que a tela monta,
 * nao a renderizacao das linhas.
 *
 * A RESPOSTA DE SESSAO ENTRA AQUI de proposito: `authHeaders()` LANCA quando nao ha access token,
 * e sem este ramo a leitura da lista morria dentro do proprio cliente de API — o teste media uma
 * tela que nunca chegava a pedir os orcamentos, e o estado vazio "com saida" que ele verificava
 * jamais era alcancado.
 */
function createBudgetsFetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/auth/session')) {
      return new Response(
        JSON.stringify({ identityId: 'identity-1', capabilities: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    /*
     * METADADO DA ENTIDADE — a tela e renderizada pela engine: sem `GET /meta/budgets` o
     * `useEntitySchema` devolve `null` para sempre e o corpo do orcamento nunca e desenhado (so o
     * cabecalho da worklist existe). O duble precisa servir essa rota.
     */
    if (url.includes('/meta/budgets')) {
      return new Response(
        JSON.stringify({
          name: 'budgets',
          label: 'Orçamentos',
          description: null,
          dataSchema: 'finance',
          dataTable: 'budgets',
          labelField: 'code',
          fields: [],
          views: [
            {
              viewType: 'list',
              label: 'Lista',
              layout: { columns: [] },
              isDefault: true,
            },
          ],
          workflow: null,
          permissions: [],
          allowedPermLevels: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
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
      metadata: true,
    });

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => {
        const input = call[0];
        return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      });
      expect(urls.some((url) => url.includes('/finance/budgets') && url.includes('status=DRAFT'))).toBe(true);
    });

    /*
     * O rótulo do CONTROLE passou a ser "Situação" — o mesmo vocabulário das outras listas
     * financeiras (o cabeçalho da coluna na view `list` chama-se "Situação"). Antes a tela dizia
     * "Status" aqui e "Situação" na grade, dois nomes para o mesmo fato.
     */
    expect(screen.getByLabelText('Situação')).toHaveValue('DRAFT');
  });

  it('shows a contextual empty state with a way out when a filter is applied', async () => {
    vi.stubGlobal('fetch', createBudgetsFetchMock());

    renderWithProviders(<BudgetsListPage />, {
      router: { initialEntries: ['/app/finance/budgets?status=DRAFT'] },
      metadata: true,
    });

    await waitFor(() => {
      expect(screen.getByText(/nenhum orçamento encontrado para os filtros selecionados/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /limpar filtros/i })).toBeInTheDocument();
  });
});

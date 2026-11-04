import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceDefinitionsListPage } from './ServiceDefinitionsListPage';
import { renderWithProviders } from '../../test/render-with-providers';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';
import { createCatalogFetchMock } from '../../test/catalog-fetch-mock';

describe('ServiceDefinitionsListPage integration', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    vi.unstubAllGlobals();
    tokenStore.setTokens('access-token', 'refresh-token');
  });

  it('shows the service NAME as the primary identity and the code as secondary context', async () => {
    vi.stubGlobal('fetch', createCatalogFetchMock());
    renderWithProviders(<ServiceDefinitionsListPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: 'Locação de automóveis sem condutor' }),
      ).toBeInTheDocument();
    });

    // O code continua visivel, mas como contexto — nunca como identidade principal.
    expect(screen.getByText('LOCACAO-DEMO')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'LOCACAO-DEMO' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Serviço' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Categoria' })).toBeInTheDocument();
  });

  it('resolves the search on the SERVER, not on the loaded page', async () => {
    vi.stubGlobal('fetch', createCatalogFetchMock());
    renderWithProviders(<ServiceDefinitionsListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Locação de automóveis sem condutor' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    // Termo que casa com o NOME e nao existe no CODE ('LOCACAO-DEMO'): so o servidor pode achar.
    await user.type(screen.getByLabelText(/^buscar$/i), 'automóveis');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Locação de automóveis sem condutor' })).toBeInTheDocument();
    });

    // Termo inexistente: o servidor devolve vazio e a tela diz isso.
    await user.clear(screen.getByLabelText(/^buscar$/i));
    await user.type(screen.getByLabelText(/^buscar$/i), 'zzz-nao-existe');

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/nenhuma definição corresponde aos filtros/i);
    });
  });

  it('keeps showing the service when the search matches the name on the server', async () => {
    vi.stubGlobal('fetch', createCatalogFetchMock());
    renderWithProviders(<ServiceDefinitionsListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Locação de automóveis sem condutor' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^buscar$/i), 'locação');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Locação de automóveis sem condutor' })).toBeInTheDocument();
    });
  });

  it('keeps pagination and the true page scope visible when a server-side filter returns zero rows', async () => {
    vi.stubGlobal('fetch', createCatalogFetchMock());
    renderWithProviders(<ServiceDefinitionsListPage />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Locação de automóveis sem condutor' })).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/^buscar$/i), 'zzz-nao-existe');

    await waitFor(() => {
      expect(screen.getByText('0–0 de 0')).toBeInTheDocument();
    });
    expect(screen.getByRole('navigation', { name: 'Paginação' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(screen.getByLabelText('0 registros no recorte')).toBeInTheDocument();
  });

  it('lets the operator return from an empty second page without claiming the catalog is empty', async () => {
    const fallback = createCatalogFetchMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      if (url.pathname !== '/api/v1/catalog/service-definitions' || (init?.method ?? 'GET') !== 'GET') {
        return fallback(input, init);
      }
      const response = await fallback(input, init);
      const data = (await response.json()) as { items: Array<{ id: string; name: string | null; code: string }> };
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const items = offset === 0
        ? Array.from({ length: 20 }, (_, index) => ({
            ...data.items[0],
            id: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`,
            name: `Serviço empresarial ${index + 1}`,
            code: `SERV-${index + 1}`,
          }))
        : [];
      return {
        ok: true,
        status: 200,
        json: async () => ({ items, limit: 20, offset, total: offset === 0 ? 21 : 20, asOf: '2026-11-04T12:00:00.000Z' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ServiceDefinitionsListPage />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('1–20 de 21')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => {
      expect(screen.getByText('Esta página não existe mais para o recorte atual.')).toBeInTheDocument();
    });
    expect(screen.getByText('0 nesta página de 20')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(screen.getByText('1–20 de 21')).toBeInTheDocument());
    expect(screen.getByRole('table', { name: /lista de definições de serviço/i })).toBeInTheDocument();
  });

  it('resolves the version filter in the backend before pagination', async () => {
    const mock = createCatalogFetchMock();
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<ServiceDefinitionsListPage />);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Locação de automóveis sem condutor' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Versões' }), 'HAS_DRAFT');
    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith(
        expect.stringContaining('versionFilter=HAS_DRAFT'),
        expect.anything(),
      );
    });
    expect(await screen.findByText('Nenhuma definição corresponde aos filtros aplicados.')).toBeInTheDocument();
    expect(screen.getByText('0–0 de 0')).toBeInTheDocument();
  });

  it('does not confuse authorization denial with an empty catalog', async () => {
    vi.stubGlobal('fetch', createCatalogFetchMock({ catalogListAllowed: false }));
    renderWithProviders(<ServiceDefinitionsListPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/permissão|acesso/i));
    expect(screen.queryByText('0–0 de 0')).not.toBeInTheDocument();
  });

});

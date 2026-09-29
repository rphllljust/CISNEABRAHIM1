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
      expect(screen.getByRole('status')).toHaveTextContent(/nenhuma definição encontrada/i);
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
});

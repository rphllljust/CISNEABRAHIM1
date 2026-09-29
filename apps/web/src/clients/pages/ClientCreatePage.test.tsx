import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientCreatePage } from './ClientCreatePage';
import { createClientsFetchMock } from '../../test/clients-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';

describe('ClientCreatePage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('shows validation errors for invalid create', async () => {
    vi.stubGlobal('fetch', createClientsFetchMock());
    const user = userEvent.setup();

    renderWithProviders(<ClientCreatePage />);

    /*
     * A pagina tem DOIS estados com o mesmo titulo: enquanto `useClientCapabilities` resolve, ela
     * mostra "Verificando permissões…" sob o MESMO `<h1>Novo Cliente</h1>`. Esperar apenas pelo
     * heading passava no estado de CARGA e o formulario ainda nao existia — por isso a espera e
     * pelo CAMPO do formulario, que so aparece quando a tela esta de fato utilizavel.
     */
    await waitFor(() => {
      expect(screen.getByLabelText(/razão social/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /cadastrar cliente/i }));

    await waitFor(() => {
      expect(screen.getByText(/razão social é obrigatória/i)).toBeInTheDocument();
    });
  });

  it('maps duplicate CNPJ to business message', async () => {
    vi.stubGlobal('fetch', createClientsFetchMock());
    const user = userEvent.setup();

    renderWithProviders(<ClientCreatePage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/razão social/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/razão social/i), 'Outra LTDA');
    await user.type(screen.getByLabelText(/^cnpj\b/i), '11.222.333/0001-81');
    await user.type(screen.getByLabelText(/nome do contato/i), 'Ops');
    await user.type(screen.getByLabelText(/^e-mail$/i), 'ops@demo.invalid');
    await user.click(screen.getByRole('button', { name: /cadastrar cliente/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/já existe um cliente cadastrado com este cnpj/i);
    });
  });

  it('shows permission denied when create capability is denied', async () => {
    vi.stubGlobal('fetch', createClientsFetchMock({ clientCreateAllowed: false }));
    renderWithProviders(<ClientCreatePage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão para cadastrar clientes/i);
    });
  });
});

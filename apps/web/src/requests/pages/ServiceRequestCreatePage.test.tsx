import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestsFetchMock } from '../../test/requests-fetch-mock';
import { renderRequestRoutes } from '../../test/render-request-routes';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';
import { SERVICE_REQUEST_ORIGINS } from '../types/service-request.types';

describe('ServiceRequestCreatePage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('creates a service request', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock());
    const user = userEvent.setup();
    renderRequestRoutes('/app/requests/new');

    // A página declara o título já durante a verificação de permissões (o cabeçalho acompanha o
    // estado de carga), então o cabeçalho sozinho não indica que o cadastro montou. Esperar o
    // CONTROLE do formulário é o sinal honesto de que a capability respondeu e o cadastro abriu.
    await screen.findByLabelText(/^origem/i, { selector: 'select' });

    expect(screen.getByRole('heading', { name: /nova solicitação/i })).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText(/^origem/i, { selector: 'select' }),
      SERVICE_REQUEST_ORIGINS.Email,
    );
    await user.type(
      screen.getByLabelText(/^unidade operacional/i, { selector: 'input' }),
      'unit-demo',
    );
    await user.type(screen.getByLabelText('Nome do contato externo'), 'Maria');
    await user.type(
      screen.getByLabelText(/^descrição/i, { selector: 'textarea' }),
      'Nova demanda de serviço',
    );
    await user.click(screen.getByRole('button', { name: /registrar solicitação/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /SR-2026-/i })).toBeInTheDocument();
    });
  });

  it('shows forbidden when create is not allowed', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock({ requestCreateAllowed: false }));
    renderRequestRoutes('/app/requests/new');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });
});

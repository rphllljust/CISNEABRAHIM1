import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createRequestsFetchMock } from '../test/requests-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';
import { SERVICE_REQUEST_ORIGINS } from './types/service-request.types';

describe('service requests administrative flow e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  async function login(user: ReturnType<typeof userEvent.setup>) {
    await loginAndReachApp(user);
  }

  it('supports list, create, submit, approve and cancel', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock());
    render(<App />);
    const user = userEvent.setup();
    await login(user);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /solicita/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('link', { name: /solicita/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /solicita.*servi/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('link', { name: /nova solicita/i }));
    await user.selectOptions(
      screen.getByLabelText(/^origem/i, { selector: 'select' }),
      SERVICE_REQUEST_ORIGINS.Phone,
    );
    await user.type(
      screen.getByLabelText(/^unidade operacional/i, { selector: 'input' }),
      'unit-demo',
    );
    await user.type(screen.getByLabelText('Telefone do contato'), '69988887777');
    await user.type(screen.getByLabelText(/descri/i), 'Fluxo E2E de solicitacao');
    await user.click(screen.getByRole('button', { name: /registrar solicita/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /próximo passo/i })).toBeInTheDocument();
    }, { timeout: 10000 });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enviar para análise/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /enviar para análise/i }));
    await user.click(screen.getByRole('button', { name: /iniciar an/i }));
    await user.click(screen.getByRole('button', { name: /^aprovar$/i }));
    await user.click(screen.getByRole('button', { name: /confirmar aprova/i }));
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }));
    await user.type(screen.getByLabelText(/motivo do cancelamento/i), 'Encerrado no teste');
    await user.click(screen.getByRole('button', { name: /confirmar cancelamento/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Cancelada')).toBeInTheDocument();
    });
  }, 20000);
});
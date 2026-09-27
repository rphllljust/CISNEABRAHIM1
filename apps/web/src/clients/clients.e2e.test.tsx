import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createClientsFetchMock } from '../test/clients-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';

describe('clients administrative flow e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  async function login(user: ReturnType<typeof userEvent.setup>) {
    await loginAndReachApp(user);
  }

  it('supports list, create, detail, edit, deactivate and activate', async () => {
    vi.stubGlobal('fetch', createClientsFetchMock());
    render(<App />);
    const user = userEvent.setup();
    await login(user);

    await waitFor(
      () => {
        expect(screen.getByRole('link', { name: /clientes/i })).toBeInTheDocument();
      },
      { timeout: 10000 },
    );
    await user.click(screen.getByRole('link', { name: /clientes/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^clientes$/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('link', { name: /novo cliente/i }));

    await user.type(screen.getByLabelText(/raz.o social/i), 'Fluxo E2E LTDA');
    await user.type(screen.getByLabelText(/^cnpj$/i), '33.444.555/0001-66');
    await user.type(screen.getByLabelText(/nome do contato/i), 'Operacoes');
    await user.type(screen.getByLabelText(/^e-mail$/i), 'ops@e2e.invalid');
    await user.click(screen.getByRole('button', { name: /cadastrar cliente/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /fluxo e2e ltda/i })).toBeInTheDocument();
    });

    // A object page canônica oferece as operações do objeto como AÇÕES do cabeçalho: editar é a
    // ação primária e a operação destrutiva vive no menu "Mais ações". Os fatos verificados (abrir
    // o formulário, desativar, reativar e ver o estado mudar) são os mesmos.
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.clear(screen.getByLabelText(/raz.o social/i));
    await user.type(screen.getByLabelText(/raz.o social/i), 'Fluxo E2E Atualizado LTDA');
    await user.click(screen.getByRole('button', { name: /salvar altera/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /fluxo e2e atualizado ltda/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /mais ações/i }));
    await user.click(screen.getByRole('menuitem', { name: /desativar/i }));
    await user.type(screen.getByLabelText(/motivo da desativa/i), 'Encerramento contratual');
    await user.click(screen.getByRole('button', { name: /confirmar desativa/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Inativo')).toBeInTheDocument();
    });

    // Inativo: a próxima ação do processo é a reativação.
    await user.click(screen.getByRole('button', { name: /reativar/i }));
    await user.click(screen.getByRole('button', { name: /confirmar reativa/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Ativo')).toBeInTheDocument();
    });
  }, 15000);
});
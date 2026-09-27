import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createAssetsFetchMock } from '../test/assets-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';

describe('physical assets administrative flow e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  async function login(user: ReturnType<typeof userEvent.setup>) {
    await loginAndReachApp(user);
  }

  it('supports list, detail, edit conflict messaging and lifecycle actions', async () => {
    vi.stubGlobal('fetch', createAssetsFetchMock());
    render(<App />);
    const user = userEvent.setup();
    await login(user);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /ativos f/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('link', { name: /ativos f/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /ativos f/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'TRK-DEMO' })).toBeInTheDocument();
    expect(screen.getByLabelText(/status de cadastro: ativo/i)).toBeInTheDocument();
    /**
     * O ativo do mock tem alocação vigente (`currentAllocation`), e o cadastro continua ativo:
     * a disponibilidade operacional correta é ALOCADO. A asserção anterior esperava
     * "disponível", contradizendo o próprio fixture e os testes de componente/lista, que já
     * esperavam "alocado" para o mesmo dado.
     */
    expect(screen.getByLabelText(/disponibilidade operacional: alocado/i)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'TRK-DEMO' }));
    await waitFor(() => {
      // Contrato enterprise: o titulo do objeto e o NOME humano; o codigo vira referencia.
      expect(screen.getByRole('heading', { name: 'Caminhão demo' })).toBeInTheDocument();
    });
    expect(screen.getAllByText('TRK-DEMO').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/cadastro \(ativo\/inativo\) e disponibilidade operacional são independentes/i),
    ).toBeInTheDocument();
    // Relacao real e autorizada: a OS que detem o recurso, com destino navegavel.
    const relationLink = await screen.findByRole('link', { name: /Ordem de serviço alocada/ });
    expect(relationLink.getAttribute('href')).toMatch(/^\/app\/service-orders\/.+\/planning$/);
    // Proxima acao derivada da alocacao vigente (espera de terceiro, sem botao).
    expect(await screen.findByRole('region', { name: 'Próxima ação' })).toHaveTextContent(
      /Aguardar a liberação da alocação/,
    );

    await user.click(await screen.findByRole('button', { name: 'Editar cadastro' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /editar TRK-DEMO/i })).toBeInTheDocument();
    });

    vi.stubGlobal('fetch', createAssetsFetchMock({ versionConflictOnUpdate: true }));
    await user.clear(screen.getByLabelText(/nome \/ descri/i));
    await user.type(screen.getByLabelText(/nome \/ descri/i), 'Nome atualizado');
    await user.click(screen.getByRole('button', { name: /salvar altera/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /recarregar dados atuais/i })).toBeInTheDocument();
    });
  }, 20000);

  it('hides assets navigation when list access is denied', async () => {
    vi.stubGlobal('fetch', createAssetsFetchMock({ assetListAllowed: false }));
    render(<App />);
    const user = userEvent.setup();
    await login(user);

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /ativos f/i })).not.toBeInTheDocument();
    });
  });
});
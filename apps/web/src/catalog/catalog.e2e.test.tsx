import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createCatalogFetchMock } from '../test/catalog-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';

describe('catalog administrative flow e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  async function login(user: ReturnType<typeof userEvent.setup>) {
    await loginAndReachApp(user);
  }

  it('supports list, detail, versioning, publish and published immutability messaging', async () => {
    vi.stubGlobal('fetch', createCatalogFetchMock());
    render(<App />);
    const user = userEvent.setup();
    await login(user);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /cat.logo de servi/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('link', { name: /cat.logo de servi/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /cat.logo de servi/i })).toBeInTheDocument();
    });
    // A LISTA identifica o servico pelo NOME humano; o code fica como contexto secundario.
    const listingLink = screen.getByRole('link', { name: 'Locação de automóveis sem condutor' });
    expect(listingLink).toBeInTheDocument();

    await user.click(listingLink);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'LOCACAO-DEMO' })).toBeInTheDocument();
    });
    expect(screen.getByText(/vers.es publicadas n.o s.o edit.veis/i)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /criar nova vers/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /criar nova vers/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /criar rascunho da nova vers/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /LOCACAO-DEMO.*v2/i })).toBeInTheDocument();
    });
    expect(screen.getAllByLabelText(/status da vers.o: rascunho/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('link', { name: /voltar . defini/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^publicar$/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /^publicar$/i }));
    await user.click(screen.getByRole('button', { name: /confirmar publica/i }));

    await waitFor(() => {
      expect(screen.getAllByLabelText(/status da vers.o: publicada/i).length).toBeGreaterThan(0);
    });
  }, 20000);

  it('hides catalog navigation when list access is denied', async () => {
    vi.stubGlobal('fetch', createCatalogFetchMock({ catalogListAllowed: false }));
    render(<App />);
    const user = userEvent.setup();
    await login(user);

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /cat.logo de servi/i })).not.toBeInTheDocument();
    });
  });
});
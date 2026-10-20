import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/context/AuthProvider';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { SessionMetaBridge } from '../service-orders/context/SessionMetaBridge';
import { createShellFetchMock } from '../test/shell-fetch-mock';
import { AppShellLayout } from './AppShellLayout';

/**
 * Monta o shell com a MESMA pilha de providers do App real.
 *
 * `AppShellLayout` e seus itens de navegação projetam capability de `useSessionMeta`, que exige o
 * `SessionMetaProvider`. A ponte `SessionMetaBridge` entra logo abaixo de `AuthProvider` — a mesma
 * posição que `renderWithProviders` usa —, porque o provider precisa ler `useAuth` acima dele. Sem
 * a ponte o shell lançaria "must be used within SessionMetaProvider" e o teste mediria a fixture,
 * não a robustez da navegação.
 */
function renderShell(initialPath = '/app') {
  window.history.pushState({}, '', initialPath);
  return render(
    <AuthProvider>
      <SessionMetaBridge>
        <MemoryRouter initialEntries={[initialPath]}>
          <AppShellLayout />
        </MemoryRouter>
      </SessionMetaBridge>
    </AuthProvider>,
  );
}

describe('shell robustness', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('does not flash privileged navigation while capabilities are loading', async () => {
    vi.stubGlobal('fetch', createShellFetchMock({ probeAllowed: false }));
    renderShell();

    expect(screen.queryByRole('link', { name: /diagnóstico da plataforma/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: /navegação principal/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /diagnóstico da plataforma/i })).not.toBeInTheDocument();
  });

  it('prevents duplicate navigation toggle activation', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());
    const user = userEvent.setup();
    renderShell();

    const toggle = await screen.findByRole('button', { name: /abrir menu/i });
    await user.click(toggle);
    await user.click(toggle);
    expect(screen.queryByRole('dialog', { name: /menu de navegação/i })).not.toBeInTheDocument();
  });
});

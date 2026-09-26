import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { loginAndReachApp, LOGIN_FORM_HEADING } from '../test/login-ui-helpers';
import { createShellFetchMock } from '../test/shell-fetch-mock';

describe('auth flow e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('redirects unauthenticated users to login and protects /app', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: LOGIN_FORM_HEADING })).toBeInTheDocument();
    });
  });

  it('logs in, reaches protected shell, and logs out', async () => {
    const fetchMock = createShellFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    window.history.pushState({}, '', '/login');
    render(<App />);

    await loginAndReachApp(user);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/session'),
      expect.objectContaining({ method: 'GET' }),
    );

    await user.click(screen.getByRole('button', { name: /menu do usuário/i }));
    await user.click(screen.getByRole('menuitem', { name: /sair/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: LOGIN_FORM_HEADING })).toBeInTheDocument();
    });
  });

  it('bootstraps session from refresh token in sessionStorage', async () => {
    sessionStorage.setItem('cisne.refreshToken', 'refresh-token');
    const fetchMock = createShellFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    window.history.pushState({}, '', '/app');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /painel operacional/i })).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/refresh'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/session'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByRole('button', { name: /menu do usuário/i })).toBeInTheDocument();
  });

  it('shows service unavailable on network errors during bootstrap', async () => {
    sessionStorage.setItem('cisne.refreshToken', 'refresh-token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    window.history.pushState({}, '', '/app');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /service unavailable/i })).toBeInTheDocument();
    });
  });

  it('keeps the session when the bootstrap refresh is rate limited (429)', async () => {
    sessionStorage.setItem('cisne.refreshToken', 'refresh-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.' } }),
      }),
    );
    window.history.pushState({}, '', '/app');
    render(<App />);

    // Limite transitorio: estado indisponivel com retentativa, NAO tela de login.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /service unavailable/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: LOGIN_FORM_HEADING })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('cisne.refreshToken')).toBe('refresh-token');
  });
});

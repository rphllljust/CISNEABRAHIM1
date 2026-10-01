import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/context/AuthProvider';
import { AUTH_ERROR_CODES } from '../auth/types/auth.types';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { requestUrl } from '../test/request-url';
import { LoginPage } from './LoginPage';

function renderLogin(initialPath = '/login', state?: { from?: string; reason?: 'session_expired' }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: initialPath, state }]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/app" element={<h1>Painel operacional</h1>} />
          <Route path="/access-denied" element={<h1>Acesso negado</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    document.title = 'Test';
  });

  it('renders CISNE RONDÔNIA wordmark and access form', () => {
    renderLogin();
    expect(screen.getAllByLabelText('CISNE Rondônia').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Cisne/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rondônia/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/identidade institucional/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /sua empresa mais eficiente/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /acessar conta/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^usuário/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^senha/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^entrar/i })).toBeInTheDocument();
    expect(document.title).toBe('CISNE Rondônia — Acessar conta');
  });

  it('shows loading state and blocks double submit', async () => {
    const user = userEvent.setup();
    let releaseLogin: (() => void) | undefined;
    const loginBlocked = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.includes('/auth/login')) {
          await loginBlocked;
          return {
            ok: true,
            json: async () => ({
              accessToken: 'access',
              refreshToken: 'refresh',
              tokenType: 'Bearer',
              expiresIn: 900,
              session: { id: 'sid', expiresAt: new Date().toISOString(), status: 'active' },
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            identityId: 'id',
            session: { id: 'sid', expiresAt: new Date().toISOString(), status: 'active' },
          }),
        } as Response;
      }),
    );

    renderLogin();
    await user.type(screen.getByLabelText(/^usuário/i), 'user@test');
    await user.type(screen.getByLabelText(/^senha/i), 'Password1!');
    const submit = screen.getByRole('button', { name: /^entrar/i });
    await user.click(submit);
    await user.click(submit);

    expect(screen.getByRole('button', { name: /carregando.*entrando/i })).toBeDisabled();
    releaseLogin?.();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /painel operacional/i })).toBeInTheDocument();
    });
  });

  it('shows sanitized error for invalid credentials and clears password', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: AUTH_ERROR_CODES.INVALID_CREDENTIALS, message: 'Invalid credentials.' },
        }),
      }),
    );

    renderLogin();
    await user.type(screen.getByLabelText(/^usuário/i), 'missing@test');
    await user.type(screen.getByLabelText(/^senha/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /^entrar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Não foi possível entrar. Verifique suas credenciais e tente novamente.',
      );
    });
    expect(screen.getByLabelText(/^senha/i)).toHaveValue('');
    expect(screen.getByLabelText(/^usuário/i)).toHaveValue('missing@test');
  });

  it('shows rate limit message for 429 responses', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: { code: AUTH_ERROR_CODES.RATE_LIMITED, message: 'Too many attempts.' },
        }),
      }),
    );

    renderLogin();
    await user.type(screen.getByLabelText(/^usuário/i), 'user@test');
    await user.type(screen.getByLabelText(/^senha/i), 'Password1!');
    await user.click(screen.getByRole('button', { name: /^entrar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Muitas tentativas. Aguarde e tente novamente.');
    });
  });

  it('shows network error message on connection failure', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    renderLogin();
    await user.type(screen.getByLabelText(/^usuário/i), 'user@test');
    await user.type(screen.getByLabelText(/^senha/i), 'Password1!');
    await user.click(screen.getByRole('button', { name: /^entrar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Não foi possível conectar ao servidor. Verifique sua conexão.',
      );
    });
  });

  it('toggles password visibility without submitting the form', async () => {
    const user = userEvent.setup();
    renderLogin();

    const password = screen.getByLabelText(/^senha/i);
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: /mostrar senha/i }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: /ocultar senha/i }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('submits with keyboard Enter and redirects to safe internal path', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes('/auth/login') && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              accessToken: 'access',
              refreshToken: 'refresh',
              tokenType: 'Bearer',
              expiresIn: 900,
              session: { id: 'sid', expiresAt: new Date().toISOString(), status: 'active' },
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            identityId: 'id',
            session: { id: 'sid', expiresAt: new Date().toISOString(), status: 'active' },
          }),
        } as Response;
      }),
    );

    renderLogin('/login', { from: '//evil.example' });
    await user.type(screen.getByLabelText(/^usuário/i), 'user@test');
    await user.type(screen.getByLabelText(/^senha/i), 'Password1!');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /painel operacional/i })).toBeInTheDocument();
    });
  });

  it('shows session expired notice when redirected with reason', () => {
    renderLogin('/login', { reason: 'session_expired' });
    expect(screen.getByRole('status')).toHaveTextContent(/sua sessão expirou/i);
  });
});

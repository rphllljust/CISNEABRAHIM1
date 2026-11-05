import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth/context/AuthProvider';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { AccessAdminRoute } from './AccessAdminRoute';
import { RolesTab } from './pages/RolesTab';

/**
 * NOTA DE SEGURANÇA: o frontend NUNCA decide autoridade. Estes testes apenas
 * verificam que o módulo renderiza o que a API (mockada) retorna e que o
 * cliente propaga os erros do servidor (ex.: conflito de versão, 403 no probe).
 * Nenhuma combinação de capacidades é calculada ou validada no cliente.
 */

const MOCK_ROLE = {
  id: 'role-1',
  code: 'ADMIN_ROLE',
  label: 'Administrador',
  description: 'Role de administrador',
  status: 'ACTIVE',
  version: 3,
  capabilities: ['access-admin:roles:read'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse({ error: { code, message: 'error' } }, status);
}

type AccessAdminFetchMockOptions = {
  probeDenied?: boolean;
  probeNetworkError?: boolean;
  versionConflictOnUpdate?: boolean;
};

function createAccessAdminFetchMock(options: AccessAdminFetchMockOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: 'identity-1',
        session: { id: 'session-1', expiresAt: new Date().toISOString(), status: 'active' },
      });
    }

    if (pathname.startsWith('/api/v1/authz/access-admin')) {
      if (pathname === '/api/v1/authz/access-admin/catalog' && method === 'GET') {
        if (options.probeNetworkError) {
          throw new TypeError('Network unavailable');
        }
        if (options.probeDenied) {
          return errorResponse('AUTHZ_DENIED', 403);
        }
        return jsonResponse({
          capabilities: [
            { code: 'access-admin:roles:read', kind: 'action', class: 'ACCESS_ADMIN' },
            { code: 'finance:approval:grant', kind: 'action', class: 'FINANCIAL_APPROVAL' },
            { code: 'sod:pair:rule', kind: 'sod' },
          ],
          scopes: [
            { code: 'org', anchored: true },
            { code: 'global', anchored: false },
          ],
        });
      }

      if (pathname === '/api/v1/authz/access-admin/roles' && method === 'GET') {
        return jsonResponse([MOCK_ROLE]);
      }

      const roleMatch = pathname.match(/^\/api\/v1\/authz\/access-admin\/roles\/([^/]+)$/);
      if (roleMatch && method === 'GET') {
        return jsonResponse(MOCK_ROLE);
      }
      if (roleMatch && method === 'PUT') {
        if (options.versionConflictOnUpdate) {
          return errorResponse('ACCESS_ADMIN_VERSION_CONFLICT', 409);
        }
        return jsonResponse({ ...MOCK_ROLE, version: MOCK_ROLE.version + 1 });
      }
    }

    return errorResponse('UNKNOWN', 404);
  });
}

describe('access-admin frontend', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    vi.unstubAllGlobals();
    tokenStore.setTokens('access-token', 'refresh-token');
  });

  it('renders roles returned by listRoles (code and version)', async () => {
    vi.stubGlobal('fetch', createAccessAdminFetchMock());

    render(<RolesTab />);

    await waitFor(() => {
      expect(screen.getByText('ADMIN_ROLE')).toBeInTheDocument();
    });
    expect(screen.getByTestId('role-version-ADMIN_ROLE')).toHaveTextContent('3');
  });

  it('surfaces the version-conflict banner when updateRole rejects with ACCESS_ADMIN_VERSION_CONFLICT', async () => {
    vi.stubGlobal('fetch', createAccessAdminFetchMock({ versionConflictOnUpdate: true }));
    const user = userEvent.setup();

    render(<RolesTab />);

    await screen.findByText('ADMIN_ROLE');

    await user.click(screen.getByRole('button', { name: /editar/i }));

    // Espera a role ser carregada no editor (input de código desabilitado).
    await screen.findByDisplayValue('ADMIN_ROLE');

    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/conflito de versão/i);
    });
  });


  it('preserves administrator access on network outages and retries without a fake 403', async () => {
    const options = { probeNetworkError: true };
    vi.stubGlobal('fetch', createAccessAdminFetchMock(options));
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/app/access-admin']}>
          <Routes>
            <Route path="/app/access-admin" element={
              <AccessAdminRoute><div>ALLOWED</div></AccessAdminRoute>
            } />
            <Route path="/app/no-access" element={<div>NO ACCESS PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/servidor pode estar indisponível/i);
    expect(screen.queryByText('NO ACCESS PAGE')).not.toBeInTheDocument();
    options.probeNetworkError = false;
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('ALLOWED')).toBeInTheDocument();
  });

  it('redirects to /app/no-access when the probe returns 403', async () => {
    vi.stubGlobal('fetch', createAccessAdminFetchMock({ probeDenied: true }));

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/app/access-admin']}>
          <Routes>
            <Route
              path="/app/access-admin"
              element={
                <AccessAdminRoute>
                  <div>ALLOWED</div>
                </AccessAdminRoute>
              }
            />
            <Route path="/app/no-access" element={<div>NO ACCESS PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('NO ACCESS PAGE')).toBeInTheDocument();
    });
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { SodExceptionsTab } from './pages/SodExceptionsTab';

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const endpoint = '/api/v1/authz/access-admin/sod-exceptions';
const subject = 'ca2d6b84-cf14-41ca-a3b9-b38723b0e0b1';
const pending = {
  id: 'b13fa816-198e-4053-913f-357cf77528e4',
  ruleId: 'SOD-007' as const, subjectIdentityId: subject,
  scopeType: 'GLOBAL', scopeAnchor: null, reason: 'A documented risk exception.',
  status: 'PENDING' as const, requestedByIdentityId: 'actor-2',
  requestedAt: '2026-10-30T12:00:00Z',
  approvedByIdentityId: null, approvedAt: null,
  revokedByIdentityId: null, revokedAt: null,
};

describe('SoD exceptions console — authorization is delegated to backend', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    vi.unstubAllGlobals();
    tokenStore.setTokens('access-token', 'refresh-token');
  });

  it('sends a PENDING request, never creates a role or approves automatically', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = parseRequestPath(input);
      if (pathname === endpoint && (init?.method ?? 'GET') === 'GET') {
        return response([]);
      }
      if (pathname === endpoint && init?.method === 'POST') {
        return response(pending, 201);
      }
      return response({ error: { code: 'UNKNOWN' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SodExceptionsTab />);
    await screen.findByText('Nenhuma exceção registrada');
    await user.type(screen.getByLabelText('Identidade beneficiária (UUID)'), subject);
    await user.type(screen.getByLabelText('Justificativa auditável (10–500 caracteres)'), 'A documented risk exception.');
    await user.click(screen.getByRole('button', { name: 'Solicitar aprovação' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(endpoint),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ruleId: 'SOD-007', subjectIdentityId: subject,
            scopeType: 'GLOBAL', reason: 'A documented risk exception.',
          }),
        }),
      );
    });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('shows server denial of approve and never declares PENDING as APPROVED', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = parseRequestPath(input);
      if (pathname === endpoint && (init?.method ?? 'GET') === 'GET') {
        return response([pending]);
      }
      if (pathname === `${endpoint}/${pending.id}/approve`) {
        return response({ error: { code: 'AUTHZ_DENIED' } }, 403);
      }
      return response({ error: { code: 'UNKNOWN' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SodExceptionsTab />);
    await screen.findByText('A documented risk exception.');
    await user.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`${endpoint}/${pending.id}/approve`),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(screen.getByText('PENDING')).toBeInTheDocument();
    expect(screen.queryByText('APPROVED')).not.toBeInTheDocument();
  });
});

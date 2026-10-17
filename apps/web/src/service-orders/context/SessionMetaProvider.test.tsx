import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';
import { SessionMetaProvider, useSessionMeta } from './SessionMetaProvider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function Probe() {
  const session = useSessionMeta();
  return (
    <div>
      <span data-testid="status">{session.status}</span>
      <span data-testid="create-client">
        {session.can('client:client:create') ? 'allowed' : 'denied'}
      </span>
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetTokenStoreForTests();
});

describe('SessionMetaProvider', () => {
  it('keeps /me grants authoritative when the service-order command catalog is unavailable', async () => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const raw =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const pathname = new URL(raw, 'http://127.0.0.1').pathname;

        if (pathname === '/api/v1/me') {
          return jsonResponse({
            usuario: { id: 'actor', nome: null, email: null, identity_id: 'actor' },
            permissoes_efetivas: ['client:client:create'],
            escopo_ativo: null,
            escopos_disponiveis: [],
          });
        }
        if (pathname === '/api/v1/service-orders/command-catalog') {
          return jsonResponse({ error: { code: 'SERVICE_UNAVAILABLE' } }, 503);
        }
        return jsonResponse({ error: { code: 'NOT_FOUND' } }, 404);
      }),
    );

    render(
      <SessionMetaProvider enabled>
        <Probe />
      </SessionMetaProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('create-client')).toHaveTextContent('allowed');
  });

  it('fails closed when /me itself is unavailable', async () => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'DENIED' } }, 403)));

    render(
      <SessionMetaProvider enabled>
        <Probe />
      </SessionMetaProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });
    expect(screen.getByTestId('create-client')).toHaveTextContent('denied');
  });
});

import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { ClientDetailPage } from '../clients/pages/ClientDetailPage';

const XSS_PAYLOAD = '<img src=x onerror="window.__cisneXss=1">';

describe('Adversarial XSS regression (UI)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
    delete (window as { __cisneXss?: number }).__cisneXss;
  });

  it('does not execute script payloads rendered from persisted client fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
        if (url.includes('/api/v1/auth/session')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              identityId: 'actor-security',
              session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
            }),
          } as Response;
        }
        if (url.includes('/api/v1/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              usuario: { id: 'actor-security', nome: null, email: null, identity_id: 'actor-security' },
              permissoes_efetivas: [
                'client:client:list',
                'client:client:read',
                'client:client:update',
                'client:client:deactivate',
                'client:client:activate',
                'client:contact:manage',
                'client:unit:manage',
                'client:hierarchy:manage',
                'client:audit:read',
              ],
              escopo_ativo: null,
              escopos_disponiveis: [{ tipo: 'GLOBAL', resource_id: null, label: 'Global' }],
            }),
          } as Response;
        }
        if (url.includes('/api/v1/clients/') && url.includes('/360')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              client: {
                id: '00000000-0000-4000-8000-000000000099',
                legalName: XSS_PAYLOAD,
                tradeName: null,
                taxId: '12345678000190',
                status: 'ACTIVE',
                rowVersion: 1,
                contacts: [],
                addresses: [],
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
              quality: { evaluated: true, isComplete: true, findings: [] },
              hierarchy: { rootId: '00000000-0000-4000-8000-000000000099', nodes: [], truncated: false, maxDepth: 8 },
            }),
          } as Response;
        }
        if (url.includes('/api/v1/clients/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: '00000000-0000-4000-8000-000000000099',
              legalName: XSS_PAYLOAD,
              tradeName: null,
              taxId: '12345678000190',
              status: 'ACTIVE',
              rowVersion: 1,
              contacts: [],
              addresses: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            }),
          } as Response;
        }
        if (url.includes('/api/v1/auth/capabilities')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ canRead: true, canUpdate: true, canDeactivate: true, canActivate: true }),
          } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }),
    );

    renderWithProviders(
      <Routes>
        <Route path="/app/clients/:clientId" element={<ClientDetailPage />} />
      </Routes>,
      {
        router: {
          initialEntries: ['/app/clients/00000000-0000-4000-8000-000000000099'],
        },
      },
    );

    expect(await screen.findByRole('heading', { name: XSS_PAYLOAD })).toBeInTheDocument();
    expect((window as { __cisneXss?: number }).__cisneXss).toBeUndefined();
    expect(document.querySelector('img[onerror]')).toBeNull();
  });
});

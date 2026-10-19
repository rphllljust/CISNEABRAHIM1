import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/context/AuthProvider';
import { SessionMetaBridge } from '../service-orders/context/SessionMetaBridge';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { useAssetCapabilities } from '../assets/hooks/useAssetCapabilities';
import { usePersonCapabilities } from '../people/hooks/usePersonCapabilities';
import { useDocumentCapabilities } from '../documents/hooks/useDocumentCapabilities';
import { useBillingCapabilities } from '../billing/hooks/useBillingCapabilities';
import { useMeasurementCapabilities } from '../service-orders/hooks/useMeasurementCapabilities';
import { useServiceOrderPlanningCapabilities } from '../service-orders/hooks/useServiceOrderPlanningCapabilities';

/**
 * MUTATION SAFETY — montar uma tela NÃO pode escrever no backend.
 *
 * DEFEITO QUE ESTE TESTE TRAVA (medido em produção, 2026-10-19):
 *
 * Cada hook `use*Capabilities` descobria permissão disparando POST/PATCH/activate/deactivate
 * contra IDs sintéticos. Abrir `/app/assets`, por exemplo, produzia em ~800ms:
 *
 *   POST /resources/physical-assets                     -> 400 ASSET_VALIDATION_FAILED
 *   GET  /resources/physical-assets/:assetId            -> 404 ASSET_NOT_FOUND
 *   POST /resources/physical-assets/:assetId/deactivate -> 404
 *   POST /resources/physical-assets/:assetId/activate   -> 404
 *   PATCH /resources/physical-assets/:assetId           -> 400
 *
 * Nenhum desses requests representa uma ação do operador. A regra do CISNE é que capability é
 * projeção dos grants publicados por `/me`, e que ação empresarial só acontece por command
 * explícito. Este teste falha se qualquer mutation voltar a ser disparada na montagem.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ProbeScreen() {
  useAssetCapabilities();
  usePersonCapabilities();
  useDocumentCapabilities();
  useBillingCapabilities();
  useMeasurementCapabilities();
  useServiceOrderPlanningCapabilities();
  return <p>sonda</p>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function createSessionFetchMock(recorded: Array<{ method: string; path: string }>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = parseRequestPath(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    recorded.push({ method, path: pathname });

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: '00000000-0000-4000-8000-000000000001',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }
    if (pathname === '/api/v1/me' && method === 'GET') {
      return jsonResponse({
        usuario: {
          id: '00000000-0000-4000-8000-000000000001',
          nome: null,
          email: null,
          identity_id: '00000000-0000-4000-8000-000000000001',
        },
        // Grants efetivos: a UI projeta DAQUI, sem sondar mutação.
        permissoes_efetivas: [
          'resources:asset:list',
          'resources:asset:create',
          'people:person:list',
          'people:person:create',
          'documents:document:list',
          'documents:document:create',
          'billing:billing-record:read',
          'billing:billing-record:prepare',
          'measurements:measurement:read',
          'measurements:measurement:create',
          'service-orders:planned-resource:read',
          'service-orders:planned-resource:plan',
        ],
        escopo_ativo: null,
        escopos_disponiveis: [{ tipo: 'GLOBAL', resource_id: null, label: 'Global' }],
      });
    }
    if (pathname === '/api/v1/service-orders/command-catalog' && method === 'GET') {
      return jsonResponse({ comandos: [] });
    }
    return jsonResponse({ error: { code: 'NOT_MOCKED', message: 'not mocked' } }, 404);
  });
}

describe('mutation safety — abrir tela não dispara escrita', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('montar as telas de capabilities não envia POST, PATCH nem DELETE', async () => {
    // sessão autenticada: o provider só hidrata `/me` quando há sessão.
    tokenStore.setTokens('test-access-token', 'test-refresh-token');

    const recorded: Array<{ method: string; path: string }> = [];
    vi.stubGlobal('fetch', createSessionFetchMock(recorded));

    render(
      <AuthProvider>
        <SessionMetaBridge>
          <MemoryRouter>
            <ProbeScreen />
          </MemoryRouter>
        </SessionMetaBridge>
      </AuthProvider>,
    );

    // Espera a hidratação da sessão concluir: é o momento em que as sondas antigas disparavam.
    await waitFor(() => {
      expect(recorded.some((request) => request.path === '/api/v1/me')).toBe(true);
    });

    const mutations = recorded.filter((request) => !SAFE_METHODS.has(request.method));

    expect(
      mutations,
      `montar a tela disparou mutação sem command explícito: ${JSON.stringify(mutations)}`,
    ).toEqual([]);
  });
});

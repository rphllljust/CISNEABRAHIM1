import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWithSession,
  renewAccessToken,
  onSessionExpired,
  resetSessionRecoveryForTests,
} from './session-recovery';
import { tokenStore } from '../storage/token-store';

/**
 * CONTINUIDADE DE SESSAO DEPOIS DA EXPIRACAO DO ACCESS TOKEN.
 *
 * Estes testes existem porque o defeito era invisivel para a suite: todos os testes de UI
 * montavam a tela com um token valido em memoria, e nenhum expirava o token no meio do fluxo.
 * O comportamento quebrado ("acesso negado" a cada 15 minutos) so aparecia com uso humano
 * prolongado, que e exatamente o que o UAT manual precisa cobrir — mas o mecanismo de
 * recuperacao em si pode e deve ser provado aqui.
 */

const ACCESS_EXPIRED = 'access.expirado';
const ACCESS_RENEWED = 'access.renovado';
const REFRESH_TOKEN = 'refresh.valido';

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('session recovery: continuidade apos expirar o access token', () => {
  beforeEach(() => {
    resetSessionRecoveryForTests();
    tokenStore.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetSessionRecoveryForTests();
    tokenStore.clear();
  });

  it('renova o token e repete a requisicao quando o access token expirou', async () => {
    tokenStore.setTokens(ACCESS_EXPIRED, REFRESH_TOKEN);

    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const auth = headers.get('Authorization');
      calls.push({ url: String(url), auth });

      // A renovacao tambem passa por `fetch`; ela nao carrega Authorization de acesso.
      if (String(url).includes('/auth/refresh')) {
        return jsonResponse(200, {
          accessToken: ACCESS_RENEWED,
          refreshToken: 'refresh.rotacionado',
        });
      }
      // Primeira tentativa usa o token vencido -> 401.
      if (auth === `Bearer ${ACCESS_EXPIRED}`) {
        return jsonResponse(401, { error: { code: 'AUTH_UNAUTHORIZED' } });
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSession('/api/v1/clients');

    expect(response.status).toBe(200);
    // Tres chamadas: a original (401), a renovacao, e a repeticao com o token novo.
    const toClients = calls.filter((call) => call.url.includes('/api/v1/clients'));
    expect(calls).toHaveLength(3);
    expect(toClients).toHaveLength(2);
    expect(toClients[0]?.auth).toBe(`Bearer ${ACCESS_EXPIRED}`);
    expect(toClients[1]?.auth).toBe(`Bearer ${ACCESS_RENEWED}`);
    expect(tokenStore.getAccessToken()).toBe(ACCESS_RENEWED);
  });

  it('nao repete a requisicao quando o token atual e aceito', async () => {
    tokenStore.setTokens(ACCESS_RENEWED, REFRESH_TOKEN);
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSession('/api/v1/clients');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('NAO renova em 403: autorizacao nao e sessao', async () => {
    tokenStore.setTokens(ACCESS_RENEWED, REFRESH_TOKEN);
    const fetchMock = vi.fn(async () => jsonResponse(403, { error: { code: 'AUTHZ_DENIED' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSession('/api/v1/clients');

    expect(response.status).toBe(403);
    // Um unico fetch: o 403 e decisao do servidor sobre grant, nao token vencido.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokenStore.getAccessToken()).toBe(ACCESS_RENEWED);
  });

  it('serializa renovacoes concorrentes para nao reutilizar o refresh token', async () => {
    tokenStore.setTokens(ACCESS_EXPIRED, REFRESH_TOKEN);

    const refreshCalls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      // /auth/refresh e a unica URL que deve aparecer mais de uma vez se nao houver mutex.
      if (String(url).includes('/auth/refresh')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { refreshToken?: string };
        refreshCalls.push(body.refreshToken ?? '');
        return jsonResponse(200, {
          accessToken: ACCESS_RENEWED,
          refreshToken: 'refresh.rotacionado',
        });
      }
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth === `Bearer ${ACCESS_EXPIRED}`) {
        return jsonResponse(401, { error: { code: 'AUTH_UNAUTHORIZED' } });
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    // Cinco chamadas simultaneas recebem 401 ao mesmo tempo: e o cenario real de uma tela que
    // dispara varios fetches (dashboard com worklist, KPIs e inbox em paralelo).
    const results = await Promise.all([
      fetchWithSession('/api/v1/a'),
      fetchWithSession('/api/v1/b'),
      fetchWithSession('/api/v1/c'),
      fetchWithSession('/api/v1/d'),
      fetchWithSession('/api/v1/e'),
    ]);

    expect(results.every((r) => r.status === 200)).toBe(true);
    // UMA renovacao apenas. Duas renovacoes com o mesmo refresh token fariam o servidor tratar
    // a segunda como reuso e revogar a sessao inteira.
    expect(refreshCalls).toHaveLength(1);
  });

  it('encerra a sessao e notifica quando nao ha refresh token', async () => {
    // Access token vencido em memoria, sem refresh: reload que perdeu o sessionStorage.
    tokenStore.setTokens(ACCESS_EXPIRED, '');
    const listener = vi.fn();
    onSessionExpired(listener);

    const fetchMock = vi.fn(async () => jsonResponse(401, { error: { code: 'AUTH_UNAUTHORIZED' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSession('/api/v1/clients');

    expect(response.status).toBe(401);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(tokenStore.getAccessToken()).toBeNull();
  });

  it('encerra a sessao quando a repeticao tambem devolve 401', async () => {
    tokenStore.setTokens(ACCESS_EXPIRED, REFRESH_TOKEN);
    const listener = vi.fn();
    onSessionExpired(listener);

    // Refresh responde com um token que o servidor tambem recusa: revogacao entre as duas
    // chamadas. Insistir seria loop; a sessao acabou.
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return jsonResponse(200, { accessToken: 'outro.que.tambem.falha', refreshToken: 'r2' });
      }
      return jsonResponse(401, { error: { code: 'AUTH_UNAUTHORIZED' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSession('/api/v1/clients');

    expect(response.status).toBe(401);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(tokenStore.getAccessToken()).toBeNull();
  });

  it('renewAccessToken devolve false quando o refresh falha, sem lancar', async () => {
    tokenStore.setTokens(ACCESS_EXPIRED, REFRESH_TOKEN);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { error: { code: 'AUTH_REFRESH_REUSED' } })),
    );

    await expect(renewAccessToken()).resolves.toBe(false);
  });
});

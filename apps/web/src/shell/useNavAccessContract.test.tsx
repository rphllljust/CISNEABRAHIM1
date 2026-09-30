import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { tokenStore } from '../auth/storage/token-store';
import { createShellFetchMock, MOCK_IDENTITY_ID } from '../test/shell-fetch-mock';
import { resetNavAccessCacheForTests } from './useNavAccess';
import { SHELL_NAV_ITEMS } from './nav-config';

/**
 * O MAPA DE ACESSO PERSISTIDO NAO PODE SOBREVIVER AO CONTRATO QUE O PRODUZIU.
 *
 * DEFEITO REAL MEDIDO NA FRONTEIRA (perfil OWNER, endpoints exatos):
 *
 *   menu   -> GET /api/v1/finance/expenses/{uuid-sintetico}  => 404  (lido como autorizacao)
 *   pagina -> GET /api/v1/finance/expenses?limit=20&offset=0 => 403 FINANCE_DENIED
 *
 * O menu mostrava Despesas e Orcamentos e a pagina negava. O contrato foi corrigido para sondar
 * a LISTA — a mesma leitura que a pagina faz. Mesmo assim o defeito continuava visivel para quem
 * ja tinha navegado: o veredito antigo estava gravado em `sessionStorage` e o reload na mesma aba
 * o reutilizava. A correcao entrava e ninguem a via.
 *
 * DUAS ARMADILHAS JA PAGAS AQUI — as duas faziam o teste passar sem provar nada:
 *
 *   1. IDENTIDADE. O mapa so e consultado quando `identityId` confere, e a identidade so existe
 *      DEPOIS do login. Semear com um id inventado faz `readPersistedNavAccess` descartar o mapa
 *      pela IDENTIDADE — a verificacao de revisao nunca e alcancada, e o teste passa ate com ela
 *      removida. Aqui o mapa e semeado com o id real do mock e a sessao e retomada por refresh
 *      token (o caminho que produz o cenario do defeito).
 *
 *   2. CORRIDA. Esperar por `status === 'authenticated'` NAO basta: o `AuthProvider` publica a
 *      identidade antes de `useNavAccess` aplicar o mapa, e a assercao roda no estado inicial.
 *      Por isso as esperas abaixo sao pelo CONTEUDO do menu, nunca pelo status de autenticacao.
 */
const STORAGE_KEY = 'cisne.navAccess.v1';
const CURRENT_CONTRACT_VERSION = 2;

/**
 * Mapa COMPLETO com tudo autorizado.
 *
 * O mapa persistido SUBSTITUI o estado inicial (nao e mesclado), entao um mapa parcial deixaria
 * a navegacao sem entradas que o proprio shell consulta.
 */
function allVisibleMap(): Record<string, boolean> {
  return Object.fromEntries(SHELL_NAV_ITEMS.map((item) => [item.id, true]));
}

/** Semeia um mapa do MESMO ator e retoma a sessao pelo refresh token. */
function mountWithPersistedMap(access: Record<string, boolean>, contractVersion?: number): void {
  sessionStorage.setItem('cisne.refreshToken', 'refresh-token');
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      identityId: MOCK_IDENTITY_ID,
      ...(contractVersion === undefined ? {} : { contractVersion }),
      access,
    }),
  );
  window.history.pushState({}, '', '/app');
  render(<App />);
}

/**
 * Espera a resolucao TERMINAR.
 *
 * `Carregando navegação…` NAO serve como sinal: ele some assim que `loading` vira `false`, e a
 * bateria de sondas ainda esta em curso (a resolucao regrava o mapa so no fim). Esperar por ele
 * media o estado inicial — outra corrida. O sinal correto e a GRAVACAO do mapa resolvido com a
 * revisao vigente, que so acontece depois de todas as sondas.
 */
async function menuResolved(): Promise<void> {
  await waitFor(
    () => {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw ?? '{}') as { contractVersion?: unknown };
      expect(parsed.contractVersion).toBe(CURRENT_CONTRACT_VERSION);
    },
    { timeout: 15000 },
  );
}

describe('mapa de acesso persistido x revisao do contrato', () => {
  beforeEach(() => {
    tokenStore.clear();
    sessionStorage.clear();
    // O cache EM MEMORIA e de modulo e sobrevive entre testes do mesmo arquivo.
    resetNavAccessCacheForTests();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  /**
   * CASO DE CONTROLE — o mapa da revisao VIGENTE e OBEDECIDO.
   *
   * Vem primeiro de proposito: sem ele, os outros casos nao provam que o descarte e seletivo —
   * um cache totalmente quebrado (que nunca le nada) faria o teste de descarte passar.
   * O mapa autoriza `fleet`, superficie que o mock NAO autoriza: se a rede fosse consultada, o
   * item sumiria.
   */
  it('CONTROLE: mapa do mesmo ator e da revisao vigente e obedecido, sem ir a rede', async () => {
    const fetchMock = createShellFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    mountWithPersistedMap(allVisibleMap(), CURRENT_CONTRACT_VERSION);

    await waitFor(
      () => {
        expect(screen.getByRole('link', { name: /^frota$/i })).toBeInTheDocument();
      },
      { timeout: 10000 },
    );

    // Obedeceu ao MAPA, e nao ao servidor: a sonda de ativos nao foi disparada.
    const calls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(calls.some((c) => c.includes('/api/v1/resources/physical-assets'))).toBe(false);
  });

  it('descarta mapa SEM revisao de contrato e resolve o menu de novo pelo servidor', async () => {
    const fetchMock = createShellFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    // Mapa all-true gravado pela regra ANTIGA (sem revisao): diria que Despesas e Orcamentos
    // estao liberados. O servidor nega as duas listas.
    mountWithPersistedMap(allVisibleMap());

    await menuResolved();

    // A PROVA: o mapa foi descartado e a sonda de ENTRADA (a LISTA) decidiu.
    await waitFor(
      () => {
        expect(screen.queryByRole('link', { name: /^despesas$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /^orçamentos$/i })).not.toBeInTheDocument();
      },
      { timeout: 10000 },
    );

    const calls = fetchMock.mock.calls.map(([input]) => String(input));
    // Consultou a LISTA — a mesma leitura que a pagina faz...
    expect(calls.some((c) => c.includes('/api/v1/finance/expenses?'))).toBe(true);
    // ...e nunca o detalhe com UUID sintetico, que era a causa do defeito.
    expect(calls.some((c) => /\/api\/v1\/finance\/expenses\/[0-9a-f-]{36}/.test(c))).toBe(false);
  });

  it('descarta mapa de revisao ANTERIOR', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());

    mountWithPersistedMap(allVisibleMap(), CURRENT_CONTRACT_VERSION - 1);

    await menuResolved();

    await waitFor(
      () => {
        expect(screen.queryByRole('link', { name: /^despesas$/i })).not.toBeInTheDocument();
      },
      { timeout: 10000 },
    );
  });

  it('regrava o mapa com a revisao de contrato vigente', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());

    mountWithPersistedMap({ ...allVisibleMap(), 'finance-expenses': false });

    await waitFor(
      () => {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw ?? '{}') as { contractVersion?: unknown };
        expect(parsed.contractVersion).toBe(CURRENT_CONTRACT_VERSION);
      },
      { timeout: 10000 },
    );
  });
});

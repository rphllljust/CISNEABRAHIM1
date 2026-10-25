import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { tokenStore } from '../../auth/storage/token-store';
import { getMeasurementWorkQueue } from './measurement-workbench-api';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DEFEITO DE PRODUÇÃO QUE ESTE TESTE TRAVA: A FILA DERRUBAVA A ESTAÇÃO INTEIRA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O browser gate em produção reprovou 12/13 com:
 *
 *   FAIL  CONSOLE sem erro crítico
 *         TypeError: Cannot read properties of undefined (reading 'map')
 *
 * A tela lia `queueData.items.length` e `items.map(...)` direto da resposta. Uma
 * resposta sem `items` — proxy que corta o corpo, versão de backend diferente do
 * frontend durante o deploy, erro parcial — quebrava a página COMPLETA, inclusive
 * as colunas que não dependem da fila.
 *
 * O conserto foi na fronteira HTTP: o React recebe um tipo que AFIRMA
 * `items: WorkQueueItem[]`, então o valor entregue precisa honrar o tipo. Estes
 * testes exercitam a resposta degenerada que causou o erro real.
 *
 * O que a normalização NÃO faz: inventar item, contagem ou valor de negócio. Ela
 * garante FORMA, nunca conteúdo.
 */
describe('getMeasurementWorkQueue — a resposta degenerada não quebra a tela', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Sessão mínima: a leitura exige token, e sem ele o cliente falha em 401
    // ANTES da normalização — o teste passaria a medir outra coisa.
    tokenStore.setTokens('test-access-token', 'test-refresh-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    tokenStore.clear();
  });

  function mockJson(body: unknown) {
    // `vi.fn` já satisfaz o contrato de `typeof fetch` para uma leitura que só
    // consome `status`, `ok` e `json`.
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('resposta SEM items devolve fila vazia em vez de undefined', async () => {
    mockJson({ context: { unitId: 'u-1', at: '2026-01-01T00:00:00.000Z' } });

    const queue = await getMeasurementWorkQueue('u-1');

    expect(Array.isArray(queue.items)).toBe(true);
    expect(queue.items).toHaveLength(0);
    // É exatamente esta chamada que quebrava com "reading 'map'".
    expect(() => queue.items.map((item) => item)).not.toThrow();
  });

  it('resposta SEM counts devolve objeto vazio', async () => {
    mockJson({ items: [] });

    const queue = await getMeasurementWorkQueue('u-1');

    expect(queue.counts).toEqual({});
  });

  it('resposta SEM freshness mantém a autoridade no SERVIDOR', async () => {
    mockJson({ items: [] });

    const queue = await getMeasurementWorkQueue('u-1');

    // A forma é garantida aqui; a AFIRMAÇÃO de frescura continua do servidor.
    expect(queue.freshness.authority).toBe('SERVER');
    expect(typeof queue.freshness.readAt).toBe('string');
  });

  it('items que não é lista é tratado como fila vazia', async () => {
    mockJson({ items: 'nao-e-lista', counts: {} });

    const queue = await getMeasurementWorkQueue('u-1');

    expect(queue.items).toHaveLength(0);
  });

  it('resposta íntegra é preservada sem alteração', async () => {
    const item = {
      serviceOrderId: 'so-1',
      orderNumber: 'OS-1',
      stage: 'MEASURED',
      nextAction: 'REVIEW',
    };
    mockJson({
      context: { unitId: 'u-1', at: '2026-01-01T00:00:00.000Z' },
      counts: { total: 1 },
      items: [item],
      freshness: { readAt: '2026-01-01T00:00:00.000Z', authority: 'SERVER' },
    });

    const queue = await getMeasurementWorkQueue('u-1');

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].serviceOrderId).toBe('so-1');
    expect(queue.counts).toEqual({ total: 1 });
    expect(queue.freshness.readAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

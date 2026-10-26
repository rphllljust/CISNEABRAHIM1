import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { tokenStore } from '../../auth/storage/token-store';
import {
  getMeasurementWorkQueue,
  getMeasurementWorkbench,
  recordCustomerAcceptance,
} from './measurement-workbench-api';

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
    // `noUncheckedIndexedAccess` exige o estreitamento: indexar sem verificar
    // afirmaria ao compilador algo que ele não pode garantir.
    const [first] = queue.items;
    expect(first?.serviceOrderId).toBe('so-1');
    expect(queue.counts).toEqual({ total: 1 });
    expect(queue.freshness.readAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * O WORKBENCH TEM A MESMA EXPOSIÇÃO — E UMA SUPERFÍCIE MAIOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `MeasurementDecisionContext` percorre treze coleções com `.map`. Normalizar
 * apenas a fila deixaria a tela PRINCIPAL da capability exposta ao mesmo
 * `TypeError` que derrubou produção.
 *
 * Os dois caminhos são cobertos: a leitura (GET) e o retorno do comando de aceite
 * (POST), porque ambos entregam o read model ao React.
 */
describe('getMeasurementWorkbench — read model degenerado não quebra a estação', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    tokenStore.setTokens('test-access-token', 'test-refresh-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    tokenStore.clear();
  });

  function mockJson(body: unknown) {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('workbench SEM coleções devolve listas vazias, não undefined', async () => {
    mockJson({ identity: { serviceOrderId: 'so-1', orderNumber: 'OS-1' } });

    const workbench = await getMeasurementWorkbench('so-1');

    // Cada uma destas é percorrida com `.map` pela tela.
    expect(workbench.variances).toEqual([]);
    expect(workbench.adjustments).toEqual([]);
    expect(workbench.items).toEqual([]);
    expect(workbench.evidence).toEqual([]);
    expect(workbench.situations).toEqual([]);
    expect(workbench.relationships).toEqual([]);
    expect(workbench.documentFlow).toEqual([]);
    expect(workbench.timeline).toEqual([]);
    expect(workbench.availableCommands).toEqual([]);
    expect(() => workbench.availableCommands.map((command) => command)).not.toThrow();
  });

  it('workbench sem próxima ação devolve null — estado real do domínio', async () => {
    mockJson({ items: [] });

    const workbench = await getMeasurementWorkbench('so-1');

    // "Sem próxima ação" é um estado de negócio; objeto vazio seria invenção.
    expect(workbench.nextAction).toBeNull();
  });

  it('workbench preserva autoridade SERVER na frescura', async () => {
    mockJson({ items: [] });

    const workbench = await getMeasurementWorkbench('so-1');

    expect(workbench.freshness.authority).toBe('SERVER');
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * AS COLEÇÕES ANINHADAS DERRUBARAM PRODUÇÃO DEPOIS DA CORREÇÃO ANTERIOR
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * Defeito medido (release 40248272786, main 6aea8a2d), DEPOIS que a unidade
   * passou a ser resolvida e a estação efetivamente carregou a fila:
   *
   *   url=/app/measurement?unitId=UN-PROD-001
   *   TypeError: Cannot read properties of undefined (reading 'map')
   *
   * A normalização anterior cobria só as coleções de TOPO. A tela percorre também
   * `basis.lines`, `acceptance.history`, `decision.dimensions`,
   * `decision.blockingReasons`, `command.reasonLabels` e `processContext.milestones`.
   *
   * Estas dependem do objeto-PAI existir: se o backend omitir `decision` inteiro,
   * `decision.dimensions` lança ANTES de qualquer `?? []`. Por isso o pai também
   * precisa existir — normalizar só o array não basta.
   */
  it('coleções aninhadas não quebram o render quando o pai está ausente', async () => {
    mockJson({ identity: { serviceOrderId: 'so-1' } });

    const workbench = await getMeasurementWorkbench('so-1');

    // Cada uma destas é percorrida com `.map` pela tela.
    expect(workbench.measurementBasis.lines).toEqual([]);
    expect(workbench.acceptance.history).toEqual([]);
    expect(workbench.billingEligibility.dimensions).toEqual([]);
    expect(workbench.billingEligibility.blockingReasons).toEqual([]);
    expect(workbench.processContext.milestones).toEqual([]);
    expect(() => workbench.measurementBasis.lines.map((line) => line)).not.toThrow();
    expect(() => workbench.billingEligibility.blockingReasons.map((r) => r)).not.toThrow();
  });

  it('reasonLabels de cada comando é sempre lista', async () => {
    mockJson({ availableCommands: [{ code: 'APPROVE', enabled: false }] });

    const workbench = await getMeasurementWorkbench('so-1');

    const [command] = workbench.availableCommands;
    expect(command?.reasonLabels).toEqual([]);
    expect(() => (command?.reasonLabels ?? []).map((label) => label)).not.toThrow();
  });

  it('estrutura aninhada íntegra é preservada', async () => {
    mockJson({
      measurementBasis: { lines: [{ lineKey: 'DAY', unitCode: 'DAY' }] },
      acceptance: { history: [{ id: 'a-1' }] },
      billingEligibility: { dimensions: [{ code: 'D1' }], blockingReasons: [{ code: 'B1' }] },
      processContext: { milestones: [{ stage: 'MEASURED' }] },
      availableCommands: [{ code: 'APPROVE', reasonLabels: ['pendente'] }],
    });

    const workbench = await getMeasurementWorkbench('so-1');

    expect(workbench.measurementBasis.lines).toHaveLength(1);
    expect(workbench.acceptance.history).toHaveLength(1);
    expect(workbench.billingEligibility.dimensions).toHaveLength(1);
    expect(workbench.billingEligibility.blockingReasons).toHaveLength(1);
    expect(workbench.processContext.milestones).toHaveLength(1);
    const [command] = workbench.availableCommands;
    expect(command?.reasonLabels).toEqual(['pendente']);
  });

  it('workbench íntegro não é alterado', async () => {
    mockJson({
      identity: { serviceOrderId: 'so-1', orderNumber: 'OS-1' },
      items: [{ lineKey: 'DAY', unitCode: 'DAY' }],
      availableCommands: [{ code: 'APPROVE', enabled: true }],
      nextAction: { code: 'APPROVE', label: 'Aprovar' },
      freshness: { readAt: '2026-01-01T00:00:00.000Z', authority: 'SERVER' },
    });

    const workbench = await getMeasurementWorkbench('so-1');

    expect(workbench.items).toHaveLength(1);
    expect(workbench.availableCommands).toHaveLength(1);
    expect(workbench.nextAction?.code).toBe('APPROVE');
    expect(workbench.freshness.readAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('retorno do ACEITE também é normalizado — o comando entrega o read model', async () => {
    mockJson({ identity: { serviceOrderId: 'so-1' } });

    const workbench = await recordCustomerAcceptance('so-1', 'm-1', {
      expectedVersion: 1,
      idempotencyKey: 'k-1',
      result: 'ACCEPTED',
      observation: 'Recebido conforme contrato.',
    });

    expect(workbench.availableCommands).toEqual([]);
    expect(workbench.items).toEqual([]);
    expect(workbench.nextAction).toBeNull();
  });
});

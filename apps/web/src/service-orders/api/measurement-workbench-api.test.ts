import * as ts from 'typescript';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { tokenStore } from '../../auth/storage/token-store';
import {
  getMeasurementWorkQueue,
  getMeasurementWorkbench,
  recordCustomerAcceptance,
  WORKBENCH_COLLECTION_PATHS,
  REVENUE_LEAKAGE_COLLECTION_PATHS,
} from './measurement-workbench-api';

function collectArrayPaths(typesSource: string, rootTypeName: string): string[] {
  const sourceFile = ts.createSourceFile(
    'measurement-workbench.types.ts',
    typesSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const declarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  sourceFile.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      declarations.set(node.name.text, node);
    }
  });

  const paths = new Set<string>();

  function visitMembers(
    members: ts.NodeArray<ts.TypeElement>,
    prefix: readonly string[],
    stack: ReadonlySet<string>,
  ): void {
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
      const name = member.name.getText(sourceFile).replace(/^['\"]|['\"]$/g, '');
      visitType(member.type, [...prefix, name], stack);
    }
  }

  function visitNamed(
    name: string,
    prefix: readonly string[],
    stack: ReadonlySet<string>,
  ): void {
    if (stack.has(name)) return;
    const declaration = declarations.get(name);
    if (!declaration) return;
    const nextStack = new Set(stack);
    nextStack.add(name);
    if (ts.isInterfaceDeclaration(declaration)) {
      visitMembers(declaration.members, prefix, nextStack);
      return;
    }
    visitType(declaration.type, prefix, nextStack);
  }

  function visitArrayElement(
    elementType: ts.TypeNode,
    prefix: readonly string[],
    stack: ReadonlySet<string>,
  ): void {
    if (prefix.length === 0) return;
    paths.add(prefix.join('.'));
    const last = prefix[prefix.length - 1];
    if (!last) return;
    const elementPrefix = [...prefix.slice(0, -1), last + '[]'];
    visitType(elementType, elementPrefix, stack);
  }

  function visitType(
    type: ts.TypeNode,
    prefix: readonly string[],
    stack: ReadonlySet<string>,
  ): void {
    if (ts.isArrayTypeNode(type)) {
      visitArrayElement(type.elementType, prefix, stack);
      return;
    }
    if (ts.isTypeReferenceNode(type)) {
      const typeName = type.typeName.getText(sourceFile);
      if ((typeName === 'Array' || typeName === 'ReadonlyArray') && type.typeArguments?.[0]) {
        visitArrayElement(type.typeArguments[0], prefix, stack);
        return;
      }
      visitNamed(typeName, prefix, stack);
      return;
    }
    if (ts.isTypeLiteralNode(type)) {
      visitMembers(type.members, prefix, stack);
      return;
    }
    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
      for (const child of type.types) visitType(child, prefix, stack);
      return;
    }
    if (ts.isParenthesizedTypeNode(type) || ts.isTypeOperatorNode(type)) {
      visitType(type.type, prefix, stack);
    }
  }

  visitNamed(rootTypeName, [], new Set());
  return [...paths].sort();
}

function configuredPaths(paths: ReadonlyArray<readonly string[]>): string[] {
  return paths.map((path) => path.join('.')).sort();
}
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

  /**
   * FITNESS TEST DE CONTRATO — CAMINHO COMPLETO, NÃO NOME DE CAMPO.
   *
   * O teste anterior tratava measurementBasis.lines e quantities.lines como
   * o mesmo campo 'lines'. O AST parte dos read models raiz e preserva o
   * caminho, inclusive dentro de elementos de listas.
   */
  it('cobre por caminho completo TODAS as coleções do Workbench e Revenue Leakage', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');

    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const typesSource = fs.readFileSync(
      path.join(here, '..', 'types', 'measurement-workbench.types.ts'),
      'utf8',
    );

    expect(configuredPaths(WORKBENCH_COLLECTION_PATHS)).toEqual(
      collectArrayPaths(typesSource, 'MeasurementWorkbenchReadModel'),
    );
    expect(configuredPaths(REVENUE_LEAKAGE_COLLECTION_PATHS)).toEqual(
      collectArrayPaths(typesSource, 'RevenueLeakageReadModel'),
    );
  });
  it('normalização estrutural não inventa item nem escalar', async () => {
    // Só `identity` — nenhuma coleção, nenhum escalar de negócio.
    mockJson({ identity: { serviceOrderId: 'so-1' } });

    const workbench = await getMeasurementWorkbench('so-1');

    // Listas viram [] (ausência de itens), nunca um item falso.
    expect(workbench.variances).toEqual([]);
    expect(workbench.items).toEqual([]);
    // Escalar ausente continua ausente: nada de 0/'false' inventado.
    expect(workbench.identity.rowVersion ?? null).toBeNull();
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

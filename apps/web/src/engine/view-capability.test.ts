import { describe, expect, it } from 'vitest';
import { functionalViewTypes, nonFunctionalViews } from './view-capability';
import type { MetaEntitySchema, MetaField, MetaView } from './types';

/**
 * PROVA DA PODA DE VIEWS.
 *
 * O caso que motivou este arquivo é REAL e está no metadata store: `service-orders` declara
 * uma view `tree` com `{"parentField":"unit_id"}`. A engine sabe desenhar árvore, então a aba
 * era oferecida — e o que aparecia era uma floresta de um nível, porque `unit_id` aponta para
 * a UNIDADE, não para outra ordem de serviço. Cada linha virava raiz.
 *
 * Estes testes fixam as duas metades da regra: recusar eixo inexistente, e NÃO recusar view
 * por ausência de dado.
 */

function field(name: string): MetaField {
  return {
    name,
    label: name,
    type: 'text',
    required: false,
    readOnly: false,
    permLevel: 0,
    options: null,
    fieldOrder: 0,
    inForm: true,
    inList: false,
    listOrder: 0,
    inFilter: false,
    inSearch: false,
  };
}

function view(viewType: string, layout: Record<string, unknown>): MetaView {
  return { viewType, label: viewType, layout, isDefault: false };
}

function schema(views: MetaView[], fields: MetaField[] = []): MetaEntitySchema {
  return {
    name: 'service-orders',
    label: 'Ordens de serviço',
    description: null,
    dataSchema: 'so',
    dataTable: 'service_orders',
    labelField: 'order_number',
    fields,
    views,
    workflow: null,
    permissions: [],
    allowedPermLevels: [],
  };
}

describe('view-capability — tipo sem renderizador', () => {
  it('recusa tipo que a engine não desenha, nomeando o tipo', () => {
    const verdicts = nonFunctionalViews(schema([view('calender', {})]));
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.viewType).toBe('calender');
    expect(verdicts[0]!.reason).toContain('renderizador');
    // Não há eixo faltante: o problema é o tipo, não um campo.
    expect(verdicts[0]!.missingAxis).toBeNull();
  });
});

describe('view-capability — árvore', () => {
  it('RECUSA a view tree real de service-orders: unit_id aponta para fora da entidade', () => {
    /*
     * Reproduz a declaração que existe em `meta.views` (migration 0088). O campo `unit_id`
     * está registrado no metadado, mas é FK para unidade — não eixo de hierarquia da OS.
     */
    const target = schema(
      [view('tree', { parentField: 'unit_id', labelField: 'order_number' })],
      [field('unit_id'), field('order_number')],
    );

    const refused = nonFunctionalViews(target);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.viewType).toBe('tree');
    expect(refused[0]!.missingAxis).toBe('unit_id');
    expect(refused[0]!.reason).toContain('um nível só');

    // E o que sobra para o switcher NÃO contém 'tree'.
    expect(functionalViewTypes(target)).not.toContain('tree');
  });

  it('ACEITA árvore sobre parent_id — nome que é auto-referente por contrato', () => {
    const target = schema(
      [view('tree', { parentField: 'parent_id', labelField: 'order_number' })],
      [field('parent_id'), field('order_number')],
    );
    expect(functionalViewTypes(target)).toContain('tree');
    expect(nonFunctionalViews(target)).toHaveLength(0);
  });

  it('RECUSA árvore cujo parentField o metadado nem registra', () => {
    const target = schema([view('tree', { parentField: 'parent_order_id' })], [field('status')]);
    const refused = nonFunctionalViews(target);
    expect(refused[0]!.missingAxis).toBe('parent_order_id');
    expect(refused[0]!.reason).toContain('não existe no payload');
  });

  it('RECUSA árvore sem parentField declarado', () => {
    const target = schema([view('tree', {})], [field('status')]);
    expect(nonFunctionalViews(target)[0]!.reason).toContain('parentField');
  });
});

describe('view-capability — gráfico e dinâmica', () => {
  it('ACEITA a view graph real de service-orders (status existe no payload)', () => {
    const target = schema(
      [view('graph', { categoryField: 'status', chartType: 'bar', aggregateOp: 'count' })],
      [field('status')],
    );
    expect(functionalViewTypes(target)).toContain('graph');
  });

  it('ACEITA a view pivot real de service-orders', () => {
    const target = schema(
      [view('pivot', { groupBy: ['status'], aggregateOp: 'count' })],
      [field('status')],
    );
    expect(functionalViewTypes(target)).toContain('pivot');
  });

  it('RECUSA gráfico cujo categoryField não existe no payload', () => {
    const target = schema([view('graph', { categoryField: 'unidade_fantasma' })], [field('status')]);
    const refused = nonFunctionalViews(target);
    expect(refused[0]!.missingAxis).toBe('unidade_fantasma');
    expect(refused[0]!.reason).toContain('não existe no payload');
  });

  it('RECUSA dinâmica sem groupBy', () => {
    const target = schema([view('pivot', { aggregateOp: 'count' })], [field('status')]);
    expect(nonFunctionalViews(target)[0]!.missingAxis).toBe('groupBy');
  });
});

describe('view-capability — ausência de dado NÃO é motivo de recusa', () => {
  it('mantém as views funcionais quando a entidade não tem nenhuma linha', () => {
    /*
     * O critério é EIXO, não VOLUME. Uma carteira vazia é um estado legítimo e a tela já sabe
     * dizê-lo; apagar abas por falta de dado esconderia capacidade real do operador e faria a
     * interface mudar de forma conforme o volume — que é o oposto de previsível.
     */
    const target = schema(
      [
        view('list', { columns: ['order_number', 'status'] }),
        view('graph', { categoryField: 'status', chartType: 'bar', aggregateOp: 'count' }),
      ],
      [field('status'), field('order_number')],
    );
    expect(nonFunctionalViews(target)).toHaveLength(0);
    expect(functionalViewTypes(target)).toEqual(['list', 'graph']);
  });
});

describe('view-capability — ordem das abas', () => {
  it('devolve os tipos na ordem da engine, não na ordem do store', () => {
    /*
     * Abas que dançam porque o administrador reordenou linhas no banco seriam uma mudança de
     * interface sem mudança de capacidade. A ordem de `RENDERABLE_VIEW_TYPES` é a estável.
     */
    const target = schema(
      [
        view('graph', { categoryField: 'status' }),
        view('kanban', { groupBy: 'status' }),
        view('list', { columns: ['status'] }),
      ],
      [field('status')],
    );
    expect(functionalViewTypes(target)).toEqual(['list', 'kanban', 'graph']);
  });
});

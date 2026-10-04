import { describe, expect, it } from 'vitest';
import { expenseEngineRows, expensesListSchema } from './expense-engine-rows';
import type { ExpenseSummary } from '../api/finance-api';
import type { MetaEntitySchema, MetaField } from '../../engine';

/**
 * PARIDADE DA LISTA DE DESPESAS.
 *
 * Cada `it` corresponde a uma capacidade visível da versão artesanal
 * (`git show HEAD:apps/web/src/finance/pages/ExpensesListPage.tsx`). O que este arquivo protege:
 * a projeção de colunas NÃO pode perder "Centro de custo" nem inventar coluna que o metadado não
 * possui, e nenhum valor do servidor pode ser reinterpretado.
 */

function field(name: string, inList: boolean, listOrder: number, type: MetaField['type'] = 'text'): MetaField {
  return {
    name,
    label: name,
    type,
    required: false,
    readOnly: true,
    permLevel: 0,
    options: null,
    fieldOrder: listOrder,
    inForm: true,
    inList,
    listOrder,
    inFilter: false,
    inSearch: false,
  };
}

/** Metadado REAL de `expenses` como a migration 0086 o declara (campos relevantes). */
function schema(): MetaEntitySchema {
  return {
    name: 'expenses',
    label: 'Despesa',
    description: null,
    dataSchema: 'fin',
    dataTable: 'expenses',
    labelField: 'description',
    fields: [
      field('description', true, 1),
      field('status', true, 2),
      field('total_amount', true, 3, 'currency'),
      field('currency_code', true, 4),
      // `due_date` é `date` no metadado real — o tipo importa para o leitor de aging.
      field('due_date', true, 5, 'date'),
      // `cost_center_code` existe no metadado mas está FORA da view list.
      field('cost_center_code', false, 7),
      field('reimbursable', true, 6, 'bool'),
      field('unit_id', true, 7),
      field('created_at', true, 8, 'datetime'),
    ],
    views: [
      {
        viewType: 'list',
        label: 'Lista de despesas',
        layout: {
          columns: ['description', 'status', 'total_amount', 'due_date', 'reimbursable', 'created_at'],
        },
        isDefault: true,
      },
    ],
    workflow: null,
    permissions: [],
    allowedPermLevels: [0],
  };
}

function expense(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
  return {
    id: 'exp-1',
    unitId: 'unit-1',
    description: 'Combustível da frota',
    costCenterCode: 'CC-OPER',
    totalAmount: '480.5000',
    currencyCode: 'BRL',
    dueDate: '2026-03-15',
    status: 'SUBMITTED',
    version: 4,
    createdAt: '2026-02-20T12:00:00.000Z',
    ...overrides,
  };
}

/** Resolve as colunas como `useColumns` do DynamicList resolve: por `layout.columns`. */
function columnNames(projected: MetaEntitySchema): string[] {
  const view = projected.views.find((item) => item.viewType === 'list');
  const declared = view?.layout.columns ?? [];
  const byName = new Map(projected.fields.map((item) => [item.name, item]));
  return declared.filter((name) => {
    const resolved = byName.get(name);
    return resolved !== undefined && resolved.inList;
  });
}

describe('paridade de despesas — colunas do original', () => {
  it('exibe as CINCO colunas, na ordem de leitura do operador', () => {
    const projected = expensesListSchema(schema());
    expect(projected).not.toBeNull();
    /*
     * A ordem é de LEITURA, não a do JSX antigo: o que é (descrição + centro de custo), quanto
     * custa, quando vence, em que estado está. `total_amount` subiu para antes de `due_date`
     * porque o valor é o número que o operador procura primeiro. As CINCO colunas continuam as
     * mesmas — nenhuma perdida, nenhuma inventada.
     */
    expect(columnNames(projected!)).toEqual([
      'description',
      'cost_center_code',
      'total_amount',
      'due_date',
      'status',
    ]);
  });

  it('preserva "Centro de custo" — o campo existe no metadado e é reabilitado na view', () => {
    const projected = expensesListSchema(schema());
    const cost = projected!.fields.find((item) => item.name === 'cost_center_code');
    // A projeção liga `inList` no campo; sem isso `useColumns` o descartaria.
    expect(cost?.inList).toBe(true);
  });

  it('NÃO acrescenta coluna que o original não exibia (reimbursable, created_at)', () => {
    const projected = expensesListSchema(schema());
    const names = columnNames(projected!);
    expect(names).not.toContain('reimbursable');
    expect(names).not.toContain('created_at');
    expect(names).toHaveLength(5);
  });

  /**
   * AGING — a coluna que o `DynamicList` ADICIONARIA sozinho.
   *
   * O leitor real (`resolveAgingField`, privado ao DynamicList) procura `created_at` e, falhando,
   * aceita QUALQUER campo `datetime` ou `date`. A versão anterior deste teste reimplementava essa
   * busca e passava — enquanto o E2E mostrava a coluna "Aging" na tela, porque `due_date` (tipo
   * `date`) satisfazia a segunda etapa. Reimplementar o leitor NÃO prova o leitor.
   *
   * Abaixo, a MESMA expressão do leitor real é aplicada ao schema projetado. O fixture tem
   * `due_date` do tipo `date`, como o metadado de verdade, então a asserção é falsificável.
   */
  it('não deixa o DynamicList derivar a coluna de aging (as DUAS etapas do leitor são barradas)', () => {
    const projected = expensesListSchema(schema());

    // Expressão idêntica à de `resolveAgingField` (DynamicList.tsx), sem `agingField` explícito.
    const aging =
      projected!.fields.find((item) => item.name === 'created_at') ??
      projected!.fields.find((item) => item.type === 'datetime' || item.type === 'date') ??
      null;

    expect(aging).toBeNull();
  });

  it('preserva due_date como COLUNA — neutralizar o aging não pode custar o Vencimento', () => {
    const projected = expensesListSchema(schema());
    const dueDate = projected!.fields.find((item) => item.name === 'due_date');
    // O campo continua existindo e continua elegível à view...
    expect(dueDate).toBeDefined();
    expect(dueDate!.inList).toBe(true);
    expect(columnNames(projected!)).toContain('due_date');
    // ...mas não é mais do tipo temporal, que é o que o leitor de aging consulta.
    expect(dueDate!.type).not.toBe('date');
    expect(dueDate!.type).not.toBe('datetime');
  });

  it('não muta o schema recebido — a projeção é local à tela', () => {
    const original = schema();
    const before = original.views[0]!.layout.columns;
    expensesListSchema(original);
    expect(original.views[0]!.layout.columns).toBe(before);
    expect(original.fields.find((item) => item.name === 'cost_center_code')?.inList).toBe(false);
  });

  it('devolve null quando o metadado ainda não chegou', () => {
    expect(expensesListSchema(null)).toBeNull();
  });
});

describe('paridade de despesas — valores do servidor', () => {
  it('transporta description e cost_center_code (a linha identifica a despesa)', () => {
    const [row] = expenseEngineRows([expense()]);
    expect(row!['description']).toBe('Combustível da frota');
    expect(row!['cost_center_code']).toBe('CC-OPER');
  });

  it('transporta total_amount e currency_code SEM recálculo', () => {
    const [row] = expenseEngineRows([expense({ totalAmount: '1234.5678', currencyCode: 'USD' })]);
    expect(row!['total_amount']).toBe('1234.5678');
    expect(row!['currency_code']).toBe('USD');
  });

  it('transporta due_date literal — a formatação é da célula, não do adaptador', () => {
    const [row] = expenseEngineRows([expense({ dueDate: '2026-03-15' })]);
    expect(row!['due_date']).toBe('2026-03-15');
  });

  it('transporta status literal para o badge resolver pelo mapa do domínio', () => {
    const [row] = expenseEngineRows([expense({ status: 'REJECTED' })]);
    expect(row!['status']).toBe('REJECTED');
  });

  it('preserva a identidade da linha para navegação e drilldown', () => {
    const [row] = expenseEngineRows([expense({ id: 'exp-xyz' })]);
    expect(row!['id']).toBe('exp-xyz');
  });

  it('mantém uma linha por despesa, na ordem do servidor', () => {
    const rows = expenseEngineRows([
      expense({ id: 'a', description: 'Primeira' }),
      expense({ id: 'b', description: 'Segunda' }),
    ]);
    expect(rows.map((row) => row['id'])).toEqual(['a', 'b']);
  });
});

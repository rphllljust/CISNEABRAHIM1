import { describe, expect, it } from 'vitest';
import { buildBudgetAdvancedClause, parseBudgetAdvancedFilter } from './budget-list-sql';

/**
 * FILTRO COMPOSTO DE ORÇAMENTOS.
 *
 * Aqui `status` ENTRA no allow-list, e a diferença em relação às filas de títulos é de DOMÍNIO:
 * `fin.budgets` tem COLUNA de situação. Estes testes travam essa diferença e as duas garantias de
 * segurança: valor SEMPRE parametrizado e campo SEMPRE por allow-list.
 */

describe('parseBudgetAdvancedFilter', () => {
  it('aceita a forma textual que viaja na URL', () => {
    const shape = {
      connector: 'AND',
      groups: [{ conditions: [{ field: 'name', operator: 'contains', value: 'Operacional' }] }],
    };
    expect(parseBudgetAdvancedFilter(JSON.stringify(shape))?.groups).toHaveLength(1);
  });

  it('ACEITA situação — a entidade tem coluna de status', () => {
    const parsed = parseBudgetAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'status', operator: 'eq', value: 'ACTIVE' }] }],
    });
    expect(parsed?.groups[0]?.conditions[0]).toEqual({
      field: 'status',
      operator: 'eq',
      value: 'ACTIVE',
    });
  });

  it('recusa situação fora do vocabulário REAL do domínio', () => {
    // Só ACTIVE/INACTIVE existem em `fin.budget_status`. Um valor inventado viraria erro de cast em
    // vez de zero linhas, e o operador leria "lista vazia" como resultado de um filtro válido.
    expect(() =>
      parseBudgetAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'status', operator: 'eq', value: 'APPROVED' }] }],
      }),
    ).toThrow();
  });

  it('recusa campo fora do allow-list em vez de ignorá-lo', () => {
    expect(() =>
      parseBudgetAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'unit_id', operator: 'eq', value: 'u-1' }] }],
      }),
    ).toThrow();
  });

  it('recusa operador que a família do campo não admite', () => {
    // `contains` sobre enum exigiria inventar semântica sobre o domínio.
    expect(() =>
      parseBudgetAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'status', operator: 'contains', value: 'ACT' }] }],
      }),
    ).toThrow();
  });

  it('recusa JSON malformado e data que não é data', () => {
    expect(() => parseBudgetAdvancedFilter('{oops')).toThrow();
    expect(() =>
      parseBudgetAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'createdAt', operator: 'after', value: 'ontem' }] }],
      }),
    ).toThrow();
  });

  it('trata ausência como "sem recorte", não como erro', () => {
    expect(parseBudgetAdvancedFilter(undefined)).toBeUndefined();
    expect(parseBudgetAdvancedFilter({ connector: 'OR', groups: [] })).toBeUndefined();
  });
});

describe('buildBudgetAdvancedClause', () => {
  it('usa o cast do ENUM do banco para situação', () => {
    const filter = parseBudgetAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'status', operator: 'eq', value: 'ACTIVE' }] }],
    })!;
    const built = buildBudgetAdvancedClause(filter, 2)!;

    // Sem o cast, o Postgres compararia enum com texto e o erro seria de TIPO, não zero linhas.
    expect(built.clause).toBe('((status = $2::fin.budget_status))');
    expect(built.params).toEqual(['ACTIVE']);
  });

  it('inverte o operador em `neq` sobre situação', () => {
    const filter = parseBudgetAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'status', operator: 'neq', value: 'INACTIVE' }] }],
    })!;
    const built = buildBudgetAdvancedClause(filter, 1)!;

    expect(built.clause).toContain('status <> $1::fin.budget_status');
  });

  it('parametriza o valor textual e nunca o interpola', () => {
    const filter = parseBudgetAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'code', operator: 'contains', value: 'ORC' }] }],
    })!;
    const built = buildBudgetAdvancedClause(filter, 3)!;

    expect(built.clause).toBe('((code ILIKE $3))');
    expect(built.params).toEqual(['%ORC%']);
    expect(built.clause).not.toContain('ORC');
  });

  it('liga os grupos pelo conector declarado', () => {
    const filter = parseBudgetAdvancedFilter({
      connector: 'OR',
      groups: [
        { conditions: [{ field: 'currencyCode', operator: 'eq', value: 'BRL' }] },
        { conditions: [{ field: 'name', operator: 'contains', value: 'Obra' }] },
      ],
    })!;
    const built = buildBudgetAdvancedClause(filter, 1)!;

    expect(built.clause).toBe('((currency_code = $1) OR (name ILIKE $2))');
    expect(built.params).toEqual(['BRL', '%Obra%']);
  });

  it('mantém NULL visível em `neq` textual — ausência não é igualdade', () => {
    const filter = parseBudgetAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'currencyCode', operator: 'neq', value: 'BRL' }] }],
    })!;
    const built = buildBudgetAdvancedClause(filter, 1)!;

    expect(built.clause).toBe('(((currency_code IS NULL OR currency_code <> $1)))');
  });

  it('escapa curinga do LIKE', () => {
    const filter = parseBudgetAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'name', operator: 'contains', value: '50%' }] }],
    })!;
    const built = buildBudgetAdvancedClause(filter, 1)!;

    expect(built.params).toEqual(['%50\\%%']);
  });

  it('devolve null quando não sobra condição alguma', () => {
    expect(
      buildBudgetAdvancedClause({ connector: 'AND', groups: [{ conditions: [] }] }, 1),
    ).toBeNull();
  });
});

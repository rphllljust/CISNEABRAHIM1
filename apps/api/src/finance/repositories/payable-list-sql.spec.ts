import { describe, expect, it } from 'vitest';
import { buildPayableAdvancedClause, parsePayableAdvancedFilter } from './payable-list-sql';

/**
 * FILTRO COMPOSTO DE CONTAS A PAGAR.
 *
 * Mesmo defeito corrigido em recebíveis: a worklist montava o construtor AND/OR, mas a árvore era
 * aplicada SÓ no navegador sobre a página carregada. Estes testes cobrem o contrato server-side e,
 * principalmente, as duas garantias de segurança: valor SEMPRE parametrizado e campo SEMPRE por
 * allow-list.
 */

describe('parsePayableAdvancedFilter', () => {
  it('aceita a forma textual que viaja na URL', () => {
    const shape = {
      connector: 'AND',
      groups: [{ conditions: [{ field: 'originReference', operator: 'contains', value: 'OC' }] }],
    };
    expect(parsePayableAdvancedFilter(JSON.stringify(shape))?.groups).toHaveLength(1);
  });

  it('aceita os campos ESPECÍFICOS de pagáveis', () => {
    // `originReference` e `costCenterCode` não existem em recebíveis: é o que diferencia as filas, e
    // um allow-list copiado da outra entidade esconderia justamente esta capacidade.
    for (const field of ['originReference', 'costCenterCode']) {
      const parsed = parsePayableAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field, operator: 'eq', value: 'X' }] }],
      });
      expect(parsed?.groups[0]?.conditions[0]?.field).toBe(field);
    }
  });

  it('recusa campo fora do allow-list em vez de ignorá-lo', () => {
    expect(() =>
      parsePayableAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'principal', operator: 'eq', value: '10' }] }],
      }),
    ).toThrow();
  });

  it('recusa operador que a família do campo não admite', () => {
    expect(() =>
      parsePayableAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'dueDate', operator: 'contains', value: '2026' }] }],
      }),
    ).toThrow();
  });

  it('recusa JSON malformado e data que não é data', () => {
    expect(() => parsePayableAdvancedFilter('{oops')).toThrow();
    expect(() =>
      parsePayableAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'dueDate', operator: 'after', value: 'ontem' }] }],
      }),
    ).toThrow();
  });

  it('trata ausência como "sem recorte", não como erro', () => {
    expect(parsePayableAdvancedFilter(undefined)).toBeUndefined();
    expect(parsePayableAdvancedFilter({ connector: 'OR', groups: [] })).toBeUndefined();
  });

  it('NÃO aceita situação: o título não tem coluna de status', () => {
    // `lifecycle` é um recorte DIFERENTE do que o operador lê como situação (derivada de lifecycle
    // + pagamentos + vencimento). O recorte por situação vive no filtro simples.
    for (const field of ['status', 'lifecycle']) {
      expect(() =>
        parsePayableAdvancedFilter({
          connector: 'AND',
          groups: [{ conditions: [{ field, operator: 'eq', value: 'OPEN' }] }],
        }),
      ).toThrow();
    }
  });
});

describe('buildPayableAdvancedClause', () => {
  it('parametriza o valor e usa o cast da coluna REAL', () => {
    const filter = parsePayableAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'dueDate', operator: 'after', value: '2026-01-31' }] }],
    })!;
    const built = buildPayableAdvancedClause(filter, 3)!;

    expect(built.clause).toBe('((r.due_date > $3::date))');
    expect(built.params).toEqual(['2026-01-31']);
    // O valor NUNCA aparece no SQL: comparação é sempre por parâmetro ligado.
    expect(built.clause).not.toContain('2026-01-31');
  });

  it('liga os grupos pelo conector declarado', () => {
    const filter = parsePayableAdvancedFilter({
      connector: 'OR',
      groups: [
        { conditions: [{ field: 'costCenterCode', operator: 'eq', value: 'CC-1' }] },
        { conditions: [{ field: 'originReference', operator: 'contains', value: 'OC' }] },
      ],
    })!;
    const built = buildPayableAdvancedClause(filter, 1)!;

    expect(built.clause).toBe('((r.cost_center_code = $1) OR (r.origin_reference ILIKE $2))');
    expect(built.params).toEqual(['CC-1', '%OC%']);
  });

  it('mantém NULL visível em `neq` — ausência não é igualdade', () => {
    const filter = parsePayableAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'currencyCode', operator: 'neq', value: 'BRL' }] }],
    })!;
    const built = buildPayableAdvancedClause(filter, 1)!;

    // SQL puro (`col <> $1`) descartaria NULL em silêncio, encolhendo o resultado sem avisar.
    expect(built.clause).toBe('(((r.currency_code IS NULL OR r.currency_code <> $1)))');
  });

  it('escapa curinga do LIKE — o termo é do operador, não um padrão livre', () => {
    const filter = parsePayableAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'originReference', operator: 'contains', value: '100%' }] }],
    })!;
    const built = buildPayableAdvancedClause(filter, 1)!;

    expect(built.params).toEqual(['%100\\%%']);
  });

  it('numera os parâmetros a partir do índice livre informado', () => {
    const filter = parsePayableAdvancedFilter({
      connector: 'AND',
      groups: [
        {
          conditions: [
            { field: 'currencyCode', operator: 'eq', value: 'BRL' },
            { field: 'originReference', operator: 'eq', value: 'OC-1' },
          ],
        },
      ],
    })!;
    const built = buildPayableAdvancedClause(filter, 5)!;

    expect(built.clause).toBe('((r.currency_code = $5 AND r.origin_reference = $6))');
  });

  it('devolve null quando não sobra condição alguma', () => {
    expect(
      buildPayableAdvancedClause({ connector: 'AND', groups: [{ conditions: [] }] }, 1),
    ).toBeNull();
  });
});

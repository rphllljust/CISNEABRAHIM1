import { describe, expect, it } from 'vitest';
import {
  buildReceivableAdvancedClause,
  parseReceivableAdvancedFilter,
} from './receivable-list-sql';

/**
 * FILTRO COMPOSTO DE CONTAS A RECEBER.
 *
 * A camada foi implementada nesta sessão: o construtor AND/OR da engine já aparecia na worklist,
 * mas a árvore era aplicada SÓ no navegador sobre a página carregada — o servidor nunca recebia o
 * recorte. Estes testes cobrem o que a nova camada ACRESCENTA e, principalmente, as duas garantias
 * de segurança: valor SEMPRE parametrizado e campo SEMPRE por allow-list.
 */

const STATUSES = ['OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'];

describe('parseReceivableAdvancedFilter', () => {
  it('aceita a forma textual que viaja na URL', () => {
    const shape = {
      connector: 'AND',
      groups: [{ conditions: [{ field: 'externalReference', operator: 'contains', value: 'NF' }] }],
    };
    expect(parseReceivableAdvancedFilter(JSON.stringify(shape))?.groups).toHaveLength(1);
  });

  it('recusa campo fora do allow-list em vez de ignorá-lo', () => {
    // Ignorar faria a tela exibir a lista inteira como se o recorte tivesse sido aplicado.
    expect(() =>
      parseReceivableAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'principal', operator: 'eq', value: '10' }] }],
      }),
    ).toThrow();
  });

  it('recusa operador que a família do campo não admite', () => {
    // `contains` sobre data exigiria inventar semântica sobre o domínio.
    expect(() =>
      parseReceivableAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'dueDate', operator: 'contains', value: '2026' }] }],
      }),
    ).toThrow();
  });

  it('recusa JSON malformado', () => {
    expect(() => parseReceivableAdvancedFilter('{oops')).toThrow();
  });

  it('recusa data que não é data', () => {
    expect(() =>
      parseReceivableAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'dueDate', operator: 'after', value: 'ontem' }] }],
      }),
    ).toThrow();
  });

  it('trata ausência como "sem recorte", não como erro', () => {
    expect(parseReceivableAdvancedFilter(undefined)).toBeUndefined();
    expect(
      parseReceivableAdvancedFilter({ connector: 'OR', groups: [] }),
    ).toBeUndefined();
  });

  it('NÃO aceita situação: o título não tem coluna de status', () => {
    // `lifecycle` é um recorte DIFERENTE do que o operador lê como situação (que é derivada de
    // lifecycle + liquidações + vencimento). O recorte por situação vive no filtro simples.
    for (const status of STATUSES) {
      expect(() =>
        parseReceivableAdvancedFilter({
          connector: 'AND',
          groups: [{ conditions: [{ field: 'status', operator: 'eq', value: status }] }],
        }),
      ).toThrow();
    }
  });
});

describe('buildReceivableAdvancedClause', () => {
  it('parametriza o valor e usa o cast da coluna REAL', () => {
    const filter = parseReceivableAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'dueDate', operator: 'after', value: '2026-01-31' }] }],
    })!;
    const built = buildReceivableAdvancedClause(filter, 3)!;

    expect(built.clause).toBe('((r.due_date > $3::date))');
    expect(built.params).toEqual(['2026-01-31']);
    // O valor NUNCA aparece no SQL: comparação é sempre por parâmetro ligado.
    expect(built.clause).not.toContain('2026-01-31');
  });

  it('liga os grupos pelo conector declarado', () => {
    const filter = parseReceivableAdvancedFilter({
      connector: 'OR',
      groups: [
        { conditions: [{ field: 'currencyCode', operator: 'eq', value: 'BRL' }] },
        { conditions: [{ field: 'externalReference', operator: 'contains', value: 'NF' }] },
      ],
    })!;
    const built = buildReceivableAdvancedClause(filter, 1)!;

    expect(built.clause).toBe('((r.currency_code = $1) OR (r.external_reference ILIKE $2))');
    expect(built.params).toEqual(['BRL', '%NF%']);
  });

  it('mantém NULL visível em `neq` — ausência não é igualdade', () => {
    const filter = parseReceivableAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'currencyCode', operator: 'neq', value: 'BRL' }] }],
    })!;
    const built = buildReceivableAdvancedClause(filter, 1)!;

    // SQL puro (`col <> $1`) descartaria NULL em silêncio, encolhendo o resultado sem avisar.
    // O parêntese extra é o do PRÓPRIO `IS NULL OR ...`, que precisa agrupar antes do AND do grupo.
    expect(built.clause).toBe('(((r.currency_code IS NULL OR r.currency_code <> $1)))');
  });

  it('escapa curinga do LIKE — o termo é do operador, não um padrão livre', () => {
    const filter = parseReceivableAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'externalReference', operator: 'contains', value: '100%' }] }],
    })!;
    const built = buildReceivableAdvancedClause(filter, 1)!;

    expect(built.params).toEqual(['%100\\%%']);
  });

  it('numera os parâmetros a partir do índice livre informado', () => {
    // O chamador já ocupou os anteriores com o escopo de autorização e os filtros simples.
    const filter = parseReceivableAdvancedFilter({
      connector: 'AND',
      groups: [
        {
          conditions: [
            { field: 'currencyCode', operator: 'eq', value: 'BRL' },
            { field: 'externalReference', operator: 'eq', value: 'NF-1' },
          ],
        },
      ],
    })!;
    const built = buildReceivableAdvancedClause(filter, 5)!;

    expect(built.clause).toBe('((r.currency_code = $5 AND r.external_reference = $6))');
  });

  it('devolve null quando não sobra condição alguma', () => {
    expect(
      buildReceivableAdvancedClause({ connector: 'AND', groups: [{ conditions: [] }] }, 1),
    ).toBeNull();
  });
});

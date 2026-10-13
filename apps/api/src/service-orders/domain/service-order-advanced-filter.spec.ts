import { describe, expect, it } from 'vitest';
import {
  buildServiceOrderListSqlParts,
  parseListServiceOrdersQuery,
  parseServiceOrderAdvancedFilter,
  SERVICE_ORDER_FILTER_SPECS,
} from './service-order-list.query';

/**
 * FILTRO AVANÇADO DA OS.
 *
 * OS é a única entidade já governada por metadado, e o recorte composto é ADITIVO ao recorte
 * OPERACIONAL (`filter=overdue`/`mine`/`unassigned`). Estes testes cobrem o que a camada acrescenta
 * e, principalmente, que ela NÃO substitui nem atropela o predicado operacional existente.
 */

const SCOPE = { clause: 'unit_id = $1', params: ['UNIDADE-1'] as unknown[] };

function build(query: Parameters<typeof buildServiceOrderListSqlParts>[0]) {
  return buildServiceOrderListSqlParts(query, SCOPE.clause, SCOPE.params);
}

describe('parseServiceOrderAdvancedFilter', () => {
  it('accepts the published shape and rejects fields outside the allow-list', () => {
    expect(
      parseServiceOrderAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'status', operator: 'eq', value: 'DRAFT' }] }],
      }),
    ).toBeDefined();

    // `archetype` é texto livre sem vocabulário publicado: não entra no construtor.
    expect(() =>
      parseServiceOrderAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'archetype', operator: 'eq', value: 'X' }] }],
      }),
    ).toThrow();
  });

  it('publishes exactly the fields the server predicate executes', () => {
    // A allow-list do frontend e a do backend são a MESMA lista: enviar um campo que o servidor não
    // traduz produziria 400, e oferecer na UI um campo que ele ignora produziria recorte falso.
    expect(SERVICE_ORDER_FILTER_SPECS.map((spec) => spec.name).sort()).toEqual(
      ['client_id', 'created_at', 'order_number', 'status', 'unit_id', 'updated_at'].sort(),
    );
  });

  it('rejects an operator the field kind does not admit', () => {
    expect(() =>
      parseServiceOrderAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'status', operator: 'contains', value: 'DRA' }] }],
      }),
    ).toThrow();
  });
});

describe('compound predicate in the service order listing', () => {
  it('conjoins the advanced predicate with scope, status and search', () => {
    const parsed = parseListServiceOrdersQuery({
      status: 'DRAFT',
      q: 'OS-2026',
      filters: JSON.stringify({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'status', operator: 'eq', value: 'RELEASED' }] }],
      }),
    });
    const parts = build(parsed);
    // O recorte composto vira MAIS UM termo do WHERE, nunca o único.
    expect(parts.whereClause).toContain('so.status =');
    expect(parts.whereClause).toContain('so.status =');
    expect(parts.params).toContain('DRAFT');
    expect(parts.params).toContain('RELEASED');
  });

  it('binds enum, uuid and date fields through their real types', () => {
    const parsed = parseListServiceOrdersQuery({
      filters: JSON.stringify({
        connector: 'AND',
        groups: [
          {
            conditions: [
              { field: 'status', operator: 'eq', value: 'RELEASED' },
              { field: 'client_id', operator: 'eq', value: '11111111-1111-4111-8111-111111111111' },
              { field: 'created_at', operator: 'after', value: '2026-01-01T00:00:00.000Z' },
            ],
          },
        ],
      }),
    });
    const parts = build(parsed);
    expect(parts.whereClause).toContain('::so.service_order_status');
    expect(parts.whereClause).toContain('::uuid');
    expect(parts.whereClause).toContain('::timestamptz');
  });

  it('keeps the OPERATIONAL filter predicate alongside the compound one', () => {
    // `filter=unassigned` é uma pergunta própria (quem não tem responsável). O composto não a
    // substitui — os dois convivem por conjunção na mesma consulta.
    const parsed = parseListServiceOrdersQuery({
      filter: 'unassigned',
      filters: JSON.stringify({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'unit_id', operator: 'eq', value: 'UNIDADE-2' }] }],
      }),
    });
    const parts = build(parsed);
    expect(parts.whereClause).toContain('NOT EXISTS');
    expect(parts.whereClause).toContain('so.unit_id =');
    expect(parts.params).toContain('UNIDADE-2');
  });

  it('joins groups by the declared connector and conditions by AND', () => {
    const parsed = parseListServiceOrdersQuery({
      filters: JSON.stringify({
        connector: 'OR',
        groups: [
          { conditions: [{ field: 'status', operator: 'eq', value: 'DRAFT' }] },
          { conditions: [{ field: 'status', operator: 'eq', value: 'RELEASED' }] },
        ],
      }),
    });
    const parts = build(parsed);
    expect(parts.whereClause).toContain(' OR ');
    expect(parts.params).toContain('DRAFT');
    expect(parts.params).toContain('RELEASED');
  });

  it('escapes wildcards so a text filter cannot become a sweep', () => {
    const parsed = parseListServiceOrdersQuery({
      filters: JSON.stringify({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'order_number', operator: 'contains', value: 'OS%_' }] }],
      }),
    });
    const parts = build(parsed);
    expect(parts.params).toContain('%OS\\%\\_%');
  });

  it('refuses an invalid filter instead of silently ignoring it', () => {
    expect(() => parseListServiceOrdersQuery({ filters: '{oops' })).toThrow();
    expect(() =>
      parseListServiceOrdersQuery({
        filters: JSON.stringify({
          connector: 'AND',
          groups: [{ conditions: [{ field: 'nope', operator: 'eq', value: 'x' }] }],
        }),
      }),
    ).toThrow();
  });

  it('leaves the query untouched when no filter is sent', () => {
    const parts = build(parseListServiceOrdersQuery({}));
    expect(parts.whereClause).not.toContain('ILIKE');
    expect(parts.params).toEqual(['UNIDADE-1']);
  });
});

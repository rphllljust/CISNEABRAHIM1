import { describe, expect, it } from 'vitest';
import {
  buildClientListOrderBy,
  buildClientListSqlParts,
  buildClientSearchClause,
  ClientListQueryError,
  CLIENT_LIST_DEFAULT_LIMIT,
  CLIENT_LIST_DIRECTIONS,
  CLIENT_LIST_MAX_LIMIT,
  CLIENT_LIST_SORTS,
  CLIENT_SEARCH_MAX_LENGTH,
  parseListClientsQuery,
  resolveClientListQuery,
  type ListClientsQuery,
} from './client-list.query';
import { CLIENT_STATUSES, PURCHASE_ORDER_REQUIREMENTS } from './client-status';

const SCOPE_GLOBAL = { clause: 'TRUE', params: [] as unknown[] };
const SCOPE_DENIED = { clause: 'FALSE', params: [] as unknown[] };

function resolved(overrides: Partial<ListClientsQuery> = {}): ListClientsQuery {
  return resolveClientListQuery({ limit: 20, offset: 0, ...overrides });
}

/** Captura o erro de consulta nomeando o campo rejeitado, sem recorrer a matcher untyped. */
function catchClientListQueryError(query: Record<string, unknown>): ClientListQueryError {
  try {
    parseListClientsQuery(query);
  } catch (error) {
    if (error instanceof ClientListQueryError) {
      return error;
    }
    throw error;
  }
  throw new Error(`parseListClientsQuery should have rejected ${JSON.stringify(query)}`);
}

describe('parseListClientsQuery', () => {
  it('applies pagination and ordering defaults when nothing is provided', () => {
    const parsed = parseListClientsQuery({});
    expect(parsed.limit).toBe(CLIENT_LIST_DEFAULT_LIMIT);
    expect(parsed.offset).toBe(0);
    expect(parsed.q).toBeUndefined();
    expect(parsed.status).toBeUndefined();
    expect(parsed.purchaseOrderRequirement).toBeUndefined();

    const full = resolveClientListQuery(parsed);
    expect(full.sort).toBe(CLIENT_LIST_SORTS.LegalName);
    expect(full.direction).toBe(CLIENT_LIST_DIRECTIONS.Asc);
  });

  it('accepts query strings and numbers for pagination', () => {
    expect(parseListClientsQuery({ limit: '50', offset: '120' })).toMatchObject({
      limit: 50,
      offset: 120,
    });
    expect(parseListClientsQuery({ limit: 50, offset: 120 })).toMatchObject({
      limit: 50,
      offset: 120,
    });
  });

  it('accepts the confirmed filters and ordering', () => {
    const parsed = parseListClientsQuery({
      q: '  Madeira  ',
      status: CLIENT_STATUSES.Active,
      purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.BeforeBilling,
      sort: CLIENT_LIST_SORTS.UpdatedAt,
      direction: CLIENT_LIST_DIRECTIONS.Desc,
    });
    expect(parsed.q).toBe('Madeira');
    expect(parsed.status).toBe(CLIENT_STATUSES.Active);
    expect(parsed.purchaseOrderRequirement).toBe(PURCHASE_ORDER_REQUIREMENTS.BeforeBilling);
    expect(resolveClientListQuery(parsed)).toMatchObject({
      sort: CLIENT_LIST_SORTS.UpdatedAt,
      direction: CLIENT_LIST_DIRECTIONS.Desc,
    });
  });

  it('treats a blank search as absent rather than as an empty filter', () => {
    expect(parseListClientsQuery({ q: '   ' }).q).toBeUndefined();
  });

  it('caps the search term at the maximum length', () => {
    const parsed = parseListClientsQuery({ q: 'a'.repeat(500) });
    expect(parsed.q).toHaveLength(CLIENT_SEARCH_MAX_LENGTH);
  });

  it.each([
    ['limit below the minimum', { limit: '0' }],
    ['limit above the maximum', { limit: String(CLIENT_LIST_MAX_LIMIT + 1) }],
    ['non numeric limit', { limit: 'many' }],
    ['negative offset', { offset: '-1' }],
    ['non numeric offset', { offset: 'first' }],
    ['unknown status', { status: 'SUSPENDED' }],
    [
      'unknown purchase order requirement',
      { purchaseOrderRequirement: 'WHENEVER' },
    ],
    ['unknown sort column', { sort: 'legalName; DROP TABLE pty.clients' }],
    ['sort that has no index-backed path', { sort: 'createdAt' }],
    ['unknown direction', { direction: 'sideways' }],
    ['search below the minimum length', { q: 'a' }],
    ['non string search', { q: 42 }],
  ])('rejects %s', (_label, query) => {
    expect(() => parseListClientsQuery(query as Record<string, unknown>)).toThrow(
      ClientListQueryError,
    );
  });

  it('names the offending field so the HTTP layer can report a precise 400', () => {
    expect(catchClientListQueryError({ sort: 'nope' }).field).toBe('sort');
    expect(catchClientListQueryError({ limit: '0' }).field).toBe('limit');
    expect(catchClientListQueryError({ direction: 'sideways' }).field).toBe('direction');
  });
});

describe('resolveClientListQuery', () => {
  it('is idempotent', () => {
    const once = resolveClientListQuery({ limit: 10, offset: 5 });
    expect(resolveClientListQuery(once)).toEqual(once);
  });
});

describe('buildClientListOrderBy', () => {
  it('orders by the allow-listed column with a deterministic tiebreak', () => {
    expect(buildClientListOrderBy(resolved())).toBe('c.legal_name ASC, c.id ASC');
    expect(
      buildClientListOrderBy(resolved({ sort: CLIENT_LIST_SORTS.UpdatedAt, direction: 'desc' })),
    ).toBe('c.updated_at DESC, c.id DESC');
  });

  it('never emits a caller supplied identifier into ORDER BY', () => {
    const orderBy = buildClientListOrderBy(resolved());
    expect(orderBy).not.toContain('DROP');
    expect(orderBy).toMatch(/^c\.(legal_name|updated_at) (ASC|DESC), c\.id (ASC|DESC)$/);
  });
});

describe('buildClientListSqlParts', () => {
  it('omits the scope clause entirely when the grant is global', () => {
    const parts = buildClientListSqlParts(resolved(), SCOPE_GLOBAL);
    expect(parts.whereClause).toBe('TRUE');
    expect(parts.params).toEqual([]);
  });

  it('keeps a deny-all scope as an explicit FALSE predicate', () => {
    const parts = buildClientListSqlParts(resolved(), SCOPE_DENIED);
    expect(parts.whereClause).toBe('FALSE');
    expect(parts.params).toEqual([]);
  });

  it('qualifies the unaliased scope column and keeps its params first', () => {
    const parts = buildClientListSqlParts(
      resolved({ status: CLIENT_STATUSES.Active }),
      { clause: 'id = ANY($1::uuid[])', params: [['11111111-1111-4111-8111-111111111111']] },
    );
    expect(parts.whereClause).toContain('c.id = ANY($1::uuid[])');
    expect(parts.whereClause).toContain('c.status = $2::"pty"."client_status"');
    expect(parts.params).toEqual([
      ['11111111-1111-4111-8111-111111111111'],
      CLIENT_STATUSES.Active,
    ]);
  });

  it('casts filters to their enum types instead of relying on inference', () => {
    const parts = buildClientListSqlParts(
      resolved({ purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.BeforeExecution }),
      SCOPE_GLOBAL,
    );
    expect(parts.whereClause).toContain(
      'c.purchase_order_requirement = $1::"pty"."purchase_order_requirement"',
    );
    expect(parts.params).toEqual([PURCHASE_ORDER_REQUIREMENTS.BeforeExecution]);
  });

  it('continues parameter numbering after the filters', () => {
    const parts = buildClientListSqlParts(
      resolved({ status: CLIENT_STATUSES.Active, q: 'Madeira' }),
      SCOPE_GLOBAL,
    );
    expect(parts.whereClause).toContain('c.status = $1');
    expect(parts.whereClause).toContain('c.legal_name % $2::text');
    expect(parts.whereClause).toContain('ILIKE $3');
    expect(parts.params).toEqual([CLIENT_STATUSES.Active, 'Madeira', '%Madeira%']);
  });

  it('combines scope, status and search with AND', () => {
    const parts = buildClientListSqlParts(
      resolved({ status: CLIENT_STATUSES.Inactive, q: '11222333000181' }),
      { clause: 'id = ANY($1::uuid[])', params: [['x']] },
    );
    expect(parts.whereClause.split(' AND ')).toHaveLength(3);
  });
});

describe('buildClientSearchClause', () => {
  it('matches a full CNPJ exactly, whatever its formatting', () => {
    for (const input of ['11222333000181', '11.222.333/0001-81']) {
      const clause = buildClientSearchClause(input, 1);
      expect(clause).toEqual({ clause: 'c.normalized_tax_id = $1', params: ['11222333000181'] });
    }
  });

  it('turns a partial CNPJ into a prefix match on the normalized digits', () => {
    const clause = buildClientSearchClause('11.222.333', 1);
    expect(clause).toEqual({ clause: 'c.normalized_tax_id LIKE $1', params: ['11222333%'] });
  });

  it('treats a bare digit fragment as a document prefix', () => {
    expect(buildClientSearchClause('1122', 1)).toEqual({
      clause: 'c.normalized_tax_id LIKE $1',
      params: ['1122%'],
    });
  });

  it('matches a client id when the term is a UUID', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(buildClientSearchClause(id, 1)).toEqual({
      clause: 'c.id = $1::uuid',
      params: [id],
    });
  });

  it('matches the external ERP code by prefix', () => {
    expect(buildClientSearchClause('ERP-000042', 1)).toEqual({
      clause: "c.external_erp_id ILIKE $1 ESCAPE '\\'",
      params: ['ERP-000042%'],
    });
  });

  it('matches names by trigram similarity and by containment', () => {
    const clause = buildClientSearchClause('Madeira', 1);
    expect(clause?.clause).toContain('c.legal_name % $1::text');
    expect(clause?.clause).toContain('c.trade_name % $1::text');
    expect(clause?.clause).toContain("c.legal_name ILIKE $2 ESCAPE '\\'");
    expect(clause?.params).toEqual(['Madeira', '%Madeira%']);
  });

  it('never returns "no clause" for an accepted term, so a search is never silently ignored', () => {
    // O normalizador canônico devolve null para termos de 2 caracteres; cair em "sem cláusula"
    // faria a listagem devolver TODOS os Clientes como se a busca tivesse sido aplicada.
    for (const term of ['ab', 'AB12', 'ABC1234', 'Rondonia', '!!!', '12ab']) {
      const clause = buildClientSearchClause(term, 1);
      expect(clause, `termo ${term}`).not.toBeNull();
      expect(clause?.clause.length).toBeGreaterThan(0);
    }
  });

  it('escapes LIKE metacharacters so a search cannot become a wildcard sweep', () => {
    const clause = buildClientSearchClause('100%_\\', 1);
    expect(clause?.params[1]).toBe('%100\\%\\_\\\\%');
  });
});

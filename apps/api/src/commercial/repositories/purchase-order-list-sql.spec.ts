import { describe, expect, it } from 'vitest';
import {
  buildPurchaseOrderListOrderClause,
  buildPurchaseOrderListWhere,
  isPurchaseOrderListDirection,
  isPurchaseOrderListSort,
  parsePurchaseOrderAdvancedFilter,
  PurchaseOrderListQueryError,
  type PurchaseOrderListFilters,
} from './purchase-order-list-sql';
import { PURCHASE_ORDER_STATUSES } from '../domain/purchase-order';

/**
 * A camada de listagem de Pedidos de compra foi implementada nesta sessão: antes o serviço montava
 * o predicado inline e conhecia apenas cliente e unidade. Estes testes cobrem o que a nova camada
 * ACRESCENTA — enumerações, janela de emissão, busca, ordenação por allow-list e filtro composto —
 * e, principalmente, as duas garantias de segurança: valor SEMPRE parametrizado e ordenação
 * SEMPRE por allow-list.
 */

const SCOPE = { clause: 'unit_id = $1', params: ['UNIDADE-1'] as unknown[] };

function resolved(overrides: Record<string, unknown> = {}): PurchaseOrderListFilters {
  return overrides as PurchaseOrderListFilters;
}

describe('buildPurchaseOrderListWhere', () => {
  it('keeps the authorization scope as the FIRST predicate term', () => {
    const where = buildPurchaseOrderListWhere(SCOPE, resolved());
    expect(where.clause).toBe('unit_id = $1');
    expect(where.params).toEqual(['UNIDADE-1']);
  });

  it('binds enumerated status through the real Postgres type', () => {
    const where = buildPurchaseOrderListWhere(
      SCOPE,
      resolved({ status: PURCHASE_ORDER_STATUSES.Registered }),
    );
    expect(where.clause).toContain('status = $2::com.purchase_order_status');
    expect(where.params).toEqual(['UNIDADE-1', 'REGISTERED']);
  });

  it('rejects an enumerated status outside the domain vocabulary', () => {
    expect(() => buildPurchaseOrderListWhere(SCOPE, resolved({ status: 'APPROVED' }))).toThrow(
      PurchaseOrderListQueryError,
    );
  });

  it('bounds the issue window with explicit casts', () => {
    const where = buildPurchaseOrderListWhere(
      SCOPE,
      resolved({ issueFrom: '2026-01-01', issueTo: '2026-12-31' }),
    );
    expect(where.clause).toContain('issue_date >= $2::timestamptz');
    expect(where.clause).toContain('issue_date <= $3::timestamptz');
  });

  it('searches the three identifying fields and escapes LIKE metacharacters', () => {
    const where = buildPurchaseOrderListWhere(SCOPE, resolved({ search: '100%_\\' }));
    expect(where.clause).toContain('po_number ILIKE $2');
    expect(where.clause).toContain('internal_code ILIKE $2');
    expect(where.clause).toContain('rc_number ILIKE $2');
    expect(where.params[1]).toBe('%100\\%\\_\\\\%');
  });

  it('refuses a search term above the published maximum', () => {
    expect(() =>
      buildPurchaseOrderListWhere(SCOPE, resolved({ search: 'x'.repeat(121) })),
    ).toThrow(PurchaseOrderListQueryError);
  });

  it('conjoins the advanced predicate with the other recortes in ONE query', () => {
    const where = buildPurchaseOrderListWhere(
      SCOPE,
      resolved({
        status: PURCHASE_ORDER_STATUSES.Registered,
        search: 'PO-2026',
        advanced: parsePurchaseOrderAdvancedFilter({
          connector: 'AND',
          groups: [{ conditions: [{ field: 'currencyCode', operator: 'eq', value: 'BRL' }] }],
        }),
      }),
    );
    expect(where.clause).toContain('status = $2');
    expect(where.clause).toContain('po_number ILIKE $3');
    expect(where.clause).toContain('currency_code = $4');
    expect(where.params).toEqual(['UNIDADE-1', 'REGISTERED', '%PO-2026%', 'BRL']);
  });
});

describe('parsePurchaseOrderAdvancedFilter', () => {
  it('accepts the published shape and joins groups by the declared connector', () => {
    const parsed = parsePurchaseOrderAdvancedFilter({
      connector: 'OR',
      groups: [
        { conditions: [{ field: 'status', operator: 'eq', value: 'DRAFT' }] },
        { conditions: [{ field: 'status', operator: 'eq', value: 'REGISTERED' }] },
      ],
    });
    expect(parsed?.connector).toBe('OR');
    expect(parsed?.groups).toHaveLength(2);
  });

  it('accepts the JSON string form that travels in the URL', () => {
    const parsed = parsePurchaseOrderAdvancedFilter(
      JSON.stringify({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'poNumber', operator: 'contains', value: '2026' }] }],
      }),
    );
    expect(parsed?.groups[0]?.conditions[0]?.value).toBe('2026');
  });

  it('rejects a field outside the allow-list', () => {
    expect(() =>
      parsePurchaseOrderAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'consumed_amount', operator: 'eq', value: '1' }] }],
      }),
    ).toThrow();
  });

  it('rejects an operator the field kind does not admit and an invalid date', () => {
    expect(() =>
      parsePurchaseOrderAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'status', operator: 'contains', value: 'DRAFT' }] }],
      }),
    ).toThrow();
    expect(() =>
      parsePurchaseOrderAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'issueDate', operator: 'after', value: 'ontem' }] }],
      }),
    ).toThrow();
  });

  it('treats an empty filter as absence rather than an error', () => {
    expect(parsePurchaseOrderAdvancedFilter(undefined)).toBeUndefined();
    expect(parsePurchaseOrderAdvancedFilter({ connector: 'AND', groups: [] })).toBeUndefined();
  });

  it('rejects malformed JSON instead of silently dropping the recorte', () => {
    expect(() => parsePurchaseOrderAdvancedFilter('{oops')).toThrow();
  });
});

describe('buildPurchaseOrderListOrderClause', () => {
  it('orders by allow-list with a stable tiebreaker', () => {
    expect(buildPurchaseOrderListOrderClause('createdAt', 'desc')).toBe('created_at DESC, id DESC');
    expect(buildPurchaseOrderListOrderClause('updatedAt', 'asc')).toBe('updated_at ASC, id ASC');
  });

  it('keeps absence last for nullable columns, because no amount is not the smallest amount', () => {
    expect(buildPurchaseOrderListOrderClause('totalAmount', 'desc')).toContain('NULLS LAST');
    expect(buildPurchaseOrderListOrderClause('issueDate', 'asc')).toContain('NULLS LAST');
  });

  it('refuses values outside the allow-list instead of interpolating them', () => {
    expect(() => buildPurchaseOrderListOrderClause('total_amount; DROP TABLE' as never)).toThrow(
      PurchaseOrderListQueryError,
    );
    expect(isPurchaseOrderListSort('createdAt')).toBe(true);
    expect(isPurchaseOrderListSort('internal_code')).toBe(false);
    expect(isPurchaseOrderListDirection('sideways')).toBe(false);
  });
});

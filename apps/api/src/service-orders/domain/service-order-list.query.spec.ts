import { describe, expect, it } from 'vitest';
import { SERVICE_ORDER_STATUSES } from './service-order';
import {
  SERVICE_ORDER_LIST_EVENTS,
  SERVICE_ORDER_LIST_FILTERS,
  SERVICE_ORDER_LIST_ORDERS,
  ServiceOrderListQueryError,
  buildServiceOrderListSqlParts,
  parseListServiceOrdersQuery,
} from './service-order-list.query';

describe('service-order-list.query', () => {
  it('parses pagination defaults and confirmed filters', () => {
    const parsed = parseListServiceOrdersQuery({
      limit: '10',
      offset: '5',
      status: SERVICE_ORDER_STATUSES.Released,
      filter: SERVICE_ORDER_LIST_FILTERS.Overdue,
      clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      unitId: 'unit-a',
      q: 'OS-2026',
      from: '2026-08-23',
      to: '2026-08-29',
      event: SERVICE_ORDER_LIST_EVENTS.Opened,
    });

    expect(parsed.limit).toBe(10);
    expect(parsed.offset).toBe(5);
    expect(parsed.status).toBe(SERVICE_ORDER_STATUSES.Released);
    expect(parsed.filter).toBe(SERVICE_ORDER_LIST_FILTERS.Overdue);
    expect(parsed.event).toBe(SERVICE_ORDER_LIST_EVENTS.Opened);
    expect(parsed.from?.toISOString()).toBe('2026-08-23T00:00:00.000Z');
    expect(parsed.toExclusive?.toISOString()).toBe('2026-08-30T00:00:00.000Z');
  });

  it('builds stable ordering and overdue deadline join', () => {
    const query = parseListServiceOrdersQuery({ filter: SERVICE_ORDER_LIST_FILTERS.Overdue });
    const parts = buildServiceOrderListSqlParts(query, 'unit_id = $1', ['unit-a']);

    expect(parts.orderBy).toBe('so.created_at DESC, so.id DESC');
    expect(parts.fromClause).toContain('INNER JOIN LATERAL');
    expect(parts.whereClause).toContain('deadlines.deadline <= NOW()');
    expect(parts.whereClause).toContain('so.unit_id = $1');
  });

  it('uses completed_at when filtering completed orders in period', () => {
    const query = parseListServiceOrdersQuery({
      status: SERVICE_ORDER_STATUSES.Completed,
      from: '2026-08-01',
      to: '2026-08-31',
      event: SERVICE_ORDER_LIST_EVENTS.Completed,
    });
    const parts = buildServiceOrderListSqlParts(query, 'TRUE', []);

    expect(parts.whereClause).toContain('so.completed_at >=');
    expect(parts.whereClause).toContain("so.status = $1::so.service_order_status");
  });
});

describe('service-order-list.query dispatch segments', () => {
  it('resolves mine against the acting identity without widening scope', () => {
    const query = parseListServiceOrdersQuery({ filter: SERVICE_ORDER_LIST_FILTERS.Mine });
    const parts = buildServiceOrderListSqlParts(query, 'unit_id = $1', ['unit-a'], {
      actorIdentityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    expect(parts.whereClause).toContain('wm.identity_id = $2::uuid');
    expect(parts.whereClause).toContain("ra.status = 'ACTIVE'::res.resource_allocation_status");
    expect(parts.params).toEqual(['unit-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
  });

  it('rejects mine without an acting identity', () => {
    const query = parseListServiceOrdersQuery({ filter: SERVICE_ORDER_LIST_FILTERS.Mine });
    expect(() => buildServiceOrderListSqlParts(query, 'TRUE', [])).toThrow(
      ServiceOrderListQueryError,
    );
  });

  it('builds unassigned from active allocations only, excluding terminal orders', () => {
    const query = parseListServiceOrdersQuery({ filter: SERVICE_ORDER_LIST_FILTERS.Unassigned });
    const parts = buildServiceOrderListSqlParts(query, 'TRUE', []);

    expect(parts.whereClause).toContain('so.status NOT IN');
    expect(parts.whereClause).toContain('NOT EXISTS');
    expect(parts.whereClause).toContain('wm.identity_id IS NOT NULL');
    expect(parts.whereClause).not.toContain('wm.identity_id =');
  });

  it('builds unscheduled from the absence of any active operational window', () => {
    const query = parseListServiceOrdersQuery({ filter: SERVICE_ORDER_LIST_FILTERS.Unscheduled });
    const parts = buildServiceOrderListSqlParts(query, 'TRUE', []);

    expect(parts.whereClause).toContain('so.status NOT IN');
    expect(parts.whereClause).toContain('so.planned_resources pr');
    expect(parts.whereClause).toContain('res.resource_allocations ra');
    expect(parts.whereClause).toContain('NOT (');
    expect(parts.whereClause).not.toContain("date_trunc('day', NOW())");
  });

  it('builds scheduled-today as a window overlapping the current day', () => {
    const query = parseListServiceOrdersQuery({ filter: SERVICE_ORDER_LIST_FILTERS.ScheduledToday });
    const parts = buildServiceOrderListSqlParts(query, 'TRUE', []);

    expect(parts.whereClause).toContain('so.status NOT IN');
    expect(parts.whereClause).toContain("pr.operational_start < date_trunc('day', NOW()) + INTERVAL '1 day'");
    expect(parts.whereClause).toContain("ra.operational_end > date_trunc('day', NOW())");
    expect(parts.whereClause).not.toContain('NOT (');
  });

  it('keeps dispatch segments exclusive and does not change ordering', () => {
    const query = parseListServiceOrdersQuery({ filter: SERVICE_ORDER_LIST_FILTERS.Unassigned });
    const parts = buildServiceOrderListSqlParts(query, 'TRUE', []);

    expect(parts.orderBy).toBe('so.created_at DESC, so.id DESC');
    expect(parts.fromClause).toBe('so.service_orders so');
  });
});

describe('service-order-list.query operational ordering', () => {
  it('defaults to the most recent orders', () => {
    const parts = buildServiceOrderListSqlParts(parseListServiceOrdersQuery({}), 'TRUE', []);

    expect(parts.orderBy).toBe('so.created_at DESC, so.id DESC');
  });

  it('orders by the schedule kernel, keeping orders without a window last', () => {
    const query = parseListServiceOrdersQuery({ order: SERVICE_ORDER_LIST_ORDERS.Schedule });
    const parts = buildServiceOrderListSqlParts(query, 'TRUE', []);

    expect(query.order).toBe(SERVICE_ORDER_LIST_ORDERS.Schedule);
    expect(parts.orderBy).toBe('deadline_at ASC NULLS LAST, so.created_at DESC, so.id DESC');
  });

  it('accepts an explicit recent ordering identical to the default', () => {
    const query = parseListServiceOrdersQuery({ order: SERVICE_ORDER_LIST_ORDERS.Recent });
    const parts = buildServiceOrderListSqlParts(query, 'TRUE', []);

    expect(parts.orderBy).toBe('so.created_at DESC, so.id DESC');
  });

  it('rejects an unknown ordering instead of ordering silently', () => {
    expect(() => parseListServiceOrdersQuery({ order: 'deadline_asc; DROP TABLE' })).toThrow(
      ServiceOrderListQueryError,
    );
  });
});

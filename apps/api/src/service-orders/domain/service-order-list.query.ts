import { resolveApproachingDueThresholdDays } from '../../analytics/domain/aging-snapshot';
import { assertUuid } from '../../catalog/domain/service-catalog.validation';
import {
  escapeLikeWildcards,
  normalizeSearchQuery,
} from '../../search/domain/search-query-normalizer';
import { isServiceOrderStatus, SERVICE_ORDER_STATUSES } from './service-order';
import { TERMINAL_SERVICE_ORDER_STATUSES } from './service-order.state-machine';

export const SERVICE_ORDER_LIST_FILTERS = {
  Overdue: 'overdue',
  ApproachingDue: 'approaching-due',
} as const;

export type ServiceOrderListFilter =
  (typeof SERVICE_ORDER_LIST_FILTERS)[keyof typeof SERVICE_ORDER_LIST_FILTERS];

export const SERVICE_ORDER_LIST_EVENTS = {
  Opened: 'opened',
  Completed: 'completed',
} as const;

export type ServiceOrderListEvent =
  (typeof SERVICE_ORDER_LIST_EVENTS)[keyof typeof SERVICE_ORDER_LIST_EVENTS];

export const SERVICE_ORDER_ACTIVE_STATUS = 'active';

export type ListServiceOrdersQuery = {
  clientId?: string;
  unitId?: string;
  status?: string;
  archetype?: string;
  filter?: ServiceOrderListFilter;
  q?: string;
  from?: Date;
  toExclusive?: Date;
  event?: ServiceOrderListEvent;
  limit: number;
  offset: number;
};

export type ServiceOrderListSqlParts = {
  fromClause: string;
  whereClause: string;
  params: unknown[];
  orderBy: string;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const FILTER_SET = new Set<string>(Object.values(SERVICE_ORDER_LIST_FILTERS));
const EVENT_SET = new Set<string>(Object.values(SERVICE_ORDER_LIST_EVENTS));

const TERMINAL_SERVICE_ORDER_SQL = Array.from(TERMINAL_SERVICE_ORDER_STATUSES)
  .map((status) => `'${status}'`)
  .join(', ');

const DEADLINE_LATERAL_JOIN = `
INNER JOIN LATERAL (SELECT so.deadline_for(so.id) AS deadline) deadlines ON TRUE`;

export class ServiceOrderListQueryError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

export function parseListServiceOrdersQuery(query: Record<string, unknown>): ListServiceOrdersQuery {
  const limitRaw = Number(query['limit'] ?? 20);
  const offsetRaw = Number(query['offset'] ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  const clientId = typeof query['clientId'] === 'string' ? query['clientId'].trim() : undefined;
  const unitId = typeof query['unitId'] === 'string' ? query['unitId'].trim() : undefined;
  const status = typeof query['status'] === 'string' ? query['status'].trim() : undefined;
  const archetype = typeof query['archetype'] === 'string' ? query['archetype'].trim() : undefined;
  const filterRaw = typeof query['filter'] === 'string' ? query['filter'].trim() : undefined;
  const q = typeof query['q'] === 'string' ? query['q'].trim() : undefined;
  const fromRaw = typeof query['from'] === 'string' ? query['from'].trim() : undefined;
  const toRaw = typeof query['to'] === 'string' ? query['to'].trim() : undefined;
  const eventRaw = typeof query['event'] === 'string' ? query['event'].trim() : undefined;

  if (clientId) {
    assertUuid(clientId, 'clientId');
  }
  if (unitId && unitId.length === 0) {
    throw new ServiceOrderListQueryError('unitId');
  }
  if (status && status !== SERVICE_ORDER_ACTIVE_STATUS && !isServiceOrderStatus(status)) {
    throw new ServiceOrderListQueryError('status');
  }
  if (archetype && archetype.length === 0) {
    throw new ServiceOrderListQueryError('archetype');
  }
  if (filterRaw && !FILTER_SET.has(filterRaw)) {
    throw new ServiceOrderListQueryError('filter');
  }
  if (eventRaw && !EVENT_SET.has(eventRaw)) {
    throw new ServiceOrderListQueryError('event');
  }
  if (q !== undefined && q.length > 0 && q.length < 2) {
    throw new ServiceOrderListQueryError('q');
  }

  const from = fromRaw ? parsePeriodBound(fromRaw, 'from') : undefined;
  const toExclusive = toRaw ? parsePeriodBound(toRaw, 'toExclusive') : undefined;
  if (fromRaw && !from) {
    throw new ServiceOrderListQueryError('from');
  }
  if (toRaw && !toExclusive) {
    throw new ServiceOrderListQueryError('to');
  }
  if (from && toExclusive && from >= toExclusive) {
    throw new ServiceOrderListQueryError('period');
  }

  return {
    clientId,
    unitId: unitId || undefined,
    status: status || undefined,
    archetype: archetype || undefined,
    filter: filterRaw as ServiceOrderListFilter | undefined,
    q: q || undefined,
    from,
    toExclusive,
    event: eventRaw as ServiceOrderListEvent | undefined,
    limit,
    offset,
  };
}

export function buildServiceOrderListSqlParts(
  query: ListServiceOrdersQuery,
  scopeClause: string,
  scopeParams: unknown[],
): ServiceOrderListSqlParts {
  const clauses = [`(${scopeClause.replace(/\bunit_id\b/g, 'so.unit_id').replace(/\bclient_id\b/g, 'so.client_id')})`];
  const params = [...scopeParams];
  let fromClause = 'so.service_orders so';

  if (query.clientId) {
    params.push(query.clientId);
    clauses.push(`so.client_id = $${params.length}::uuid`);
  }
  if (query.unitId) {
    params.push(query.unitId);
    clauses.push(`so.unit_id = $${params.length}`);
  }
  if (query.status === SERVICE_ORDER_ACTIVE_STATUS) {
    clauses.push(`so.status <> '${SERVICE_ORDER_STATUSES.Cancelled}'`);
  } else if (query.status) {
    params.push(query.status);
    clauses.push(`so.status = $${params.length}::so.service_order_status`);
  }
  if (query.archetype) {
    params.push(query.archetype);
    clauses.push(`so.service_snapshot->>'archetype' = $${params.length}`);
  }

  if (query.q) {
    const searchClause = buildServiceOrderSearchClause(query.q, params.length + 1);
    if (!searchClause) {
      throw new ServiceOrderListQueryError('q');
    }
    clauses.push(`(${searchClause.clause})`);
    params.push(...searchClause.params);
  }

  const periodColumn = resolvePeriodColumn(query);
  if (query.from) {
    params.push(query.from);
    clauses.push(`${periodColumn} >= $${params.length}`);
  }
  if (query.toExclusive) {
    params.push(query.toExclusive);
    clauses.push(`${periodColumn} < $${params.length}`);
  }

  if (query.filter === SERVICE_ORDER_LIST_FILTERS.Overdue) {
    fromClause = `so.service_orders so ${DEADLINE_LATERAL_JOIN}`;
    clauses.push(`so.status NOT IN (${TERMINAL_SERVICE_ORDER_SQL})`);
    clauses.push('deadlines.deadline <= NOW()');
  } else if (query.filter === SERVICE_ORDER_LIST_FILTERS.ApproachingDue) {
    fromClause = `so.service_orders so ${DEADLINE_LATERAL_JOIN}`;
    params.push(resolveApproachingDueThresholdDays());
    const thresholdParam = `$${params.length}`;
    clauses.push(`so.status NOT IN (${TERMINAL_SERVICE_ORDER_SQL})`);
    clauses.push('deadlines.deadline > NOW()');
    clauses.push(`deadlines.deadline <= NOW() + (${thresholdParam}::int * INTERVAL '1 day')`);
  }

  return {
    fromClause,
    whereClause: clauses.join(' AND '),
    params,
    orderBy: 'so.created_at DESC, so.id DESC',
  };
}

function resolvePeriodColumn(query: ListServiceOrdersQuery): string {
  if (
    query.event === SERVICE_ORDER_LIST_EVENTS.Completed ||
    query.status === SERVICE_ORDER_STATUSES.Completed
  ) {
    return 'so.completed_at';
  }
  return 'so.created_at';
}

function buildServiceOrderSearchClause(
  rawQuery: string,
  firstParamIndex: number,
): { clause: string; params: unknown[] } | null {
  const normalized = normalizeSearchQuery(rawQuery);
  if (!normalized) {
    return null;
  }

  switch (normalized.kind) {
    case 'uuid':
      return {
        clause: `so.id = $${firstParamIndex}::uuid`,
        params: [normalized.term],
      };
    case 'cnpj':
      return {
        clause: `so.client_snapshot->>'normalizedTaxId' = $${firstParamIndex}`,
        params: [normalized.term],
      };
    case 'code':
      return {
        clause: `(so.order_number ILIKE $${firstParamIndex} OR so.internal_code ILIKE $${firstParamIndex} OR so.rc_number ILIKE $${firstParamIndex})`,
        params: [normalized.prefixTerm],
      };
    case 'text':
      return {
        clause: `(so.order_number ILIKE $${firstParamIndex} OR so.internal_code ILIKE $${firstParamIndex} OR so.description ILIKE $${firstParamIndex})`,
        params: [`%${escapeLikeWildcards(normalized.term)}%`],
      };
    default:
      return null;
  }
}

function parsePeriodBound(value: string, mode: 'from' | 'toExclusive'): Date | undefined {
  if (DATE_ONLY.test(value)) {
    if (mode === 'from') {
      return new Date(`${value}T00:00:00.000Z`);
    }
    const end = new Date(`${value}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return end;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

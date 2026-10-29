import { resolveApproachingDueThresholdDays } from '../../analytics/domain/aging-snapshot';
import { assertUuid } from '../../catalog/domain/service-catalog.validation';
import {
  escapeLikeWildcards,
  normalizeSearchQuery,
} from '../../search/domain/search-query-normalizer';
import {
  parseAdvancedFilter,
  type AdvancedFilter,
  type AdvancedFilterFieldSpec,
} from '../../infrastructure/http/contracts/advanced-filter-query';
import { isServiceOrderStatus, SERVICE_ORDER_STATUSES } from './service-order';
import { TERMINAL_SERVICE_ORDER_STATUSES } from './service-order.state-machine';

export const SERVICE_ORDER_LIST_FILTERS = {
  Overdue: 'overdue',
  ApproachingDue: 'approaching-due',
  /**
   * Segmentos de despacho. Adaptados do padrao operacional de listagem de
   * ordens de servico de campo (minhas / nao atribuidas / nao agendadas /
   * hoje), apoiados apenas em dados que o CISNE ja possui: alocacoes ACTIVE
   * e recursos planejados PLANNED com janela operacional - as mesmas fontes
   * usadas pelo kernel de prazo so.deadline_for.
   */
  Mine: 'mine',
  Unassigned: 'unassigned',
  Unscheduled: 'unscheduled',
  ScheduledToday: 'scheduled-today',
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

/**
 * Ordenacao operacional da listagem. `schedule` usa o prazo derivado pelo
 * kernel so.deadline_for, ja projetado em cada linha: e a leitura primaria do
 * despacho (o que atende primeiro), com as OS sem janela ao final. O padrao
 * permanece `recent` para nao alterar consumidores existentes.
 */
export const SERVICE_ORDER_LIST_ORDERS = {
  Recent: 'recent',
  Schedule: 'schedule',
} as const;

export type ServiceOrderListOrder =
  (typeof SERVICE_ORDER_LIST_ORDERS)[keyof typeof SERVICE_ORDER_LIST_ORDERS];

export const SERVICE_ORDER_LIST_DEFAULT_ORDER: ServiceOrderListOrder =
  SERVICE_ORDER_LIST_ORDERS.Recent;

export type ListServiceOrdersQuery = {
  clientId?: string;
  /** Identificador autoritativo do contrato vinculado à OS (não deriva de clientId). */
  contractId?: string;
  unitId?: string;
  status?: string;
  archetype?: string;
  filter?: ServiceOrderListFilter;
  order?: ServiceOrderListOrder;
  q?: string;
  from?: Date;
  toExclusive?: Date;
  event?: ServiceOrderListEvent;
  /** Filtro avançado já validado; ausente = sem recorte composto. */
  advanced?: AdvancedFilter;
  limit: number;
  offset: number;
};

/**
 * FILTRO AVANÇADO — mesma forma publicada nos demais domínios.
 *
 * A validação de FORMA é a compartilhada (`infrastructure/http/contracts/advanced-filter-query`);
 * aqui fica só a especificação dos campos que ESTA entidade aceita, e ela é a allow-list fechada:
 * um campo fora dela é recusado com 400, nunca interpolado.
 *
 * `archetype` e `assignedIdentityId` NÃO entram: o primeiro é texto livre de classificação sem
 * vocabulário publicado, e o segundo exigiria decidir qual das alocações representa "o responsável"
 * — regra que o predicado de `filter=assigned` já resolve sem ambiguidade. Oferecer no construtor um
 * recorte que o servidor não executa é o defeito que esta allow-list existe para impedir.
 */
export const SERVICE_ORDER_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { name: 'order_number', kind: 'text' },
  { name: 'status', kind: 'enum', isValidEnumValue: isServiceOrderStatus },
  { name: 'client_id', kind: 'text' },
  { name: 'unit_id', kind: 'text' },
  { name: 'created_at', kind: 'date' },
  { name: 'updated_at', kind: 'date' },
];

export function parseServiceOrderAdvancedFilter(value: unknown): AdvancedFilter | undefined {
  return parseAdvancedFilter(value, SERVICE_ORDER_FILTER_SPECS);
}

/**
 * Predicado do filtro avançado.
 *
 * `so.` é o alias canônico da OS na consulta de listagem, então as colunas são qualificadas aqui
 * para conviver com os LEFT JOINs que a listagem já monta.
 */
function buildServiceOrderAdvancedClause(
  filter: AdvancedFilter,
  firstParamIndex: number,
): { clause: string; params: unknown[] } | null {
  const params: unknown[] = [];
  const groupClauses: string[] = [];

  for (const group of filter.groups) {
    const conditionClauses: string[] = [];
    for (const condition of group.conditions) {
      const index = firstParamIndex + params.length;
      const param = `$${index}`;
      const { field, operator, value } = condition;

      if (field === 'status') {
        conditionClauses.push(
          `so.status ${operator === 'neq' ? '<>' : '='} ${param}::so.service_order_status`,
        );
        params.push(value);
      } else if (field === 'created_at' || field === 'updated_at') {
        const column = field === 'updated_at' ? 'so.updated_at' : 'so.created_at';
        conditionClauses.push(`${column} ${operator === 'before' ? '<' : '>'} ${param}::timestamptz`);
        params.push(value);
      } else if (field === 'client_id') {
        conditionClauses.push(
          `so.client_id ${operator === 'neq' ? '<>' : '='} ${param}::uuid`,
        );
        params.push(value);
      } else {
        const column = field === 'unit_id' ? 'so.unit_id' : 'so.order_number';
        const built = buildServiceOrderTextClause(column, operator, value, param);
        conditionClauses.push(built.clause);
        params.push(...built.params);
      }
    }
    if (conditionClauses.length > 0) {
      groupClauses.push(`(${conditionClauses.join(' AND ')})`);
    }
  }

  if (groupClauses.length === 0) {
    return null;
  }
  return { clause: `(${groupClauses.join(` ${filter.connector} `)})`, params };
}

function buildServiceOrderTextClause(
  column: string,
  operator: string,
  value: string,
  param: string,
): { clause: string; params: unknown[] } {
  const escape = (term: string): string => term.replace(/[\\%_]/g, (match) => `\\${match}`);
  if (operator === 'eq') {
    return { clause: `${column} = ${param}`, params: [value] };
  }
  if (operator === 'neq') {
    return { clause: `(${column} IS NULL OR ${column} <> ${param})`, params: [value] };
  }
  if (operator === 'startsWith') {
    return { clause: `${column} ILIKE ${param}`, params: [`${escape(value)}%`] };
  }
  return { clause: `${column} ILIKE ${param}`, params: [`%${escape(value)}%`] };
}

export type ServiceOrderListSqlParts = {
  fromClause: string;
  whereClause: string;
  params: unknown[];
  orderBy: string;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const FILTER_SET = new Set<string>(Object.values(SERVICE_ORDER_LIST_FILTERS));
const EVENT_SET = new Set<string>(Object.values(SERVICE_ORDER_LIST_EVENTS));
const ORDER_SET = new Set<string>(Object.values(SERVICE_ORDER_LIST_ORDERS));

const ORDER_BY_RECENT = 'so.created_at DESC, so.id DESC';
const ORDER_BY_SCHEDULE = 'deadline_at ASC NULLS LAST, so.created_at DESC, so.id DESC';

const TERMINAL_SERVICE_ORDER_SQL = Array.from(TERMINAL_SERVICE_ORDER_STATUSES)
  .map((status) => `'${status}'`)
  .join(', ');

const DEADLINE_LATERAL_JOIN = `
INNER JOIN LATERAL (SELECT so.deadline_for(so.id) AS deadline) deadlines ON TRUE`;

const NON_TERMINAL_SERVICE_ORDER_SQL = `so.status NOT IN (${TERMINAL_SERVICE_ORDER_SQL})`;

/**
 * OS atribuida: existe alocacao ACTIVE de um membro de mao de obra ACTIVE
 * com identidade vinculada. Mesma semantica do assigned_identity_id projetado
 * em so.service_orders pelo repositorio.
 */
function buildAssignedIdentityExists(identityParam: string | null): string {
  return `EXISTS (
    SELECT 1
    FROM res.resource_allocations ra
    INNER JOIN wrk.workforce_members wm ON wm.id = ra.workforce_member_id
    WHERE ra.service_order_id = so.id
      AND ra.status = 'ACTIVE'::res.resource_allocation_status
      AND wm.status = 'ACTIVE'::wrk.workforce_member_status
      AND wm.identity_id IS NOT NULL
      ${identityParam ? `AND wm.identity_id = ${identityParam}::uuid` : ''}
  )`;
}

/**
 * OS agendada: existe janela operacional ativa, em recurso planejado PLANNED
 * ou em alocacao ACTIVE. As alocacoes tem janela obrigatoria por constraint
 * de banco; os recursos planejados podem ter janela nula.
 */
function buildOperationalWindowExists(overlapsCurrentDayOnly: boolean): string {
  const dayOverlap = `
      AND pr.operational_start < date_trunc('day', NOW()) + INTERVAL '1 day'
      AND pr.operational_end > date_trunc('day', NOW())`;
  const allocationDayOverlap = `
      AND ra.operational_start < date_trunc('day', NOW()) + INTERVAL '1 day'
      AND ra.operational_end > date_trunc('day', NOW())`;
  return `(
    EXISTS (
      SELECT 1
      FROM so.planned_resources pr
      WHERE pr.service_order_id = so.id
        AND pr.status = 'PLANNED'::so.planned_resource_status
        AND pr.operational_start IS NOT NULL
        AND pr.operational_end IS NOT NULL${overlapsCurrentDayOnly ? dayOverlap : ''}
    )
    OR EXISTS (
      SELECT 1
      FROM res.resource_allocations ra
      WHERE ra.service_order_id = so.id
        AND ra.status = 'ACTIVE'::res.resource_allocation_status${overlapsCurrentDayOnly ? allocationDayOverlap : ''}
    )
  )`;
}

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
  const contractId = typeof query['contractId'] === 'string' ? query['contractId'].trim() : undefined;
  const unitId = typeof query['unitId'] === 'string' ? query['unitId'].trim() : undefined;
  const status = typeof query['status'] === 'string' ? query['status'].trim() : undefined;
  const archetype = typeof query['archetype'] === 'string' ? query['archetype'].trim() : undefined;
  const filterRaw = typeof query['filter'] === 'string' ? query['filter'].trim() : undefined;
  const orderRaw = typeof query['order'] === 'string' ? query['order'].trim() : undefined;
  const q = typeof query['q'] === 'string' ? query['q'].trim() : undefined;
  const fromRaw = typeof query['from'] === 'string' ? query['from'].trim() : undefined;
  const toRaw = typeof query['to'] === 'string' ? query['to'].trim() : undefined;
  const eventRaw = typeof query['event'] === 'string' ? query['event'].trim() : undefined;

  if (clientId) {
    assertUuid(clientId, 'clientId');
  }
  // A recusa de UUID inválido é obrigatória: nunca retornar toda a carteira.
  if (contractId) {
    assertUuid(contractId, 'contractId');
  }
  if (query['contractId'] !== undefined && !contractId) {
    throw new ServiceOrderListQueryError('contractId');
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
  if (orderRaw && !ORDER_SET.has(orderRaw)) {
    throw new ServiceOrderListQueryError('order');
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
    contractId,
    unitId: unitId || undefined,
    status: status || undefined,
    archetype: archetype || undefined,
    filter: filterRaw as ServiceOrderListFilter | undefined,
    order: orderRaw as ServiceOrderListOrder | undefined,
    q: q || undefined,
    from,
    toExclusive,
    event: eventRaw as ServiceOrderListEvent | undefined,
    advanced: parseServiceOrderAdvancedFilter(query['filters']),
    limit,
    offset,
  };
}

export type ServiceOrderListContext = {
  /** Identidade do ator, necessaria para o segmento de despacho `mine`. */
  actorIdentityId?: string;
};

export function buildServiceOrderListSqlParts(
  query: ListServiceOrdersQuery,
  scopeClause: string,
  scopeParams: unknown[],
  context: ServiceOrderListContext = {},
): ServiceOrderListSqlParts {
  const clauses = [`(${scopeClause.replace(/\bunit_id\b/g, 'so.unit_id').replace(/\bclient_id\b/g, 'so.client_id')})`];
  const params = [...scopeParams];
  let fromClause = 'so.service_orders so';

  if (query.clientId) {
    params.push(query.clientId);
    clauses.push(`so.client_id = $${params.length}::uuid`);
  }
  if (query.contractId) {
    params.push(query.contractId);
    clauses.push(`so.contract_id = $${params.length}::uuid`);
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
  } else if (query.filter === SERVICE_ORDER_LIST_FILTERS.Mine) {
    if (!context.actorIdentityId) {
      throw new ServiceOrderListQueryError('filter');
    }
    params.push(context.actorIdentityId);
    clauses.push(buildAssignedIdentityExists(`$${params.length}`));
  } else if (query.filter === SERVICE_ORDER_LIST_FILTERS.Unassigned) {
    clauses.push(NON_TERMINAL_SERVICE_ORDER_SQL);
    clauses.push(`NOT ${buildAssignedIdentityExists(null)}`);
  } else if (query.filter === SERVICE_ORDER_LIST_FILTERS.Unscheduled) {
    clauses.push(NON_TERMINAL_SERVICE_ORDER_SQL);
    clauses.push(`NOT ${buildOperationalWindowExists(false)}`);
  } else if (query.filter === SERVICE_ORDER_LIST_FILTERS.ScheduledToday) {
    clauses.push(NON_TERMINAL_SERVICE_ORDER_SQL);
    clauses.push(buildOperationalWindowExists(true));
  }

  /*
   * FILTRO AVANÇADO — entra como UM predicado entre os demais, e por isso convive por conjunção com
   * escopo de unidade, cliente, situação, arquétipo, busca, período e com o recorte OPERACIONAL
   * (`filter=`). Os dois não se substituem: `filter=overdue` responde "o que venceu"; o composto
   * responde "quais OS, entre essas, têm tal situação e tal janela de criação".
   */
  if (query.advanced) {
    const advanced = buildServiceOrderAdvancedClause(query.advanced, params.length + 1);
    if (advanced) {
      clauses.push(advanced.clause);
      params.push(...advanced.params);
    }
  }

  return {
    fromClause,
    whereClause: clauses.join(' AND '),
    params,
    orderBy:
      query.order === SERVICE_ORDER_LIST_ORDERS.Schedule ? ORDER_BY_SCHEDULE : ORDER_BY_RECENT,
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

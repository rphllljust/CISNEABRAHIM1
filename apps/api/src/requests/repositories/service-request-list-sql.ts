import {
  isServiceRequestOrigin,
  isServiceRequestPriority,
  isServiceRequestStatus,
} from '../domain/service-request';
import { ServiceRequestValidationError } from '../domain/service-request.validation';

/**
 * Consulta da fila operacional de solicitacoes.
 *
 * Todo SQL textual desta consulta vive aqui, no plano de persistencia, e nao no servico de
 * aplicacao. Filtros entram SEMPRE como parametro ligado e ordenacao entra SEMPRE por allowlist:
 * nenhum valor vindo do cliente e interpolado na sentenca.
 */

export const SERVICE_REQUEST_LIST_SORTS = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  priority: 'priority',
  desiredStartAt: 'desiredStartAt',
} as const;

export type ServiceRequestListSort = keyof typeof SERVICE_REQUEST_LIST_SORTS;

export type ServiceRequestListDirection = 'asc' | 'desc';

export function isServiceRequestListSort(value: string): value is ServiceRequestListSort {
  return Object.hasOwn(SERVICE_REQUEST_LIST_SORTS, value);
}

export function isServiceRequestListDirection(value: string): value is ServiceRequestListDirection {
  return value === 'asc' || value === 'desc';
}

export type ServiceRequestListFilters = {
  clientId?: string;
  unitId?: string;
  status?: string;
  priority?: string;
  originSource?: string;
  desiredFrom?: string;
  desiredTo?: string;
  search?: string;
  /** Filtro avançado já validado pelo domínio; ausente = sem recorte composto. */
  advanced?: ServiceRequestAdvancedFilter;
};

/**
 * FILTRO AVANÇADO — mesmo contrato publicado em Clientes (`client-list.query.ts`).
 *
 * A forma é a MESMA de propósito: grupos com conjunção interna, ligados por `connector`, campos
 * por allow-list fechado e valores sempre parametrizados. Repetir a forma (e não a semântica de
 * cada domínio) é o que permite uma única conversão no frontend servir todas as entidades.
 */
export const SERVICE_REQUEST_FILTER_FIELDS = {
  status: 'status',
  priority: 'priority',
  originSource: 'originSource',
  requestCode: 'requestCode',
  description: 'description',
  desiredStartAt: 'desiredStartAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
} as const;

export type ServiceRequestFilterField =
  (typeof SERVICE_REQUEST_FILTER_FIELDS)[keyof typeof SERVICE_REQUEST_FILTER_FIELDS];

export const SERVICE_REQUEST_FILTER_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'startsWith',
  'before',
  'after',
] as const;

export type ServiceRequestFilterOperator = (typeof SERVICE_REQUEST_FILTER_OPERATORS)[number];

export type ServiceRequestFilterConnector = 'AND' | 'OR';

export type ServiceRequestFilterCondition = {
  field: ServiceRequestFilterField;
  operator: ServiceRequestFilterOperator;
  value: string;
};

export type ServiceRequestAdvancedFilter = {
  connector: ServiceRequestFilterConnector;
  groups: Array<{ conditions: ServiceRequestFilterCondition[] }>;
};

export const SERVICE_REQUEST_FILTER_MAX_GROUPS = 8;
export const SERVICE_REQUEST_FILTER_MAX_CONDITIONS_PER_GROUP = 8;

const FILTER_FIELD_SET = new Set<string>(Object.values(SERVICE_REQUEST_FILTER_FIELDS));
const FILTER_OPERATOR_SET = new Set<string>(SERVICE_REQUEST_FILTER_OPERATORS);

const TEXT_FILTER_FIELDS = new Set<string>([
  SERVICE_REQUEST_FILTER_FIELDS.requestCode,
  SERVICE_REQUEST_FILTER_FIELDS.description,
]);
const DATE_FILTER_FIELDS = new Set<string>([
  SERVICE_REQUEST_FILTER_FIELDS.desiredStartAt,
  SERVICE_REQUEST_FILTER_FIELDS.createdAt,
  SERVICE_REQUEST_FILTER_FIELDS.updatedAt,
]);

export class ServiceRequestFilterError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

/**
 * Valida UMA condição contra o allow-list de campo e os operadores que o TIPO admite.
 *
 * Condição inválida derruba a requisição em vez de ser descartada: descartar faria a tela exibir um
 * recorte que o servidor não aplicou.
 */
export function parseServiceRequestFilterCondition(
  value: unknown,
): ServiceRequestFilterCondition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceRequestFilterError('filters.conditions');
  }
  const record = value as Record<string, unknown>;
  const field = record['field'];
  const operator = record['operator'];
  const rawValue = record['value'];

  if (typeof field !== 'string' || !FILTER_FIELD_SET.has(field)) {
    throw new ServiceRequestFilterError('filters.field');
  }
  if (typeof operator !== 'string' || !FILTER_OPERATOR_SET.has(operator)) {
    throw new ServiceRequestFilterError('filters.operator');
  }
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new ServiceRequestFilterError('filters.value');
  }

  const trimmed = rawValue.trim();

  if (TEXT_FILTER_FIELDS.has(field)) {
    if (operator === 'before' || operator === 'after') {
      throw new ServiceRequestFilterError('filters.operator');
    }
  } else if (DATE_FILTER_FIELDS.has(field)) {
    if (operator !== 'before' && operator !== 'after') {
      throw new ServiceRequestFilterError('filters.operator');
    }
    if (Number.isNaN(Date.parse(trimmed))) {
      throw new ServiceRequestFilterError('filters.value');
    }
  } else {
    // Campos de enumeração: só igualdade, e contra o vocabulário REAL do domínio.
    if (operator !== 'eq' && operator !== 'neq') {
      throw new ServiceRequestFilterError('filters.operator');
    }
    const valid =
      field === SERVICE_REQUEST_FILTER_FIELDS.status
        ? isServiceRequestStatus(trimmed)
        : field === SERVICE_REQUEST_FILTER_FIELDS.priority
          ? isServiceRequestPriority(trimmed)
          : isServiceRequestOrigin(trimmed);
    if (!valid) {
      throw new ServiceRequestFilterError('filters.value');
    }
  }

  return {
    field: field as ServiceRequestFilterField,
    operator: operator as ServiceRequestFilterOperator,
    value: trimmed,
  };
}

export function parseServiceRequestAdvancedFilter(
  value: unknown,
): ServiceRequestAdvancedFilter | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceRequestFilterError('filters');
  }
  const record = value as Record<string, unknown>;
  const connector = record['connector'];
  if (connector !== 'AND' && connector !== 'OR') {
    throw new ServiceRequestFilterError('filters.connector');
  }
  const groupsRaw = record['groups'];
  if (!Array.isArray(groupsRaw) || groupsRaw.length === 0) {
    return undefined;
  }
  if (groupsRaw.length > SERVICE_REQUEST_FILTER_MAX_GROUPS) {
    throw new ServiceRequestFilterError('filters.groups');
  }

  const groups: ServiceRequestAdvancedFilter['groups'] = [];
  for (const groupRaw of groupsRaw) {
    if (!groupRaw || typeof groupRaw !== 'object' || Array.isArray(groupRaw)) {
      throw new ServiceRequestFilterError('filters.groups');
    }
    const conditionsRaw = (groupRaw as Record<string, unknown>)['conditions'];
    if (!Array.isArray(conditionsRaw) || conditionsRaw.length === 0) {
      continue;
    }
    if (conditionsRaw.length > SERVICE_REQUEST_FILTER_MAX_CONDITIONS_PER_GROUP) {
      throw new ServiceRequestFilterError('filters.groups.conditions');
    }
    groups.push({ conditions: conditionsRaw.map(parseServiceRequestFilterCondition) });
  }

  return groups.length > 0 ? { connector, groups } : undefined;
}

/**
 * Traduz o filtro avançado para SQL parametrizado.
 *
 * O mapa campo→coluna é o único ponto onde um nome lógico vira identificador, e é fechado: o valor
 * recebido nunca é interpolado. Texto usa `ILIKE` com escape de curinga e data faz cast explícito.
 */
function buildAdvancedFilterClause(
  filter: ServiceRequestAdvancedFilter,
  firstParamIndex: number,
): { clause: string; params: unknown[] } | null {
  const params: unknown[] = [];
  const groupClauses: string[] = [];

  for (const group of filter.groups) {
    const conditionClauses: string[] = [];
    for (const condition of group.conditions) {
      const index = firstParamIndex + params.length;
      const built = buildFilterConditionClause(condition, index);
      conditionClauses.push(built.clause);
      params.push(...built.params);
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

function buildFilterConditionClause(
  condition: ServiceRequestFilterCondition,
  paramIndex: number,
): { clause: string; params: unknown[] } {
  const param = `$${paramIndex}`;
  const { field, operator, value } = condition;

  if (field === SERVICE_REQUEST_FILTER_FIELDS.status) {
    return {
      clause: `status ${operator === 'neq' ? '<>' : '='} ${param}::sr.service_request_status`,
      params: [value],
    };
  }
  if (field === SERVICE_REQUEST_FILTER_FIELDS.priority) {
    return {
      clause: `priority ${operator === 'neq' ? '<>' : '='} ${param}::sr.service_request_priority`,
      params: [value],
    };
  }
  if (field === SERVICE_REQUEST_FILTER_FIELDS.originSource) {
    return {
      clause: `origin_source ${operator === 'neq' ? '<>' : '='} ${param}::sr.service_request_origin`,
      params: [value],
    };
  }
  if (field === SERVICE_REQUEST_FILTER_FIELDS.requestCode) {
    return buildTextFilterClause('request_code', operator, value, param);
  }
  if (field === SERVICE_REQUEST_FILTER_FIELDS.description) {
    return buildTextFilterClause('description', operator, value, param);
  }

  const column =
    field === SERVICE_REQUEST_FILTER_FIELDS.desiredStartAt
      ? 'desired_start_at'
      : field === SERVICE_REQUEST_FILTER_FIELDS.updatedAt
        ? 'updated_at'
        : 'created_at';
  return {
    clause: `${column} ${operator === 'before' ? '<' : '>'} ${param}::timestamptz`,
    params: [value],
  };
}

function buildTextFilterClause(
  column: string,
  operator: ServiceRequestFilterOperator,
  value: string,
  param: string,
): { clause: string; params: unknown[] } {
  if (operator === 'eq') {
    return { clause: `${column} = ${param}`, params: [value] };
  }
  if (operator === 'neq') {
    return { clause: `(${column} IS NULL OR ${column} <> ${param})`, params: [value] };
  }
  if (operator === 'startsWith') {
    return { clause: `${column} ILIKE ${param}`, params: [`${escapeLikePattern(value)}%`] };
  }
  return { clause: `${column} ILIKE ${param}`, params: [`%${escapeLikePattern(value)}%`] };
}

export const MAX_SERVICE_REQUEST_SEARCH_LENGTH = 120;

/**
 * Escapa metacaracteres de `LIKE`/`ILIKE`. O caractere de escape padrao do Postgres e `\`,
 * entao nao ha clausula `ESCAPE` — o termo do usuario nunca vira padrao livre.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function buildServiceRequestListWhere(
  scopeFilter: { clause: string; params: unknown[] },
  query: ServiceRequestListFilters,
): { clause: string; params: unknown[] } {
  const clauses = [scopeFilter.clause];
  const params = [...scopeFilter.params];

  if (query.clientId) {
    params.push(query.clientId);
    clauses.push(`client_id = $${params.length}::uuid`);
  }
  if (query.unitId) {
    params.push(query.unitId);
    clauses.push(`unit_id = $${params.length}`);
  }
  if (query.status) {
    if (!isServiceRequestStatus(query.status)) {
      throw new ServiceRequestValidationError('INVALID_LIST_QUERY');
    }
    params.push(query.status);
    clauses.push(`status = $${params.length}::sr.service_request_status`);
  }
  if (query.priority) {
    if (!isServiceRequestPriority(query.priority)) {
      throw new ServiceRequestValidationError('INVALID_LIST_QUERY');
    }
    params.push(query.priority);
    clauses.push(`priority = $${params.length}::sr.service_request_priority`);
  }
  if (query.originSource) {
    if (!isServiceRequestOrigin(query.originSource)) {
      throw new ServiceRequestValidationError('INVALID_LIST_QUERY');
    }
    params.push(query.originSource);
    clauses.push(`origin_source = $${params.length}::sr.service_request_origin`);
  }
  if (query.desiredFrom) {
    params.push(query.desiredFrom);
    clauses.push(`desired_start_at >= $${params.length}::timestamptz`);
  }
  if (query.desiredTo) {
    params.push(query.desiredTo);
    clauses.push(`desired_start_at <= $${params.length}::timestamptz`);
  }
  const search = query.search?.trim();
  if (search) {
    if (search.length > MAX_SERVICE_REQUEST_SEARCH_LENGTH) {
      throw new ServiceRequestValidationError('INVALID_LIST_QUERY');
    }
    params.push(`%${escapeLikePattern(search)}%`);
    clauses.push(
      `(request_code ILIKE $${params.length} OR description ILIKE $${params.length} OR external_origin_reference ILIKE $${params.length})`,
    );
  }

  /*
   * FILTRO AVANÇADO — entra como UM predicado entre os demais, e por isso convive por conjunção
   * com escopo de unidade, cliente, status e busca. Dentro de um grupo a ligação é sempre AND;
   * entre grupos vale o `connector` declarado.
   */
  if (query.advanced) {
    const advanced = buildAdvancedFilterClause(query.advanced, params.length + 1);
    if (advanced) {
      clauses.push(advanced.clause);
      params.push(...advanced.params);
    }
  }

  return { clause: clauses.join(' AND '), params };
}

/**
 * Ordenacao por allowlist.
 *
 * Padrao da fila: mais recentes primeiro (`created_at DESC, id DESC`) — o mesmo desempate estavel
 * que a listagem ja usava, agora explicito. Prioridade e janela desejada ordenam sempre com
 * ausencia por ultimo, porque nao ter prioridade/janela nao e "urgente nem imediato".
 */
export function buildServiceRequestListOrderClause(
  sort: ServiceRequestListSort = 'createdAt',
  direction: ServiceRequestListDirection = 'desc',
): string {
  if (!isServiceRequestListSort(sort) || !isServiceRequestListDirection(direction)) {
    throw new ServiceRequestValidationError('INVALID_LIST_QUERY');
  }

  switch (sort) {
    case 'updatedAt':
      return `updated_at ${direction.toUpperCase()}, id ${direction.toUpperCase()}`;
    case 'priority':
      return [
        `CASE priority`,
        `  WHEN 'URGENT' THEN 4`,
        `  WHEN 'HIGH' THEN 3`,
        `  WHEN 'NORMAL' THEN 2`,
        `  WHEN 'LOW' THEN 1`,
        `  ELSE 0`,
        `END ${direction.toUpperCase()} NULLS LAST`,
        `, created_at DESC, id DESC`,
      ].join('\n');
    case 'desiredStartAt':
      return `desired_start_at ${direction.toUpperCase()} NULLS LAST, created_at DESC, id DESC`;
    case 'createdAt':
    default:
      return `created_at ${direction.toUpperCase()}, id ${direction.toUpperCase()}`;
  }
}

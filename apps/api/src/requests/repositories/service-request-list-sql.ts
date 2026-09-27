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
};

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

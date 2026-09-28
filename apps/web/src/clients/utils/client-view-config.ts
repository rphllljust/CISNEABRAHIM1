import type { SmartListAllowedFilters, SmartListConfig } from '../../operator';
import {
  CLIENT_LIST_DIRECTIONS,
  CLIENT_STATUSES,
  CLIENT_LIST_SORTS,
} from '../types/client.types';
import type { ClientListParams } from './client-list-params';

/**
 * Ponte entre os parâmetros de lista de Clientes e a visão salva.
 *
 * REGRA DE SEGURANÇA: o termo de busca (`q`) NUNCA entra na visão salva.
 * `q` é texto livre digitado pelo operador — normalmente razão social, nome
 * fantasia ou CNPJ. Persistir isso no browser seria gravar dado de negócio
 * localmente, o que a regra da camada proíbe. A visão salva guarda apenas
 * configuração enumerada: status, coluna de ordenação e direção.
 */

export const CLIENT_STATUS_VALUES = [CLIENT_STATUSES.Active, CLIENT_STATUSES.Inactive] as const;
export const CLIENT_SORT_VALUES = [
  CLIENT_LIST_SORTS.LegalName,
  CLIENT_LIST_SORTS.UpdatedAt,
] as const;

export const CLIENTS_ALLOWED_FILTERS: SmartListAllowedFilters = {
  filters: { status: CLIENT_STATUS_VALUES },
  sortKeys: CLIENT_SORT_VALUES,
};

/** Configuração persistível a partir dos filtros atuais — sem `q`. */
export function clientViewConfig(filters: ClientListParams): SmartListConfig {
  return {
    filters: filters.status ? { status: filters.status } : {},
    sortKey: filters.sort,
    sortDirection: filters.direction,
    groupKey: null,
  };
}

/** Direção/ordenação padrão da lista, para decidir se há visão a salvar. */
const DEFAULT_SORT = CLIENT_LIST_SORTS.LegalName;
const DEFAULT_DIRECTION = CLIENT_LIST_DIRECTIONS.Asc;

/** Há algo persistível para salvar? `q` sozinho não conta. */
export function hasSavableViewConfig(filters: ClientListParams): boolean {
  return (
    filters.status !== '' ||
    filters.sort !== DEFAULT_SORT ||
    filters.direction !== DEFAULT_DIRECTION
  );
}

/** Converte uma visão salva de volta em parâmetros de lista (sem `q`). */
export function clientViewToParams(view: SmartListConfig): Partial<ClientListParams> {
  const status = view.filters.status;
  return {
    status: (CLIENT_STATUS_VALUES as readonly string[]).includes(status ?? '')
      ? (status as ClientListParams['status'])
      : '',
    sort: view.sortKey
      ? (view.sortKey as ClientListParams['sort'])
      : DEFAULT_SORT,
    direction: view.sortDirection,
    // O termo de busca é deliberadamente preservado fora da visão: aplicar uma
    // visão não apaga nem injeta texto livre do operador.
  };
}

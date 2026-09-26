import {
  CLIENT_LIST_DIRECTIONS,
  CLIENT_LIST_SORTS,
  CLIENT_STATUSES,
  PURCHASE_ORDER_REQUIREMENTS,
  type ClientListDirection,
  type ClientListSort,
  type ClientStatus,
  type PurchaseOrderRequirement,
} from '../types/client.types';

/**
 * Estado da listagem de Clientes serializado na URL.
 *
 * Mesmo desenho de `service-orders/utils/service-order-list-params.ts`: busca, filtros, ordenação e
 * página vivem na query string, de modo que recarregar não perde contexto, o botão voltar funciona
 * e o link é compartilhável. Valores não reconhecidos caem para o padrão em vez de quebrar a tela —
 * um link antigo ou adulterado abre a listagem, não um erro.
 */
export type ClientListParams = {
  q: string;
  status: '' | ClientStatus;
  purchaseOrderRequirement: '' | PurchaseOrderRequirement;
  sort: ClientListSort;
  direction: ClientListDirection;
};

export const EMPTY_CLIENT_LIST_PARAMS: ClientListParams = {
  q: '',
  status: '',
  purchaseOrderRequirement: '',
  sort: CLIENT_LIST_SORTS.LegalName,
  direction: CLIENT_LIST_DIRECTIONS.Asc,
};

function isClientStatus(value: string): value is ClientStatus {
  return value === CLIENT_STATUSES.Active || value === CLIENT_STATUSES.Inactive;
}

function isPurchaseOrderRequirement(value: string): value is PurchaseOrderRequirement {
  return (Object.values(PURCHASE_ORDER_REQUIREMENTS) as string[]).includes(value);
}

function isClientListSort(value: string): value is ClientListSort {
  return (Object.values(CLIENT_LIST_SORTS) as string[]).includes(value);
}

function isClientListDirection(value: string): value is ClientListDirection {
  return value === CLIENT_LIST_DIRECTIONS.Asc || value === CLIENT_LIST_DIRECTIONS.Desc;
}

export function parseClientListParams(searchParams: URLSearchParams): ClientListParams {
  const status = searchParams.get('status') ?? '';
  const requirement = searchParams.get('purchaseOrderRequirement') ?? '';
  const sort = searchParams.get('sort') ?? '';
  const direction = searchParams.get('direction') ?? '';

  return {
    q: searchParams.get('q') ?? '',
    status: isClientStatus(status) ? status : '',
    purchaseOrderRequirement: isPurchaseOrderRequirement(requirement) ? requirement : '',
    sort: isClientListSort(sort) ? sort : EMPTY_CLIENT_LIST_PARAMS.sort,
    direction: isClientListDirection(direction) ? direction : EMPTY_CLIENT_LIST_PARAMS.direction,
  };
}

export function buildClientListSearchParams(
  params: ClientListParams,
  offset = 0,
): URLSearchParams {
  const search = new URLSearchParams();
  if (params.q.trim()) {
    search.set('q', params.q.trim());
  }
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.purchaseOrderRequirement) {
    search.set('purchaseOrderRequirement', params.purchaseOrderRequirement);
  }
  // Ordenação padrão é omitida da URL: mantém o endereço limpo e o link curto no caso comum.
  if (params.sort !== EMPTY_CLIENT_LIST_PARAMS.sort) {
    search.set('sort', params.sort);
  }
  if (params.direction !== EMPTY_CLIENT_LIST_PARAMS.direction) {
    search.set('direction', params.direction);
  }
  if (offset > 0) {
    search.set('offset', String(offset));
  }
  return search;
}

export function buildClientsListHref(params: Partial<ClientListParams>): string {
  const search = buildClientListSearchParams({ ...EMPTY_CLIENT_LIST_PARAMS, ...params });
  const query = search.toString();
  return query ? `/app/clients?${query}` : '/app/clients';
}

/** Há algum filtro ou ordenação não padrão aplicado? Decide se "Limpar" aparece. */
export function hasActiveClientListFilters(params: ClientListParams): boolean {
  return Boolean(
    params.q.trim() ||
      params.status ||
      params.purchaseOrderRequirement ||
      params.sort !== EMPTY_CLIENT_LIST_PARAMS.sort ||
      params.direction !== EMPTY_CLIENT_LIST_PARAMS.direction,
  );
}

/**
 * Próxima ordenação ao clicar no cabeçalho da coluna.
 *
 * Clicar na coluna já ativa inverte a direção; clicar em outra coluna começa ascendente, exceto
 * "última atualização", cujo interesse imediato é sempre o mais recente.
 */
export function toggleClientListSort(
  current: ClientListParams,
  column: ClientListSort,
): Pick<ClientListParams, 'sort' | 'direction'> {
  if (current.sort === column) {
    return {
      sort: column,
      direction:
        current.direction === CLIENT_LIST_DIRECTIONS.Asc
          ? CLIENT_LIST_DIRECTIONS.Desc
          : CLIENT_LIST_DIRECTIONS.Asc,
    };
  }
  return {
    sort: column,
    direction:
      column === CLIENT_LIST_SORTS.UpdatedAt
        ? CLIENT_LIST_DIRECTIONS.Desc
        : CLIENT_LIST_DIRECTIONS.Asc,
  };
}

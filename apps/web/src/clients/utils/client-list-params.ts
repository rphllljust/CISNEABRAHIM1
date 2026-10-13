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
import {
  advancedFilterFromGroup,
  type AdvancedFilterFieldSpec,
  type AdvancedFilterPayload,
  type FilterGroup,
} from '../../engine';

/**
 * Estado da listagem de Clientes serializado na URL.
 *
 * Mesmo desenho de `service-orders/utils/service-order-list-params.ts`: busca, filtros, ordenação e
 * página vivem na query string, de modo que recarregar não perde contexto, o botão voltar funciona
 * e o link é compartilhável. Valores não reconhecidos caem para o padrão em vez de quebrar a tela —
 * um link antigo ou adulterado abre a listagem, não um erro.
 */

/**
 * Piso de busca do cadastro de Clientes, idêntico ao publicado pelo backend.
 *
 * `apps/api/src/clients/domain/client-list.query.ts` responde 400 para `q` com menos de
 * `CLIENT_SEARCH_MIN_LENGTH` caracteres. Um termo abaixo do piso não é uma busca recusada: é uma
 * busca que ainda não começou — a mesma política de `GlobalSearchBar`/`useGlobalSearch`, que só
 * consultam a partir de 2 caracteres. Enviá-lo trocaria a listagem por uma tela de erro no meio da
 * digitação, que é justamente o caminho normal de quem procura um Cliente.
 */
export const CLIENT_SEARCH_MIN_LENGTH = 2;

/** O termo já pode viajar como busca? Vazio (sem busca) ou a partir do piso publicado. */
export function isApplicableClientSearchTerm(term: string): boolean {
  const trimmed = term.trim();
  return trimmed.length === 0 || trimmed.length >= CLIENT_SEARCH_MIN_LENGTH;
}
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

/**
 * FILTRO AVANÇADO NO ESTADO DA URL — mesma chave que a engine já usa (`FILTER_PARAM = 'filter'`).
 *
 * A árvore vive na URL pelo mesmo motivo que busca e ordenação vivem: recarregar não perde
 * contexto, o botão voltar funciona e o link é compartilhável. Nenhum mecanismo novo de
 * persistência — é o `filterGroupToQuery`/`readFilterGroup` da própria engine de metadados.
 */
export const CLIENT_ADVANCED_FILTER_PARAM = 'filters';

/**
 * ESPECIFICAÇÃO DOS CAMPOS DE CLIENTES PARA O CONVERSOR COMPARTILHADO.
 *
 * O allow-list aqui é o MESMO publicado por `buildAdvancedFilterClause` no backend. O conversor
 * (`engine/advanced-filter-contract`) é um só para todas as entidades; o que muda por módulo é
 * apenas este mapa.
 */
const CLIENT_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { field: 'status', contractField: 'status', kind: 'enum' },
  { field: 'purchase_order_requirement', contractField: 'purchaseOrderRequirement', kind: 'enum' },
  { field: 'legal_name', contractField: 'legalName', kind: 'text' },
  { field: 'trade_name', contractField: 'tradeName', kind: 'text' },
  { field: 'normalized_tax_id', contractField: 'taxId', kind: 'text' },
  { field: 'updated_at', contractField: 'updatedAt', kind: 'date' },
  { field: 'created_at', contractField: 'createdAt', kind: 'date' },
];

/**
 * Converte a árvore da engine no payload do contrato de Clientes.
 *
 * Delega ao conversor compartilhado: nenhuma regra de tradução vive aqui além do mapa de campos.
 */
export function clientAdvancedFilterFromGroup(group: FilterGroup): AdvancedFilterPayload | null {
  return advancedFilterFromGroup(group, CLIENT_FILTER_SPECS);
}

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
  const q = searchParams.get('q') ?? '';

  return {
    // Termo abaixo do piso é descartado como qualquer outro valor inválido desta URL: mantê-lo
    // faria a tela pedir ao backend uma busca que ele recusa com 400 — inclusive ao abrir um link
    // antigo ou voltar pelo histórico.
    q: isApplicableClientSearchTerm(q) ? q : '',
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
  const term = params.q.trim();
  if (term && isApplicableClientSearchTerm(term)) {
    search.set('q', term);
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

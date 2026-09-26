import type { ScopeSqlPredicate } from '../../authorization/services/scope-enforcement.service';
import {
  escapeLikeWildcards,
  normalizeSearchQuery,
} from '../../search/domain/search-query-normalizer';
import {
  isPurchaseOrderRequirement,
  type ClientStatus,
  type PurchaseOrderRequirement,
} from './client-status';

/**
 * Contrato de listagem de Clientes (master data central do CISNE).
 *
 * Fonte única de verdade para interpretar `GET /api/v1/clients`, no mesmo formato de
 * `service-orders/domain/service-order-list.query.ts`: o domínio decide o que é aceito e traduz
 * isso para SQL; a camada HTTP apenas mapeia o erro de campo para 400.
 *
 * Paginação: OFFSET, não cursor. O cadastro de Clientes é um master data cujo consumidor é uma
 * listagem administrativa com salto direto de página e link compartilhável — o cursor não traz
 * ganho aqui e quebraria o contrato `limit`/`offset` já publicado. As três consultas de leitura
 * usam o mesmo predicado, então o total e a página nunca divergem.
 */

/**
 * Ordenações oferecidas — apenas as que têm caminho de índice provado.
 *
 * `createdAt` foi deliberadamente NÃO oferecido: sem índice próprio a ordenação por data de
 * cadastro força varredura completa + ordenação de toda a tabela (medido em 328 ms para 50 mil
 * Clientes, contra 0,4 ms da ordenação por `updatedAt`, que é indexada). Oferecer um controle de
 * ordenação sabidamente lento, ou criar um quarto índice cujo único uso seria essa ordenação, são
 * ambos piores do que não oferecer a opção. A decisão fica registrada com a medida para ser
 * revisitada de forma deliberada, e `createdAt` continua sendo devolvido no resumo.
 */
export const CLIENT_LIST_SORTS = {
  LegalName: 'legalName',
  UpdatedAt: 'updatedAt',
} as const;

export type ClientListSort = (typeof CLIENT_LIST_SORTS)[keyof typeof CLIENT_LIST_SORTS];

export const CLIENT_LIST_DIRECTIONS = {
  Asc: 'asc',
  Desc: 'desc',
} as const;

export type ClientListDirection =
  (typeof CLIENT_LIST_DIRECTIONS)[keyof typeof CLIENT_LIST_DIRECTIONS];

/**
 * Ordem padrão: razão social ascendente.
 *
 * O master data de Clientes é consultado como diretório ("quem é esse CNPJ?"), não como fila de
 * cadastro. Ordenar por data de criação crescente empurrava todo Cliente recém-cadastrado para a
 * última página, o que contradiz o objetivo de encontrá-lo rapidamente. `createdAt`/`updatedAt`
 * continuam disponíveis como ordenação explícita.
 */
export const DEFAULT_CLIENT_LIST_SORT: ClientListSort = CLIENT_LIST_SORTS.LegalName;
export const DEFAULT_CLIENT_LIST_DIRECTION: ClientListDirection = CLIENT_LIST_DIRECTIONS.Asc;

export const CLIENT_LIST_DEFAULT_LIMIT = 20;
export const CLIENT_LIST_MAX_LIMIT = 100;

/**
 * Piso de busca: 2 caracteres (mesma política do restante da plataforma).
 *
 * Limitação conhecida e assumida: um termo de 2 caracteres não gera nenhum trigrama útil para o
 * índice GIN `gin_trgm_ops`, então esse caso específico degrada para varredura. Elevar o piso
 * reduziria a capacidade de localizar por prefixo de documento curto; a decisão é manter 2 e
 * registrar o comportamento em vez de recusar uma busca legítima.
 */
export const CLIENT_SEARCH_MIN_LENGTH = 2;
export const CLIENT_SEARCH_MAX_LENGTH = 120;

export type ListClientsQuery = {
  q?: string;
  status?: ClientStatus;
  purchaseOrderRequirement?: PurchaseOrderRequirement;
  sort: ClientListSort;
  direction: ClientListDirection;
  limit: number;
  offset: number;
};

/**
 * Consulta ainda sem os defaults de ordenação aplicados.
 *
 * É a forma aceita na borda do módulo (HTTP e chamadas internas), para que quem lista não precise
 * repetir a ordem padrão do domínio. `resolveClientListQuery` é o ÚNICO ponto que aplica defaults,
 * de modo que parser HTTP e serviço não possam divergir.
 */
export type ClientListRequest = Omit<ListClientsQuery, 'sort' | 'direction'> & {
  sort?: ClientListSort;
  direction?: ClientListDirection;
};

export type ClientListSqlParts = {
  whereClause: string;
  params: unknown[];
  orderBy: string;
};

export class ClientListQueryError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

const SORT_SET = new Set<string>(Object.values(CLIENT_LIST_SORTS));
const DIRECTION_SET = new Set<string>(Object.values(CLIENT_LIST_DIRECTIONS));
const STATUS_SET = new Set<string>(['ACTIVE', 'INACTIVE']);

/**
 * Ordenação por allow-list, nunca por interpolação do valor recebido: o `sort` do cliente HTTP
 * jamais alcança a cláusula ORDER BY como texto.
 */
const ORDER_BY_COLUMN: Record<ClientListSort, string> = {
  legalName: 'c.legal_name',
  updatedAt: 'c.updated_at',
};

const DOCUMENT_LIKE = /^[\d.\-/\s]+$/;

function readString(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ClientListQueryError(key);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPositiveInt(
  query: Record<string, unknown>,
  key: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const raw = query[key];
  if (raw === undefined) {
    return fallback;
  }
  const parsed =
    typeof raw === 'number' && Number.isInteger(raw)
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw)
        ? Number.parseInt(raw, 10)
        : null;
  if (parsed === null || parsed < min || parsed > max) {
    throw new ClientListQueryError(key);
  }
  return parsed;
}

export function parseListClientsQuery(query: Record<string, unknown>): ClientListRequest {
  const status = readString(query, 'status');
  const purchaseOrderRequirement = readString(query, 'purchaseOrderRequirement');
  const sort = readString(query, 'sort');
  const direction = readString(query, 'direction');
  const q = readString(query, 'q');

  if (status !== undefined && !STATUS_SET.has(status)) {
    throw new ClientListQueryError('status');
  }
  if (
    purchaseOrderRequirement !== undefined &&
    !isPurchaseOrderRequirement(purchaseOrderRequirement)
  ) {
    throw new ClientListQueryError('purchaseOrderRequirement');
  }
  if (sort !== undefined && !SORT_SET.has(sort)) {
    throw new ClientListQueryError('sort');
  }
  if (direction !== undefined && !DIRECTION_SET.has(direction)) {
    throw new ClientListQueryError('direction');
  }
  if (q !== undefined && q.length < CLIENT_SEARCH_MIN_LENGTH) {
    throw new ClientListQueryError('q');
  }

  return {
    q: q === undefined ? undefined : q.slice(0, CLIENT_SEARCH_MAX_LENGTH),
    status: status as ClientStatus | undefined,
    // Sem cast: `isPurchaseOrderRequirement` é predicado de tipo, então o guard acima já
    // estreitou o valor para `PurchaseOrderRequirement | undefined`.
    purchaseOrderRequirement,
    sort: sort as ClientListSort | undefined,
    direction: direction as ClientListDirection | undefined,
    limit: readPositiveInt(query, 'limit', CLIENT_LIST_DEFAULT_LIMIT, {
      min: 1,
      max: CLIENT_LIST_MAX_LIMIT,
    }),
    offset: readPositiveInt(query, 'offset', 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
  };
}

/** Ponto único de aplicação dos defaults de listagem. Idempotente. */
export function resolveClientListQuery(request: ClientListRequest): ListClientsQuery {
  return {
    ...request,
    sort: request.sort ?? DEFAULT_CLIENT_LIST_SORT,
    direction: request.direction ?? DEFAULT_CLIENT_LIST_DIRECTION,
  };
}

/**
 * Qualifica com o alias `c` as colunas que o predicado de escopo emite sem alias (`id`).
 *
 * `\bid\b` não casa dentro de `client_id` porque `_` é caractere de palavra — o mesmo cuidado do
 * `buildServiceOrderListSqlParts`.
 */
function qualifyClientScope(clause: string): string {
  return clause.replace(/\bid\b/g, 'c.id').replace(/\bstatus\b/g, 'c.status');
}

export function buildClientListSqlParts(
  query: ListClientsQuery,
  scope: ScopeSqlPredicate,
): ClientListSqlParts {
  const orderBy = buildClientListOrderBy(query);

  if (scope.clause === 'FALSE') {
    return { whereClause: 'FALSE', params: [], orderBy };
  }

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (scope.clause !== 'TRUE') {
    params.push(...scope.params);
    clauses.push(qualifyClientScope(scope.clause));
  }

  if (query.status) {
    params.push(query.status);
    clauses.push(`c.status = $${params.length}::"pty"."client_status"`);
  }

  if (query.purchaseOrderRequirement) {
    params.push(query.purchaseOrderRequirement);
    clauses.push(`c.purchase_order_requirement = $${params.length}::"pty"."purchase_order_requirement"`);
  }

  if (query.q) {
    const search = buildClientSearchClause(query.q, params.length + 1);
    if (search) {
      clauses.push(search.clause);
      params.push(...search.params);
    }
  }

  return {
    whereClause: clauses.length > 0 ? clauses.join(' AND ') : 'TRUE',
    params,
    orderBy,
  };
}

export function buildClientListOrderBy(query: ListClientsQuery): string {
  return `${ORDER_BY_COLUMN[query.sort]} ${query.direction.toUpperCase()}, c.id ${query.direction.toUpperCase()}`;
}

/**
 * Traduz o termo digitado para um predicado indexável, reaproveitando o normalizador canônico da
 * plataforma (UUID / CNPJ / código / texto) para que a busca da lista e a busca global concordem
 * sobre o que é um Cliente.
 *
 * Duas decisões próprias do contexto Clientes:
 *
 * 1. **Prefixo de documento.** `normalizeSearchQuery` só reconhece CNPJ com 14 dígitos. Digitar
 *    parte do CNPJ é o caminho mais natural de identificação ("11.222.333") e cairia em busca por
 *    nome — nunca encontraria o documento. Termos compostos só por dígitos/separadores com menos
 *    de 14 dígitos viram prefixo sobre `normalized_tax_id`.
 * 2. **Nunca "nenhum filtro".** Termo que o normalizador não classifica (inclusive o caso de 2
 *    caracteres, para o qual ele devolve `null`) cai na busca por nome. Devolver nenhuma cláusula
 *    faria a busca ser silenciosamente ignorada e a lista devolver todos os Clientes.
 */
export function buildClientSearchClause(
  rawSearch: string,
  firstParamIndex: number,
): { clause: string; params: unknown[] } | null {
  const digits = rawSearch.replace(/\D/g, '');
  const isDocumentPrefix =
    DOCUMENT_LIKE.test(rawSearch) &&
    digits.length >= CLIENT_SEARCH_MIN_LENGTH &&
    digits.length < 14;

  if (isDocumentPrefix) {
    return {
      clause: `c.normalized_tax_id LIKE $${firstParamIndex}`,
      params: [`${digits}%`],
    };
  }

  const normalized = normalizeSearchQuery(rawSearch);

  if (normalized?.kind === 'uuid') {
    return { clause: `c.id = $${firstParamIndex}::uuid`, params: [normalized.term] };
  }

  if (normalized?.kind === 'cnpj') {
    return { clause: `c.normalized_tax_id = $${firstParamIndex}`, params: [normalized.term] };
  }

  if (normalized?.kind === 'code') {
    return {
      clause: `c.external_erp_id ILIKE $${firstParamIndex} ESCAPE '\\'`,
      params: [normalized.prefixTerm],
    };
  }

  // Busca por nome usa o termo COMO DIGITADO, não o transformado pelo normalizador.
  //
  // O normalizador canônico existe para identificar placas e códigos empresariais: ele remove
  // espaços e converte para maiúsculas, e classifica como `plate` qualquer termo de exatamente 7
  // caracteres alfanuméricos — o que inclui palavras comuns de razão social ("Madeira",
  // "Vilhena"). Aplicar essa transformação a um nome pesquisado pesquisaria um termo que o usuário
  // não digitou. `ILIKE` e a similaridade de trigrama já são insensíveis a caixa, então preservar o
  // original é ao mesmo tempo mais fiel e funcionalmente equivalente.
  return buildClientNameClause(rawSearch, firstParamIndex);
}

function buildClientNameClause(
  term: string,
  firstParamIndex: number,
): { clause: string; params: unknown[] } {
  const containsParam = `$${firstParamIndex + 1}`;
  return {
    clause: `(c.legal_name % $${firstParamIndex}::text
        OR c.trade_name % $${firstParamIndex}::text
        OR c.legal_name ILIKE ${containsParam} ESCAPE '\\'
        OR c.trade_name ILIKE ${containsParam} ESCAPE '\\')`,
    params: [term, `%${escapeLikeWildcards(term)}%`],
  };
}

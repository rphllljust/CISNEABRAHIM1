import { isPurchaseOrderStatus } from '../domain/purchase-order';
import {
  parseAdvancedFilter,
  type AdvancedFilter,
  type AdvancedFilterFieldSpec,
} from '../../infrastructure/http/contracts/advanced-filter-query';

/**
 * CONSULTA DA FILA DE PEDIDOS DE COMPRA.
 *
 * Mesmo desenho de `proposal-list-sql.ts`: todo o SQL textual vive no plano de persistência,
 * filtros entram SEMPRE como parâmetro ligado e ordenação entra SEMPRE por allow-list explícita.
 * Nenhum valor vindo do cliente é interpolado.
 *
 * A camada existia incompleta: o serviço montava `clauses`/`params` inline e aceitava apenas
 * `clientId`/`unitId`, sem busca, sem enumerações, sem recorte de data e sem ordenação. O
 * repositório já recebia `whereClause`/`params`, então a lacuna era de PROJEÇÃO e CONTRATO — não
 * de acesso a dados.
 */

export class PurchaseOrderListQueryError extends Error {
  constructor() {
    super('INVALID_LIST_QUERY');
  }
}

export const PURCHASE_ORDER_LIST_SORTS = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  issueDate: 'issueDate',
  totalAmount: 'totalAmount',
} as const;

export type PurchaseOrderListSort = keyof typeof PURCHASE_ORDER_LIST_SORTS;
export type PurchaseOrderListDirection = 'asc' | 'desc';

export function isPurchaseOrderListSort(value: string): value is PurchaseOrderListSort {
  return Object.hasOwn(PURCHASE_ORDER_LIST_SORTS, value);
}

export function isPurchaseOrderListDirection(
  value: string,
): value is PurchaseOrderListDirection {
  return value === 'asc' || value === 'desc';
}

export type PurchaseOrderListFilters = {
  clientId?: string;
  unitId?: string;
  status?: string;
  currencyCode?: string;
  issueFrom?: string;
  issueTo?: string;
  search?: string;
  /** Filtro avançado já validado; ausente = sem recorte composto. */
  advanced?: PurchaseOrderAdvancedFilter;
};

export const MAX_PURCHASE_ORDER_SEARCH_LENGTH = 120;

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * ESPECIFICAÇÃO DOS CAMPOS PARA O PARSER GENÉRICO.
 *
 * A validação de forma vive em `infrastructure/http/contracts/advanced-filter-query`; aqui fica só
 * o que é próprio do domínio: quais campos existem, de que família são e o vocabulário aceito.
 */
export const PURCHASE_ORDER_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { name: 'internalCode', kind: 'text' },
  { name: 'poNumber', kind: 'text' },
  { name: 'rcNumber', kind: 'text' },
  { name: 'currencyCode', kind: 'text' },
  { name: 'status', kind: 'enum', isValidEnumValue: isPurchaseOrderStatus },
  { name: 'issueDate', kind: 'date' },
  { name: 'createdAt', kind: 'date' },
  { name: 'updatedAt', kind: 'date' },
];

export type PurchaseOrderAdvancedFilter = AdvancedFilter;

export function parsePurchaseOrderAdvancedFilter(
  value: unknown,
): PurchaseOrderAdvancedFilter | undefined {
  return parseAdvancedFilter(value, PURCHASE_ORDER_FILTER_SPECS);
}

export function buildPurchaseOrderListWhere(
  scopeFilter: { clause: string; params: unknown[] },
  query: PurchaseOrderListFilters,
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
    if (!isPurchaseOrderStatus(query.status)) {
      throw new PurchaseOrderListQueryError();
    }
    params.push(query.status);
    clauses.push(`status = $${params.length}::com.purchase_order_status`);
  }
  if (query.currencyCode) {
    params.push(query.currencyCode);
    clauses.push(`currency_code = $${params.length}`);
  }
  if (query.issueFrom) {
    params.push(query.issueFrom);
    clauses.push(`issue_date >= $${params.length}::timestamptz`);
  }
  if (query.issueTo) {
    params.push(query.issueTo);
    clauses.push(`issue_date <= $${params.length}::timestamptz`);
  }
  const search = query.search?.trim();
  if (search) {
    if (search.length > MAX_PURCHASE_ORDER_SEARCH_LENGTH) {
      throw new PurchaseOrderListQueryError();
    }
    params.push(`%${escapeLikePattern(search)}%`);
    clauses.push(
      `(po_number ILIKE $${params.length} OR internal_code ILIKE $${params.length} OR rc_number ILIKE $${params.length})`,
    );
  }

  // Filtro avançado entra como UM predicado entre os demais, convivendo por conjunção com escopo
  // de unidade, cliente, status, moeda, janela de emissão e busca.
  if (query.advanced) {
    const advanced = buildPurchaseOrderAdvancedClause(query.advanced, params.length + 1);
    if (advanced) {
      clauses.push(advanced.clause);
      params.push(...advanced.params);
    }
  }

  return { clause: clauses.join(' AND '), params };
}

function buildPurchaseOrderAdvancedClause(
  filter: PurchaseOrderAdvancedFilter,
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
          `status ${operator === 'neq' ? '<>' : '='} ${param}::com.purchase_order_status`,
        );
        params.push(value);
      } else if (field === 'issueDate' || field === 'createdAt' || field === 'updatedAt') {
        const column =
          field === 'issueDate' ? 'issue_date' : field === 'updatedAt' ? 'updated_at' : 'created_at';
        conditionClauses.push(`${column} ${operator === 'before' ? '<' : '>'} ${param}::timestamptz`);
        params.push(value);
      } else {
        const column =
          field === 'poNumber'
            ? 'po_number'
            : field === 'rcNumber'
              ? 'rc_number'
              : field === 'currencyCode'
                ? 'currency_code'
                : 'internal_code';
        const built = buildPurchaseOrderTextClause(column, operator, value, param);
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

function buildPurchaseOrderTextClause(
  column: string,
  operator: string,
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

/**
 * Ordenação por allow-list.
 *
 * Padrão: mais recentes primeiro, com desempate estável por `id`. Valor total e data de emissão
 * ordenam com ausência por último — não ter valor não é "o menor valor".
 */
export function buildPurchaseOrderListOrderClause(
  sort: PurchaseOrderListSort = 'createdAt',
  direction: PurchaseOrderListDirection = 'desc',
): string {
  if (!isPurchaseOrderListSort(sort) || !isPurchaseOrderListDirection(direction)) {
    throw new PurchaseOrderListQueryError();
  }
  const dir = direction.toUpperCase();

  switch (sort) {
    case 'updatedAt':
      return `updated_at ${dir}, id ${dir}`;
    case 'issueDate':
      return `issue_date ${dir} NULLS LAST, created_at DESC, id DESC`;
    case 'totalAmount':
      return `total_amount ${dir} NULLS LAST, created_at DESC, id DESC`;
    case 'createdAt':
    default:
      return `created_at ${dir}, id ${dir}`;
  }
}

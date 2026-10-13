import { isContractStatus } from '../domain/contract';
import {
  parseAdvancedFilter,
  type AdvancedFilter,
  type AdvancedFilterFieldSpec,
} from '../../infrastructure/http/contracts/advanced-filter-query';

/**
 * CONSULTA DA ÁREA DE TRABALHO DE CONTRATOS.
 *
 * Mesmo desenho de `proposal-list-sql.ts` e `purchase-order-list-sql.ts`: todo o SQL textual vive
 * no plano de persistência, filtros entram SEMPRE como parâmetro ligado e ordenação entra SEMPRE
 * por allow-list explícita.
 *
 * A camada estava incompleta: o serviço montava `clauses`/`params` inline e aceitava apenas
 * `clientId`/`unitId`, sem busca, enumeração, janela de vigência ou ordenação. O repositório já
 * recebia `whereClause`/`params`, então a lacuna era de CONTRATO, não de acesso a dados.
 *
 * VIGÊNCIA é o recorte mais importante deste domínio: um contrato tem `valid_from` (obrigatório) e
 * `valid_to` (opcional — prazo indeterminado). A janela é sobreposta, não contida: um contrato
 * "vigente em 2026" é aquele cujo intervalo INTERSECTA o ano, não o que começa dentro dele.
 */

export class ContractListQueryError extends Error {
  constructor() {
    super('INVALID_LIST_QUERY');
  }
}

export const CONTRACT_LIST_SORTS = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  validFrom: 'validFrom',
  validTo: 'validTo',
} as const;

export type ContractListSort = keyof typeof CONTRACT_LIST_SORTS;
export type ContractListDirection = 'asc' | 'desc';

export function isContractListSort(value: string): value is ContractListSort {
  return Object.hasOwn(CONTRACT_LIST_SORTS, value);
}

export function isContractListDirection(value: string): value is ContractListDirection {
  return value === 'asc' || value === 'desc';
}

export type ContractListFilters = {
  clientId?: string;
  unitId?: string;
  status?: string;
  currencyCode?: string;
  /** Recorte de vigência: contratos cujo intervalo INTERSECTA [from, to]. */
  effectiveFrom?: string;
  effectiveTo?: string;
  search?: string;
  /** Filtro avançado já validado; ausente = sem recorte composto. */
  advanced?: ContractAdvancedFilter;
};

export const MAX_CONTRACT_SEARCH_LENGTH = 120;

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export const CONTRACT_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { name: 'internalCode', kind: 'text' },
  { name: 'contractNumber', kind: 'text' },
  { name: 'title', kind: 'text' },
  { name: 'currencyCode', kind: 'text' },
  { name: 'status', kind: 'enum', isValidEnumValue: isContractStatus },
  { name: 'validFrom', kind: 'date' },
  { name: 'validTo', kind: 'date' },
  { name: 'createdAt', kind: 'date' },
  { name: 'updatedAt', kind: 'date' },
];

export type ContractAdvancedFilter = AdvancedFilter;

export function parseContractAdvancedFilter(value: unknown): ContractAdvancedFilter | undefined {
  return parseAdvancedFilter(value, CONTRACT_FILTER_SPECS);
}

export function buildContractListWhere(
  scopeFilter: { clause: string; params: unknown[] },
  query: ContractListFilters,
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
    if (!isContractStatus(query.status)) {
      throw new ContractListQueryError();
    }
    params.push(query.status);
    clauses.push(`status = $${params.length}::com.contract_status`);
  }
  if (query.currencyCode) {
    params.push(query.currencyCode);
    clauses.push(`currency_code = $${params.length}`);
  }

  /*
   * VIGÊNCIA POR SOBREPOSIÇÃO.
   *
   * `valid_to IS NULL` significa prazo INDETERMINADO — o contrato segue vigente. Tratá-lo como
   * "sem data" o excluiria de todo recorte de vigência, que é exatamente o contrato mais relevante
   * para a pergunta "o que está vigente agora?". A cláusula cobre os dois casos.
   */
  if (query.effectiveFrom) {
    params.push(query.effectiveFrom);
    clauses.push(`(valid_to IS NULL OR valid_to >= $${params.length}::date)`);
  }
  if (query.effectiveTo) {
    params.push(query.effectiveTo);
    clauses.push(`valid_from <= $${params.length}::date`);
  }

  const search = query.search?.trim();
  if (search) {
    if (search.length > MAX_CONTRACT_SEARCH_LENGTH) {
      throw new ContractListQueryError();
    }
    params.push(`%${escapeLikePattern(search)}%`);
    clauses.push(
      `(contract_number ILIKE $${params.length} OR internal_code ILIKE $${params.length} OR title ILIKE $${params.length})`,
    );
  }

  if (query.advanced) {
    const advanced = buildContractAdvancedClause(query.advanced, params.length + 1);
    if (advanced) {
      clauses.push(advanced.clause);
      params.push(...advanced.params);
    }
  }

  return { clause: clauses.join(' AND '), params };
}

function buildContractAdvancedClause(
  filter: ContractAdvancedFilter,
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
          `status ${operator === 'neq' ? '<>' : '='} ${param}::com.contract_status`,
        );
        params.push(value);
      } else if (field === 'validFrom' || field === 'validTo') {
        const column = field === 'validFrom' ? 'valid_from' : 'valid_to';
        conditionClauses.push(`${column} ${operator === 'before' ? '<' : '>'} ${param}::date`);
        params.push(value);
      } else if (field === 'createdAt' || field === 'updatedAt') {
        const column = field === 'updatedAt' ? 'updated_at' : 'created_at';
        conditionClauses.push(`${column} ${operator === 'before' ? '<' : '>'} ${param}::timestamptz`);
        params.push(value);
      } else {
        const column =
          field === 'contractNumber'
            ? 'contract_number'
            : field === 'title'
              ? 'title'
              : field === 'currencyCode'
                ? 'currency_code'
                : 'internal_code';
        const built = buildContractTextClause(column, operator, value, param);
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

function buildContractTextClause(
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
 * Padrão: vigência mais recente primeiro (`valid_from DESC`), porque a pergunta operacional do
 * domínio é "qual contrato rege o trabalho agora". `valid_to` ordena com ausência por último — prazo
 * indeterminado não é "o que termina antes".
 */
export function buildContractListOrderClause(
  sort: ContractListSort = 'validFrom',
  direction: ContractListDirection = 'desc',
): string {
  if (!isContractListSort(sort) || !isContractListDirection(direction)) {
    throw new ContractListQueryError();
  }
  const dir = direction.toUpperCase();

  switch (sort) {
    case 'createdAt':
      return `created_at ${dir}, id ${dir}`;
    case 'updatedAt':
      return `updated_at ${dir}, id ${dir}`;
    case 'validTo':
      return `valid_to ${dir} NULLS LAST, valid_from DESC, id DESC`;
    case 'validFrom':
    default:
      return `valid_from ${dir}, id ${dir}`;
  }
}

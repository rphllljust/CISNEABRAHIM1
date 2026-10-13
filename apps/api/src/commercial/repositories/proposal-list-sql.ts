import {
  PROPOSAL_PRICING_STRUCTURES,
  isProposalVersionStatus,
} from '../domain/proposal';
import {
  parseAdvancedFilter,
  type AdvancedFilter,
  type AdvancedFilterFieldSpec,
} from '../../infrastructure/http/contracts/advanced-filter-query';

/**
 * Consulta da fila comercial de propostas.
 *
 * Todo o SQL textual desta consulta vive no plano de persistencia. Filtros entram SEMPRE como
 * parametro ligado e ordenacao entra SEMPRE por allowlist explicita: nenhum valor vindo do cliente
 * e interpolado na sentenca.
 *
 * A versao corrente entra por LEFT JOIN em `com.proposals.current_version_number`, que ja existe —
 * nenhuma coluna, view ou tabela nova.
 */

/**
 * Erro de consulta da fila. O plano de persistencia nao fala HTTP: o servico de aplicacao
 * traduz este erro no codigo comercial ja existente (COMMERCIAL_VALIDATION_FAILED).
 */
export class ProposalListQueryError extends Error {
  constructor() {
    super('INVALID_LIST_QUERY');
  }
}

export const PROPOSAL_LIST_SORTS = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  validUntil: 'validUntil',
  value: 'value',
  revision: 'revision',
} as const;

export type ProposalListSort = keyof typeof PROPOSAL_LIST_SORTS;
export type ProposalListDirection = 'asc' | 'desc';

export function isProposalListSort(value: string): value is ProposalListSort {
  return Object.hasOwn(PROPOSAL_LIST_SORTS, value);
}

export function isProposalListDirection(value: string): value is ProposalListDirection {
  return value === 'asc' || value === 'desc';
}

export type ProposalListFilters = {
  clientId?: string;
  unitId?: string;
  status?: string;
  currencyCode?: string;
  validFrom?: string;
  validTo?: string;
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  /** Filtro avançado já validado pelo domínio; ausente = sem recorte composto. */
  advanced?: ProposalAdvancedFilter;
};

/**
 * FILTRO AVANÇADO — mesma forma publicada em Clientes e Solicitações.
 *
 * Campos por allow-list fechado, operadores validados pelo TIPO do campo e valores sempre
 * parametrizados. A forma do payload é idêntica entre domínios de propósito: é o que permite um
 * único conversor no frontend servir todas as entidades governadas por metadado.
 */
export const PROPOSAL_FILTER_FIELDS = {
  proposalCode: 'proposalCode',
  title: 'title',
  status: 'status',
  currencyCode: 'currencyCode',
  validUntil: 'validUntil',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
} as const;

export type ProposalFilterField = (typeof PROPOSAL_FILTER_FIELDS)[keyof typeof PROPOSAL_FILTER_FIELDS];

/**
 * ESPECIFICAÇÃO DOS CAMPOS DE PROPOSTAS PARA O PARSER GENÉRICO.
 *
 * A validação de forma vive em `infrastructure/http/contracts/advanced-filter-query`; aqui fica só
 * o que é próprio do domínio: quais campos existem, de que família são e qual o vocabulário aceito.
 */
export const PROPOSAL_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { name: PROPOSAL_FILTER_FIELDS.proposalCode, kind: 'text' },
  { name: PROPOSAL_FILTER_FIELDS.title, kind: 'text' },
  { name: PROPOSAL_FILTER_FIELDS.currencyCode, kind: 'text' },
  {
    name: PROPOSAL_FILTER_FIELDS.status,
    kind: 'enum',
    isValidEnumValue: isProposalVersionStatus,
  },
  { name: PROPOSAL_FILTER_FIELDS.validUntil, kind: 'date' },
  { name: PROPOSAL_FILTER_FIELDS.createdAt, kind: 'date' },
  { name: PROPOSAL_FILTER_FIELDS.updatedAt, kind: 'date' },
];

export type ProposalAdvancedFilter = AdvancedFilter;

export function parseProposalAdvancedFilter(value: unknown): ProposalAdvancedFilter | undefined {
  return parseAdvancedFilter(value, PROPOSAL_FILTER_SPECS);
}

function buildProposalAdvancedClause(
  filter: ProposalAdvancedFilter,
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
          `v.status ${operator === 'neq' ? '<>' : '='} ${param}::com.proposal_version_status`,
        );
        params.push(value);
      } else if (field === 'proposalCode') {
        const built = buildProposalTextClause('p.proposal_code', operator, value, param);
        conditionClauses.push(built.clause);
        params.push(...built.params);
      } else if (field === 'title') {
        const built = buildProposalTextClause('p.title', operator, value, param);
        conditionClauses.push(built.clause);
        params.push(...built.params);
      } else if (field === 'currencyCode') {
        const built = buildProposalTextClause('v.currency_code', operator, value, param);
        conditionClauses.push(built.clause);
        params.push(...built.params);
      } else {
        const column =
          field === 'validUntil' ? 'v.valid_until' : field === 'updatedAt' ? 'p.updated_at' : 'p.created_at';
        conditionClauses.push(`${column} ${operator === 'before' ? '<' : '>'} ${param}::timestamptz`);
        params.push(value);
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

function buildProposalTextClause(
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

export const MAX_PROPOSAL_SEARCH_LENGTH = 120;

export const PROPOSAL_WORKBENCH_SELECT = `
  SELECT
    p.id,
    p.proposal_code,
    p.client_id,
    p.unit_id,
    p.title,
    p.current_version_number,
    p.row_version,
    p.created_at,
    p.updated_at,
    v.status::text AS current_version_status,
    v.pricing_structure::text AS pricing_structure,
    v.currency_code,
    v.global_sale_price_amount::text AS global_sale_price_amount,
    v.items_sale_total_amount::text AS items_sale_total_amount,
    v.valid_until,
    v.version_number AS revision_number,
    v.issued_at,
    v.accepted_at,
    v.superseded_at,
    (
      SELECT COUNT(*)::int FROM com.proposal_versions counted WHERE counted.proposal_id = p.id
    ) AS revision_count,
    (
      SELECT COUNT(*)::int FROM com.proposal_versions prior
      WHERE prior.proposal_id = p.id
        AND prior.version_number < COALESCE(p.current_version_number, 1)
    ) AS prior_revision_count
  FROM com.proposals p
  LEFT JOIN com.proposal_versions v
    ON v.proposal_id = p.id
   AND v.version_number = p.current_version_number
`;

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function buildProposalListWhere(
  scopeFilter: { clause: string; params: unknown[] },
  query: ProposalListFilters,
): { clause: string; params: unknown[] } {
  const clauses = [scopeFilter.clause];
  const params = [...scopeFilter.params];

  if (query.clientId) {
    params.push(query.clientId);
    clauses.push(`p.client_id = $${params.length}::uuid`);
  }
  if (query.unitId) {
    params.push(query.unitId);
    clauses.push(`p.unit_id = $${params.length}`);
  }
  if (query.status) {
    if (!isProposalVersionStatus(query.status)) {
      throw new ProposalListQueryError();
    }
    params.push(query.status);
    clauses.push(`v.status = $${params.length}::com.proposal_version_status`);
  }
  if (query.currencyCode) {
    params.push(query.currencyCode);
    clauses.push(`v.currency_code = $${params.length}`);
  }
  if (query.validFrom) {
    params.push(query.validFrom);
    clauses.push(`v.valid_until >= $${params.length}::timestamptz`);
  }
  if (query.validTo) {
    params.push(query.validTo);
    clauses.push(`v.valid_until <= $${params.length}::timestamptz`);
  }
  if (query.createdFrom) {
    params.push(query.createdFrom);
    clauses.push(`p.created_at >= $${params.length}::timestamptz`);
  }
  if (query.createdTo) {
    params.push(query.createdTo);
    clauses.push(`p.created_at <= $${params.length}::timestamptz`);
  }
  const search = query.search?.trim();
  if (search) {
    if (search.length > MAX_PROPOSAL_SEARCH_LENGTH) {
      throw new ProposalListQueryError();
    }
    params.push(`%${escapeLikePattern(search)}%`);
    clauses.push(`(p.proposal_code ILIKE $${params.length} OR p.title ILIKE $${params.length})`);
  }

  // Filtro avançado entra como UM predicado entre os demais, e por isso convive por conjunção com
  // escopo de unidade, cliente, status e busca.
  if (query.advanced) {
    const advanced = buildProposalAdvancedClause(query.advanced, params.length + 1);
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
 * Padrao: mais recentes primeiro (`p.created_at DESC, p.id DESC`), o mesmo desempate estavel que a
 * listagem ja usava. Valor comercial segue a MESMA regra de precificacao do dominio
 * (`GLOBAL_PRICE` -> preco global; `ITEMIZED` -> soma das linhas); ausencia sempre por ultimo.
 */
export function buildProposalListOrderClause(
  sort: ProposalListSort = 'createdAt',
  direction: ProposalListDirection = 'desc',
): string {
  if (!isProposalListSort(sort) || !isProposalListDirection(direction)) {
    throw new ProposalListQueryError();
  }
  const dir = direction.toUpperCase();

  switch (sort) {
    case 'updatedAt':
      return `p.updated_at ${dir}, p.id ${dir}`;
    case 'validUntil':
      return `v.valid_until ${dir} NULLS LAST, p.created_at DESC, p.id DESC`;
    case 'value':
      return [
        `CASE WHEN v.pricing_structure = '${PROPOSAL_PRICING_STRUCTURES.GlobalPrice}'::com.proposal_pricing_structure`,
        `  THEN v.global_sale_price_amount`,
        `  ELSE v.items_sale_total_amount`,
        `END ${dir} NULLS LAST`,
        `, p.created_at DESC, p.id DESC`,
      ].join('\n');
    case 'revision':
      return `COALESCE(p.current_version_number, 0) ${dir}, p.created_at DESC, p.id DESC`;
    case 'createdAt':
    default:
      return `p.created_at ${dir}, p.id ${dir}`;
  }
}

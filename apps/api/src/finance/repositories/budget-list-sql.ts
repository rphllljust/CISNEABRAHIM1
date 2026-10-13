import {
  parseAdvancedFilter,
  type AdvancedFilter,
  type AdvancedFilterFieldSpec,
} from '../../infrastructure/http/contracts/advanced-filter-query';
import { BUDGET_STATUSES } from '../domain/budget';

/**
 * FILTRO COMPOSTO DA FILA DE ORÇAMENTOS.
 *
 * Mesmo parser genérico dos módulos comerciais e das filas de títulos
 * (`infrastructure/http/contracts/advanced-filter-query`): a FORMA do payload é idêntica em todo o
 * produto e cada domínio declara apenas os seus campos.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * AQUI `status` ENTRA — e a diferença em relação a recebíveis/pagáveis é de domínio, não de gosto.
 *
 * Nas filas de TÍTULOS a situação é DERIVADA (lifecycle + liquidações + vencimento) e por isso não
 * tem coluna: filtrá-la exigiria negar disjunções de predicados. Em `fin.budgets` existe a COLUNA
 * `status` (`fin.budget_status`, ACTIVE/INACTIVE) e o allow-list simples da tela já filtra por ela.
 * Oferecê-la no recorte composto é executável de verdade — e é exatamente o que o operador compõe
 * ao combinar "situação + código + janela".
 *
 * `unit_id` fica FORA: já é o recorte do filtro simples e o escopo de autorização. Duplicá-lo aqui
 * criaria dois caminhos para o mesmo recorte, com semânticas que podem divergir.
 */
export class BudgetListQueryError extends Error {
  constructor() {
    super('INVALID_LIST_QUERY');
    this.name = 'BudgetListQueryError';
  }
}

/** Campos que o filtro composto executa hoje — todos colunas REAIS de `fin.budgets`. */
export const BUDGET_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { name: 'code', kind: 'text' },
  { name: 'name', kind: 'text' },
  { name: 'currencyCode', kind: 'text' },
  { name: 'status', kind: 'enum', isValidEnumValue: isBudgetStatus },
  { name: 'createdAt', kind: 'date' },
  { name: 'updatedAt', kind: 'date' },
];

export type BudgetAdvancedFilter = AdvancedFilter;

export function parseBudgetAdvancedFilter(value: unknown): BudgetAdvancedFilter | undefined {
  return parseAdvancedFilter(value, BUDGET_FILTER_SPECS);
}

/** `true` quando o valor é um status do vocabulário REAL do domínio. */
export function isBudgetStatus(value: string): boolean {
  return Object.values(BUDGET_STATUSES).includes(value as never);
}

/**
 * Traduz UMA condição do contrato para o predicado SQL do orçamento.
 *
 * `firstParamIndex` é o número do primeiro parâmetro livre — o chamador já ocupou os anteriores com
 * os filtros simples. TODA comparação é parametrizada; nada vindo do cliente é interpolado.
 */
export function buildBudgetFilterCondition(
  condition: { field: string; operator: string; value: string },
  firstParamIndex: number,
): { clause: string; params: unknown[] } | null {
  const param = `$${firstParamIndex}`;

  switch (condition.field) {
    case 'status':
      // O enum do banco é `fin.budget_status`: o cast é o que faz o Postgres comparar pelo TIPO, e
      // sem ele um valor fora do vocabulário viraria erro de tipo em vez de zero linhas.
      return {
        clause: `status ${condition.operator === 'neq' ? '<>' : '='} ${param}::fin.budget_status`,
        params: [condition.value],
      };
    case 'code':
    case 'name':
    case 'currencyCode': {
      const column =
        condition.field === 'code' ? 'code' : condition.field === 'name' ? 'name' : 'currency_code';
      return textClause(column, condition.operator, condition.value, param);
    }
    case 'createdAt':
    case 'updatedAt': {
      const column = condition.field === 'createdAt' ? 'created_at' : 'updated_at';
      return {
        clause: `${column} ${condition.operator === 'before' ? '<' : '>'} ${param}::timestamptz`,
        params: [condition.value],
      };
    }
    default:
      // Campo fora do allow-list nunca chega aqui: o parser recusa antes.
      return null;
  }
}

/** Monta o predicado composto completo (grupos unidos pelo conector declarado). */
export function buildBudgetAdvancedClause(
  filter: BudgetAdvancedFilter,
  firstParamIndex: number,
): { clause: string; params: unknown[] } | null {
  const params: unknown[] = [];
  const groupClauses: string[] = [];

  for (const group of filter.groups) {
    const conditions: string[] = [];
    for (const condition of group.conditions) {
      const built = buildBudgetFilterCondition(condition, firstParamIndex + params.length);
      if (built) {
        conditions.push(built.clause);
        params.push(...built.params);
      }
    }
    // Grupo cujas condições todas caíram fora não vira `()`, que seria SQL inválido.
    if (conditions.length > 0) {
      groupClauses.push(`(${conditions.join(' AND ')})`);
    }
  }

  if (groupClauses.length === 0) {
    return null;
  }
  return { clause: `(${groupClauses.join(` ${filter.connector} `)})`, params };
}

/** Comparação textual com curinga escapado — o termo é do operador, não um padrão LIKE. */
function textClause(
  column: string,
  operator: string,
  value: string,
  param: string,
): { clause: string; params: unknown[] } | null {
  if (operator === 'eq') {
    return { clause: `${column} = ${param}`, params: [value] };
  }
  if (operator === 'neq') {
    // Ausência NÃO é igualdade: SQL puro (`col <> $1`) descartaria NULL em silêncio.
    return { clause: `(${column} IS NULL OR ${column} <> ${param})`, params: [value] };
  }
  if (operator === 'startsWith') {
    return { clause: `${column} ILIKE ${param}`, params: [`${escapeLikePattern(value)}%`] };
  }
  if (operator === 'contains') {
    return { clause: `${column} ILIKE ${param}`, params: [`%${escapeLikePattern(value)}%`] };
  }
  return null;
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

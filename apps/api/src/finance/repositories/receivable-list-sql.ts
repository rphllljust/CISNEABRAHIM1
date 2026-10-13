import { RECEIVABLE_STATUSES, type ReceivableStatus } from '../domain/receivable';
import {
  parseAdvancedFilter,
  type AdvancedFilter,
  type AdvancedFilterFieldSpec,
} from '../../infrastructure/http/contracts/advanced-filter-query';

/**
 * FILTRO COMPOSTO DA FILA DE CONTAS A RECEBER.
 *
 * Mesmo parser genérico dos módulos comerciais
 * (`infrastructure/http/contracts/advanced-filter-query`): a FORMA do payload é idêntica em todo o
 * produto e cada domínio declara apenas os seus campos. Nenhuma validação de forma é reescrita aqui.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A DECISÃO QUE GOVERNA ESTE ARQUIVO: O TÍTULO NÃO TEM COLUNA `status`.
 *
 * `fin.receivables` guarda `lifecycle` e `due_date`; o status que o operador vê (`OPEN`,
 * `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`) é DERIVADO pelo domínio
 * (`deriveReceivableStatus`) a partir de `lifecycle` + soma dos lançamentos liquidados + vencimento.
 *
 * Isso já era verdade no filtro simples desta mesma fila, onde `status` é traduzido para os
 * PREDICADOS REAIS que produzem cada status, em vez de um `status = $n`. O filtro composto segue a
 * MESMA regra, e por uma razão mais forte: um `status = 'OVERDUE'` aqui seria uma coluna que não
 * existe, e "traduzir" o valor do operador para um literal qualquer seria inventar semântica de
 * domínio no SQL.
 *
 * Consequência declarada, e é a razão de `status` NÃO entrar no allow-list composto: os operadores
 * que o contrato genérico oferece para `enum` são `eq`/`neq`, e `neq` sobre um status derivado
 * exigiria negar uma disjunção de predicados — expressável, mas com uma superfície de erro que não
 * se paga. O recorte por situação continua disponível no filtro simples (`?status=`), que já o
 * traduz corretamente. Ampliar isto exige ampliar os DOIS lados na mesma mudança.
 */
export class ReceivableListQueryError extends Error {
  constructor() {
    super('INVALID_LIST_QUERY');
    this.name = 'ReceivableListQueryError';
  }
}

/**
 * Campos que o filtro composto executa hoje.
 *
 * Só entram colunas REAIS do título. `status` fica fora pelo motivo documentado acima — oferecer um
 * filtro que o servidor não executa faria o operador compor um recorte, o servidor ignorá-lo e a
 * lista inteira voltar como se fosse o resultado.
 */
export const RECEIVABLE_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { name: 'externalReference', kind: 'text' },
  { name: 'currencyCode', kind: 'text' },
  { name: 'dueDate', kind: 'date' },
  { name: 'createdAt', kind: 'date' },
  { name: 'updatedAt', kind: 'date' },
];

export type ReceivableAdvancedFilter = AdvancedFilter;

export function parseReceivableAdvancedFilter(
  value: unknown,
): ReceivableAdvancedFilter | undefined {
  return parseAdvancedFilter(value, RECEIVABLE_FILTER_SPECS);
}

/**
 * Traduz UMA condição do contrato para o predicado SQL do título.
 *
 * `firstParamIndex` é o número do primeiro parâmetro livre: o chamador já ocupou os anteriores com
 * o escopo de autorização e os filtros simples, e o SQL usa placeholders posicionais.
 *
 * TODA comparação é parametrizada — nenhum valor vindo do cliente é interpolado.
 */
export function buildReceivableFilterCondition(
  condition: { field: string; operator: string; value: string },
  firstParamIndex: number,
): { clause: string; params: unknown[] } | null {
  const param = `$${firstParamIndex}`;

  switch (condition.field) {
    case 'externalReference':
    case 'currencyCode': {
      const column = condition.field === 'externalReference' ? 'r.external_reference' : 'r.currency_code';
      return textClause(column, condition.operator, condition.value, param);
    }
    case 'dueDate':
    case 'createdAt':
    case 'updatedAt': {
      const column =
        condition.field === 'dueDate'
          ? 'r.due_date'
          : condition.field === 'createdAt'
            ? 'r.created_at'
            : 'r.updated_at';
      // `due_date` é DATE; os demais são timestamptz. O cast segue a coluna real, não a intenção.
      const cast = condition.field === 'dueDate' ? '::date' : '::timestamptz';
      // Antes/Depois apenas: o parser já recusou qualquer outro operador para a família `date`.
      return {
        clause: `${column} ${condition.operator === 'before' ? '<' : '>'} ${param}${cast}`,
        params: [condition.value],
      };
    }
    default:
      // Campo fora do allow-list nunca chega aqui: o parser recusa antes. Devolver `null` mantém a
      // função defensiva sem produzir predicado nenhum.
      return null;
  }
}

/**
 * Monta o predicado composto completo.
 *
 * O contrato entrega um nível: grupos com conjunção interna, ligados por `connector`. Cada grupo
 * vira um parêntese; os grupos são unidos pelo conector declarado. É a mesma forma que os módulos
 * comerciais executam.
 */
export function buildReceivableAdvancedClause(
  filter: ReceivableAdvancedFilter,
  firstParamIndex: number,
): { clause: string; params: unknown[] } | null {
  const params: unknown[] = [];
  const groupClauses: string[] = [];

  for (const group of filter.groups) {
    const conditions: string[] = [];
    for (const condition of group.conditions) {
      const built = buildReceivableFilterCondition(condition, firstParamIndex + params.length);
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
    // Ausência NÃO é igualdade: um título sem referência externa continua sendo "diferente de X".
    // SQL puro (`col <> $1`) descartaria NULL em silêncio, encolhendo o resultado sem avisar.
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

/** `true` quando o valor é um status do vocabulário REAL do domínio. */
export function isReceivableStatus(value: string): value is ReceivableStatus {
  return Object.values(RECEIVABLE_STATUSES).includes(value as ReceivableStatus);
}

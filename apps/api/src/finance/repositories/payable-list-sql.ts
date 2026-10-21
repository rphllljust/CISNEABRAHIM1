import {
  parseAdvancedFilter,
  type AdvancedFilter,
  type AdvancedFilterFieldSpec,
} from '../../infrastructure/http/contracts/advanced-filter-query';

/**
 * FILTRO COMPOSTO DA FILA DE CONTAS A PAGAR.
 *
 * Mesmo parser genérico dos módulos comerciais e de Contas a receber
 * (`infrastructure/http/contracts/advanced-filter-query`): a FORMA do payload é idêntica em todo o
 * produto e cada domínio declara apenas os seus campos.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * MESMA DECISÃO DE DOMÍNIO DE RECEBÍVEIS: O TÍTULO NÃO TEM COLUNA `status`.
 *
 * `fin.payables` guarda `lifecycle` e `due_date`; o status que o operador vê (`OPEN`,
 * `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`) é DERIVADO por `derivePayableStatus` a partir de
 * lifecycle + soma dos pagamentos liquidados + vencimento. O filtro simples desta mesma fila já
 * traduz `status` para os PREDICADOS REAIS de cada situação.
 *
 * Por isso `status` e `lifecycle` ficam FORA do allow-list composto: `lifecycle` seria um recorte
 * DIFERENTE do que o operador lê como situação, e trocar um filtro correto por um quase-correto é
 * pior — porque parece funcionar.
 *
 * `counterparty_id` e `unit_id` também ficam fora: já são o recorte do filtro simples e do escopo de
 * autorização. Duplicá-los aqui criaria dois caminhos para o mesmo recorte, com semânticas que
 * podem divergir.
 */
export class PayableListQueryError extends Error {
  constructor() {
    super('INVALID_LIST_QUERY');
    this.name = 'PayableListQueryError';
  }
}

/** Campos que o filtro composto executa hoje — todos colunas REAIS do título a pagar. */
export const PAYABLE_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { name: 'externalReference', kind: 'text' },
  { name: 'originReference', kind: 'text' },
  { name: 'costCenterCode', kind: 'text' },
  { name: 'currencyCode', kind: 'text' },
  { name: 'dueDate', kind: 'date' },
  { name: 'createdAt', kind: 'date' },
  { name: 'updatedAt', kind: 'date' },
  { name: 'agingBucket', kind: 'text' },
];

/**
 * EXPRESSÃO CANÔNICA DE FAIXA DE AGING.
 *
 * Fonte ÚNICA da semântica de faixa no SQL. Lista, summary e aging agregado chamam esta
 * função — é isso que garante que o drilldown de uma faixa devolva exatamente os títulos
 * que somaram naquele valor. Duplicar o `CASE` em três lugares seria a receita para o
 * número da tela e o número da lista divergirem sem ninguém perceber.
 *
 * Reproduz `classifyPayableAging` do domínio, inclusive a PRECEDÊNCIA:
 *   1. cancelado vence tudo (um título cancelado não "venceu");
 *   2. restante <= 0 é liquidado;
 *   3. só então a faixa por dias de atraso.
 */
export function buildAgingBucketExpr(asOfParam: string): string {
  // Mesmo estorno consciente de `remainingBalance`: pagamento revertido subtrai.
  const paidExpr = `COALESCE((
      SELECT sum(CASE WHEN p.reverses_payment_id IS NULL THEN p.amount ELSE -p.amount END)
      FROM fin.payments p WHERE p.payable_id = r.id), 0)`;
  const remainingExpr = `(r.principal - ${paidExpr})`;
  return `CASE
      WHEN r.lifecycle = 'CANCELLED' THEN 'CANCELLED'
      WHEN ${remainingExpr} <= 0 THEN 'SETTLED'
      WHEN (${asOfParam} - r.due_date) <= 0 THEN 'CURRENT'
      WHEN (${asOfParam} - r.due_date) <= 30 THEN '1_30'
      WHEN (${asOfParam} - r.due_date) <= 60 THEN '31_60'
      WHEN (${asOfParam} - r.due_date) <= 90 THEN '61_90'
      ELSE '90_PLUS'
    END`;
}

/** Faixas válidas — permite recusar valor inválido em vez de devolver lista vazia silenciosa. */
export const PAYABLE_AGING_BUCKET_VALUES = [
  'SETTLED',
  'CANCELLED',
  'CURRENT',
  '1_30',
  '31_60',
  '61_90',
  '90_PLUS',
] as const;

export type PayableAdvancedFilter = AdvancedFilter;

export function parsePayableAdvancedFilter(value: unknown): PayableAdvancedFilter | undefined {
  return parseAdvancedFilter(value, PAYABLE_FILTER_SPECS);
}

/**
 * Traduz UMA condição do contrato para o predicado SQL do título.
 *
 * `firstParamIndex` é o número do primeiro parâmetro livre: o chamador já ocupou os anteriores com
 * o escopo de autorização e os filtros simples, e o SQL usa placeholders posicionais.
 *
 * TODA comparação é parametrizada — nenhum valor vindo do cliente é interpolado.
 */
export function buildPayableFilterCondition(
  condition: { field: string; operator: string; value: string },
  firstParamIndex: number,
): { clause: string; params: unknown[] } | null {
  const param = `$${firstParamIndex}`;

  switch (condition.field) {
    case 'externalReference':
    case 'originReference':
    case 'costCenterCode':
    case 'currencyCode': {
      const column =
        condition.field === 'externalReference'
          ? 'r.external_reference'
          : condition.field === 'originReference'
            ? 'r.origin_reference'
            : condition.field === 'costCenterCode'
              ? 'r.cost_center_code'
              : 'r.currency_code';
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
      // `due_date` é DATE; os demais são timestamptz. O cast segue a coluna real.
      const cast = condition.field === 'dueDate' ? '::date' : '::timestamptz';
      return {
        clause: `${column} ${condition.operator === 'before' ? '<' : '>'} ${param}${cast}`,
        params: [condition.value],
      };
    }
    case 'agingBucket': {
      /*
       * A faixa NÃO é coluna: é derivada de lifecycle + saldo + vencimento. Por isso o
       * predicado compara a EXPRESSÃO canônica, e não `r.aging_bucket`. Um valor fora das
       * faixas conhecidas é recusado (`null` → condição descartada) em vez de virar
       * `= 'xxx'` e devolver lista vazia como se a carteira não tivesse nada.
       */
      if (condition.operator !== 'eq') {
        return null;
      }
      if (!(PAYABLE_AGING_BUCKET_VALUES as readonly string[]).includes(condition.value)) {
        return null;
      }
      // O corte de data do filtro é "hoje" — o mesmo que a listagem usa em `statusPredicates`.
      return {
        clause: `${buildAgingBucketExpr('CURRENT_DATE')} = ${param}`,
        params: [condition.value],
      };
    }
    default:
      // Campo fora do allow-list nunca chega aqui: o parser recusa antes.
      return null;
  }
}

/** Monta o predicado composto completo (grupos unidos pelo conector declarado). */
export function buildPayableAdvancedClause(
  filter: PayableAdvancedFilter,
  firstParamIndex: number,
): { clause: string; params: unknown[] } | null {
  const params: unknown[] = [];
  const groupClauses: string[] = [];

  for (const group of filter.groups) {
    const conditions: string[] = [];
    for (const condition of group.conditions) {
      const built = buildPayableFilterCondition(condition, firstParamIndex + params.length);
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
    // Ausência NÃO é igualdade: um título sem referência continua sendo "diferente de X".
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

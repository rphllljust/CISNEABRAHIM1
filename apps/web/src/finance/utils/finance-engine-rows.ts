import type { MetaEntitySchema, SubformRow } from '../../engine';
import type {
  BudgetDetail,
  ExpenseDetail,
  PayableDetail,
  ReceivableDetail,
} from '../types/finance.types';

/**
 * ADAPTADORES DE FINANCE — DTO da API ⇄ schema do metadata store.
 *
 * A engine indexa por NOME DE CAMPO do metadata store (`code`, `name`, `unit_id`, `row_version`)
 * enquanto o DTO usa camelCase. Este é o único lugar onde as duas nomenclaturas se encontram —
 * o mesmo padrão de `budget-engine-rows.ts` e de `service-order-engine-rows`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE OS SUBFORMULÁRIOS USAM UM SCHEMA LOCAL
 *
 * As coleções filhas (linhas de orçamento, itens de despesa) NÃO são entidades de `meta.*`: não há
 * `/api/v1/meta/budget-lines` nem `/api/v1/meta/expense-items`, e criá-las exigiria migration —
 * fora do escopo autorizado. Pai e filho são conceitualmente distintos (é a regra do próprio
 * contrato do `DynamicSubform`), então cada coleção filha recebe uma PROJEÇÃO TIPADA MÍNIMA em vez
 * de um schema de mentira emprestado do pai.
 *
 * As projeções são declaradas como `MetaEntitySchema` de verdade — não como `any`, não como cast —
 * para que a engine as consuma pelo mesmo caminho de todos os outros schemas. No dia em que essas
 * coleções virarem entidades do store, o metadado real entra e NENHUMA linha do subformulário muda:
 * as colunas continuam vindo do schema.
 */

/**
 * Projeção tipada das colunas do filho.
 *
 * Espelha o que `budgetDetail` entrega por linha: competência (do período), dimensão (o primeiro
 * código de dimensão preenchido) e valor. Os três vêm do DTO — nenhum é inventado aqui.
 */
export function budgetLineSchema(): MetaEntitySchema {
  const field = (
    name: string,
    label: string,
    type: 'text' | 'currency',
    fieldOrder: number,
    aggregation?: string,
  ) => ({
    name,
    label,
    type,
    required: false,
    // SOMENTE LEITURA: a API de orçamento não publica PATCH por linha (`addBudgetLine` é um
    // comando que exige `periodId`). Um grid editável aqui prometeria uma gravação que não existe.
    readOnly: true,
    permLevel: 0,
    options: null,
    fieldOrder,
    inForm: true,
    inList: true,
    listOrder: fieldOrder,
    inFilter: false,
    inSearch: false,
    ...(aggregation ? { aggregation } : {}),
  });

  return {
    name: 'budget-lines',
    label: 'Linhas do orçamento',
    description: null,
    dataSchema: 'finance',
    dataTable: 'budget_lines',
    labelField: 'dimension',
    fields: [
      field('period_key', 'Competência', 'text', 1),
      field('dimension', 'Dimensão', 'text', 2),
      // Agregação DECLARADA no metadado: é o que faz o rodapé totalizar o valor orçado, e é a
      // mesma regra do `DynamicList` — coluna sem `aggregation` não entra no rodapé.
      field('amount', 'Valor orçado', 'currency', 3, 'sum'),
    ],
    views: [
      {
        viewType: 'list',
        label: 'Linhas do orçamento',
        layout: { columns: ['period_key', 'dimension', 'amount'] },
        isDefault: true,
      },
    ],
    workflow: null,
    permissions: [],
    allowedPermLevels: [0],
  } satisfies MetaEntitySchema;
}

/** Linhas do rascunho corrente, no formato que o subformulário consome. */
export function budgetLineRows(budget: BudgetDetail): SubformRow[] {
  const draft =
    budget.versions.find((version) => version.status === 'DRAFT') ?? budget.versions.at(-1);
  return (draft?.periods ?? []).flatMap((period) =>
    period.lines.map((line) => ({
      id: line.id,
      period_key: period.periodKey,
      // A dimensão é o PRIMEIRO código preenchido, na ordem em que o backend os declara. Vazio
      // explícito quando nenhum existe — inventar um rótulo aqui seria dado empresarial falso.
      dimension: line.costCenterCode ?? line.expenseCategoryId ?? line.accountId ?? '',
      amount: line.amount,
    })),
  );
}

/**
 * Valores do formulário do pai, indexados por nome de campo do metadata store.
 *
 * `row_version` e `unit_id` entram porque SÃO campos de `meta.fields` de `budgets`; omiti-los
 * faria o `DynamicForm` renderizá-los vazios, que é pior que exibir o valor real.
 */
export function budgetFormValues(budget: BudgetDetail): Record<string, unknown> {
  return {
    code: budget.code,
    name: budget.name,
    unit_id: budget.unitId,
    currency_code: budget.currencyCode,
    status: budget.status,
    row_version: budget.rowVersion,
  };
}

/** Maior número de versão do orçamento — usado no resumo do rascunho. */
export function budgetVersionSummary(budget: BudgetDetail): string {
  const draft =
    budget.versions.find((version) => version.status === 'DRAFT') ?? budget.versions.at(-1);
  if (!draft) {
    return 'sem versão';
  }
  return `versão ${draft.versionNumber} · ${draft.status}`;
}

/**
 * Projeção tipada das colunas do filho da DESPESA.
 *
 * Mesma razão do orçamento: `expense_items` chega embutido no `ExpenseDetail` e não é entidade de
 * `meta.*`. A projeção é um `MetaEntitySchema` de verdade — nem `any`, nem cast — para que a
 * engine a consuma pelo caminho de todos os outros schemas.
 */
export function expenseItemSchema(): MetaEntitySchema {
  const field = (
    name: string,
    label: string,
    type: 'integer' | 'text' | 'currency',
    fieldOrder: number,
    aggregation?: string,
  ) => ({
    name,
    label,
    type,
    required: false,
    // SOMENTE LEITURA: a API cria a despesa inteira de uma vez (`createExpense` recebe `items`);
    // não há PATCH por item publicado.
    readOnly: true,
    permLevel: 0,
    options: null,
    fieldOrder,
    inForm: true,
    inList: true,
    listOrder: fieldOrder,
    inFilter: false,
    inSearch: false,
    ...(aggregation ? { aggregation } : {}),
  });

  return {
    name: 'expense-items',
    label: 'Itens da despesa',
    description: null,
    dataSchema: 'finance',
    dataTable: 'expense_items',
    labelField: 'description',
    fields: [
      field('line_number', 'Item', 'integer', 1),
      field('description', 'Descrição', 'text', 2),
      // Agregação DECLARADA: é o que faz o rodapé totalizar o valor informado.
      field('amount', 'Valor', 'currency', 3, 'sum'),
    ],
    views: [
      {
        viewType: 'list',
        label: 'Itens da despesa',
        layout: { columns: ['line_number', 'description', 'amount'] },
        isDefault: true,
      },
    ],
    workflow: null,
    permissions: [],
    allowedPermLevels: [0],
  } satisfies MetaEntitySchema;
}

/** Itens da despesa no formato que o subformulário consome. */
export function expenseItemRows(expense: ExpenseDetail): SubformRow[] {
  return expense.items.map((item) => ({
    id: item.id,
    line_number: item.lineNumber,
    description: item.description,
    amount: item.amount,
  }));
}

/** Valores do formulário do pai, indexados por nome de campo do metadata store. */
export function expenseFormValues(expense: ExpenseDetail): Record<string, unknown> {
  return {
    description: expense.description,
    unit_id: expense.unitId,
    cost_center_code: expense.costCenterCode,
    total_amount: expense.totalAmount,
    currency_code: expense.currencyCode,
    due_date: expense.dueDate,
    payment_terms: expense.paymentTerms,
    reimbursable: expense.reimbursable,
    status: expense.status,
    version: expense.version,
  };
}

/**
 * Linha de TÍTULO (a pagar / a receber) no formato que a `DynamicList` consome.
 *
 * A view `list` de `payables` exibe:
 *   `external_reference, counterparty_id, principal, due_date, lifecycle, created_at`
 * e a de `receivables`, a mesma forma com `client_id` no lugar de `counterparty_id`. O adaptador
 * preenche exatamente esses nomes — nenhum campo a mais, porque coluna que a view não declara não
 * é desenhada e o valor ficaria invisível de qualquer forma.
 *
 * `remaining_balance` e `aging_bucket` NÃO estão nas colunas da view hoje, mas são o saldo e o
 * aging que a tela precisa para os indicadores de drill-down. Vão no adaptador porque a TELA os lê
 * diretamente — não são coluna da lista.
 */
export type FinanceTitleEngineRow = Record<string, unknown> & { id: string };

export function payableEngineRow(item: PayableDetail): FinanceTitleEngineRow {
  return {
    id: item.id,
    // A referência exibida é a do título, caindo para a origem: é a mesma regra do JSX antigo.
    external_reference: item.externalReference ?? item.origin.reference ?? item.id,
    counterparty_id: item.counterpartyId,
    principal: item.principal,
    due_date: item.dueDate,
    lifecycle: item.status,
    created_at: item.createdAt,
    // Lidos pela TELA para os indicadores; não são coluna da view `list`.
    remaining_balance: item.remainingBalance,
    aging_bucket: item.agingBucket,
    currency_code: item.currencyCode,
    origin_reference: item.origin.reference,
    cost_center_code: item.costCenter.code,
  };
}

export function receivableEngineRow(item: ReceivableDetail): FinanceTitleEngineRow {
  return {
    id: item.id,
    external_reference: item.externalReference ?? item.origin.billingDocumentId ?? item.id,
    client_id: item.clientId,
    principal: item.principal,
    due_date: item.dueDate,
    lifecycle: item.status,
    created_at: item.createdAt,
    remaining_balance: item.remainingBalance,
    settled_amount: item.settledAmount,
    currency_code: item.currencyCode,
    /*
     * SEM `aging_bucket`. O DTO de recebíveis NÃO o expõe — só `PayableDetail` tem `agingBucket`.
     * Derivá-lo aqui a partir de `due_date` seria calcular aging no navegador, exatamente o que a
     * tela declara não fazer. Fica ausente e a lista simplesmente não tem essa coluna.
     */
  };
}

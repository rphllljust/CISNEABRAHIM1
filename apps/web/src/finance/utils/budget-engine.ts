import type { MetaEntitySchema, SubformRow } from '../../engine';
import type { BudgetDetail } from '../types/finance.types';

/**
 * ADAPTADOR DO ORÇAMENTO — DTO da API ⇄ schema do metadata store.
 *
 * A engine indexa por NOME DE CAMPO do metadata store (`code`, `name`, `unit_id`, `row_version`)
 * enquanto o DTO usa camelCase. Este é o único lugar onde as duas nomenclaturas se encontram —
 * o mesmo padrão de `budget-engine-rows.ts` e de `service-order-engine-rows`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE O SUBFORMULÁRIO DE LINHAS USA UM SCHEMA LOCAL
 *
 * As linhas de orçamento NÃO são uma entidade de `meta.*`: não há `/api/v1/meta/budget-lines`, e
 * criá-la exigiria migration — fora do escopo autorizado. O pai e o filho são conceitualmente
 * distintos (é a regra do próprio contrato do `DynamicSubform`), então a coleção filha recebe uma
 * PROJEÇÃO TIPADA MÍNIMA em vez de um schema de mentira emprestado do pai.
 *
 * A projeção é declarada como `MetaEntitySchema` de verdade — não como `any`, não como cast — para
 * que a engine a consuma pelo mesmo caminho de todos os outros schemas. No dia em que
 * `budget-lines` virar entidade do store, `budgetLineSchema()` passa a devolver o metadado real e
 * NENHUMA linha do subformulário muda: as colunas continuam vindo do schema.
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

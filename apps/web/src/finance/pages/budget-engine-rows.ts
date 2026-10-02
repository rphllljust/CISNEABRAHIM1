import type { BudgetSummary } from '../api/finance-api';

/**
 * Linha de orçamento no formato que a engine consome.
 *
 * A engine indexa por NOME DE CAMPO do metadata store (`code`, `name`, `status`,
 * `currency_code`, `created_at`), enquanto o DTO da API usa camelCase. Este adaptador é o único
 * lugar onde as duas nomenclaturas se encontram — o mesmo padrão de `service-order-engine-rows`.
 *
 * `unit_id` fica fora: não está entre as colunas da view `list` e a listagem não o exibe.
 * Expô-lo faria a coluna "Unidade" aparecer na tela sem que a tela a desenhasse.
 */
export type BudgetEngineRow = Record<string, unknown> & { id: string };

export function budgetEngineRows(items: BudgetSummary[]): BudgetEngineRow[] {
  return items.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    currency_code: item.currencyCode,
    status: item.status,
    row_version: item.rowVersion,
    /*
     * `created_at` recebe `updatedAt`, e isto é o que a API oferece — `BudgetSummary` NÃO
     * devolve `createdAt`. A coluna do metadado se chama "Criado em" e exibiria, na verdade, a
     * data da última alteração.
     *
     * Fica DECLARADO em vez de silenciado: é o mesmo GAP que a lista de OS já registra para o
     * próprio `created_at`, e resolvê-lo exige o campo no DTO — fora do escopo desta migração.
     */
    created_at: item.updatedAt,
  }));
}

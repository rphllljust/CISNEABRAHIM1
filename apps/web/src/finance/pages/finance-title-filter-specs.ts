import type { AdvancedFilterFieldSpec } from '../../engine';

/**
 * ALLOW-LIST DO FILTRO COMPOSTO PARA CONTAS A RECEBER.
 *
 * O conversor compartilhado (`advancedFilterFromGroup`) monta o payload a partir desta lista, e o
 * servidor valida a MESMA lista do outro lado (`finance/repositories/receivable-list-sql.ts`).
 * Manter os dois alinhados é o que impede o defeito clássico: o operador compõe um recorte, o
 * servidor descarta a condição desconhecida e devolve a lista inteira — que o operador lê como
 * resultado do filtro.
 *
 * `status` NÃO entra, e a razão é de domínio, não de UI: o título não tem coluna de situação em
 * `fin.receivables`. O status é DERIVADO (`deriveReceivableStatus`) de lifecycle + liquidações +
 * vencimento, e o recorte por situação já existe no filtro simples (`?status=`), que o traduz para
 * os predicados reais. Oferecer `neq` sobre um status derivado exigiria negar uma disjunção de
 * predicados — ampliar isso exige ampliar os DOIS lados na mesma mudança.
 *
 * `dueFrom`/`dueTo` também ficam fora: já são o filtro de janela da barra simples, e duplicá-los
 * aqui produziria dois caminhos para o mesmo recorte, com semânticas que podem divergir.
 */
export const FINANCE_TITLE_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { field: 'external_reference', contractField: 'externalReference', kind: 'text' },
  { field: 'currency_code', contractField: 'currencyCode', kind: 'text' },
  { field: 'due_date', contractField: 'dueDate', kind: 'date' },
  { field: 'created_at', contractField: 'createdAt', kind: 'date' },
  { field: 'updated_at', contractField: 'updatedAt', kind: 'date' },
];

/**
 * ALLOW-LIST DO FILTRO COMPOSTO PARA CONTAS A PAGAR.
 *
 * Espelha `PAYABLE_FILTER_SPECS` (`apps/api/src/finance/repositories/payable-list-sql.ts`).
 * Pagáveis tem DOIS campos que recebíveis não tem — a referência de ORIGEM (o documento que gerou a
 * obrigação) e o CENTRO DE CUSTO. É por isso que a lista é própria em vez de reutilizar a de
 * recebíveis: usar o allow-list errado ofereceria ao operador um campo que o servidor recusa com
 * 400, ou esconderia um que ele executa.
 *
 * `lifecycle` e `status` ficam fora pelo mesmo motivo de domínio documentado acima; `counterparty_id`
 * e `unit_id` ficam fora porque já são o recorte do filtro simples e do escopo de autorização.
 */
export const PAYABLE_TITLE_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { field: 'external_reference', contractField: 'externalReference', kind: 'text' },
  { field: 'origin_reference', contractField: 'originReference', kind: 'text' },
  { field: 'cost_center_code', contractField: 'costCenterCode', kind: 'text' },
  { field: 'currency_code', contractField: 'currencyCode', kind: 'text' },
  { field: 'due_date', contractField: 'dueDate', kind: 'date' },
  { field: 'created_at', contractField: 'createdAt', kind: 'date' },
  { field: 'updated_at', contractField: 'updatedAt', kind: 'date' },
];

/**
 * ALLOW-LIST DO FILTRO COMPOSTO PARA ORÇAMENTOS.
 *
 * Espelha `BUDGET_FILTER_SPECS` (`apps/api/src/finance/repositories/budget-list-sql.ts`).
 *
 * AQUI `status` ENTRA, e a diferença em relação às filas de títulos é de DOMÍNIO, não de gosto:
 * recebíveis e pagáveis derivam a situação (lifecycle + liquidações + vencimento) e por isso não têm
 * coluna para filtrar. `fin.budgets` TEM a coluna `status` (`fin.budget_status`, ACTIVE/INACTIVE) e o
 * filtro simples já a usa — então oferecê-la no recorte composto é executável de verdade.
 *
 * `unit_id` fica fora: já é o recorte do filtro simples e o escopo de autorização. Duplicá-lo aqui
 * criaria dois caminhos para o mesmo recorte, com semânticas que podem divergir.
 */
export const BUDGET_TITLE_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { field: 'code', contractField: 'code', kind: 'text' },
  { field: 'name', contractField: 'name', kind: 'text' },
  { field: 'currency_code', contractField: 'currencyCode', kind: 'text' },
  { field: 'status', contractField: 'status', kind: 'enum' },
  { field: 'created_at', contractField: 'createdAt', kind: 'date' },
  { field: 'updated_at', contractField: 'updatedAt', kind: 'date' },
];

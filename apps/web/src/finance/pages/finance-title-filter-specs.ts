import type { AdvancedFilterFieldSpec } from '../../engine';

/**
 * ALLOW-LIST DO FILTRO COMPOSTO PARA CONTAS A RECEBER E A PAGAR.
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

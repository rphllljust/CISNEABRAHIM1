import type { MetaEntitySchema, MetaField, MetaView } from '../../engine';
import type { ExpenseSummary } from '../api/finance-api';

/**
 * ADAPTADOR DE DESPESAS — DTO da API ⇄ schema do metadata store.
 *
 * A engine indexa por NOME DE CAMPO do metadata store (`description`, `status`, `total_amount`,
 * `due_date`), enquanto o DTO usa camelCase. Este é o único lugar onde as duas nomenclaturas se
 * encontram — o mesmo padrão de `budget-engine-rows.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE O ADAPTADOR PROJETA A VIEW
 *
 * A tela exibe cinco colunas: Descrição, Centro de custo, Vencimento, Valor e Situação. Duas
 * diferenças em relação à view `list` do metadado precisam ser resolvidas aqui:
 *
 *   1. `cost_center_code` — o campo EXISTE em `meta.fields` de `expenses`, mas está fora da view
 *      `list` (`in_list: false`), e `useColumns` devolve EXCLUSIVAMENTE o que `layout.columns`
 *      declarar. Sem reabilitá-lo, "Centro de custo" sumiria.
 *   2. `reimbursable` e `created_at` — estão na view mas a tela não os exibe. Saem para manter a
 *      grade exatamente com as cinco colunas de negócio (nem coluna perdida, nem coluna inventada).
 *
 * A projeção é LOCAL à tela. Nada é escrito no metadata global.
 */

export type ExpenseEngineRow = Record<string, unknown> & { id: string };

export function expenseEngineRows(items: ExpenseSummary[]): ExpenseEngineRow[] {
  return items.map((item) => ({
    id: item.id,
    description: item.description,
    cost_center_code: item.costCenterCode,
    total_amount: item.totalAmount,
    currency_code: item.currencyCode,
    due_date: item.dueDate,
    status: item.status,
    version: item.version,
  }));
}

/**
 * ORDEM DE COLUNAS — valor antes do prazo, prazo antes da situação.
 *
 * É a ordem de leitura do operador de contas a pagar: O QUE é (descrição + centro de custo),
 * QUANTO custa, QUANDO vence e em QUE ESTADO está. "Centro de custo" fica ao lado da descrição
 * porque é o segundo qualificador do mesmo registro, não uma coluna de estado.
 */
const EXPENSES_LIST_COLUMNS = [
  'description',
  'cost_center_code',
  'total_amount',
  'due_date',
  'status',
] as const;

/** Campos da view do metadado que a grade de trabalho não exibe. */
const DROPPED_COLUMNS = new Set(['reimbursable', 'created_at']);

/**
 * Tipo neutro para o leitor de AGING.
 *
 * `DynamicList` deriva uma coluna de "Aging" quando nenhum `agingField` é declarado, e para isso
 * percorre os campos em DUAS etapas (`resolveAgingField`):
 *
 *   schema.fields.find((f) => f.name === 'created_at')
 *     ?? schema.fields.find((f) => f.type === 'datetime' || f.type === 'date')
 *
 * Esta lista não tem coluna de aging — "Aging" é conceito de TÍTULO (contas a pagar/receber), e
 * despesa se acompanha por VENCIMENTO. As duas etapas têm de ser barradas, e remover campos não
 * serve: `due_date` é uma COLUNA exigida na grade e é do tipo `date` no metadado — removê-la
 * mataria a coluna; mantê-la do tipo `date` faria a segunda etapa encontrá-la e a coluna "Aging"
 * reaparecer.
 *
 * A solução é apresentar `due_date` como tipo NÃO temporal. A célula de Vencimento não depende
 * disso — a tela a desenha por `renderCell` com `DateTime`, e continua recebendo o valor ISO real
 * da linha. A mudança afeta apenas o leitor de aging, que é quem consulta `type`.
 *
 * `data` é o tipo neutro do próprio metadado (string livre): não é `date` nem `datetime`, então
 * nenhuma das duas etapas o encontra.
 */
const AGING_NEUTRAL_TYPE = 'data';

/**
 * Rótulos LOCAIS da view — a grade projeta as colunas da tela, então também projeta o vocabulário
 * DELA.
 *
 * "Valor total" é o rótulo do metadado bruto; na mesa de trabalho a coluna se chama "Valor". A
 * projeção é local à tela (o metadado global não é tocado) e mantém a grade e o rodapé de totais
 * falando a mesma língua.
 */
const EXPENSE_LIST_LABELS: Record<string, string> = {
  total_amount: 'Valor',
  cost_center_code: 'Centro de custo',
  due_date: 'Vencimento',
  status: 'Situação',
};

/** Campo do centro de custo reabilitado — o metadado o possui; a view local o liga. */
function costCenterField(schema: MetaEntitySchema): MetaField | null {
  const declared = schema.fields.find((field) => field.name === 'cost_center_code');
  if (!declared) {
    return null;
  }
  return { ...declared, inList: true, listOrder: 25 };
}

/**
 * Schema da tela: schema da entidade com a view `list` ajustada à grade de trabalho.
 *
 * `cost_center_code` é SUBSTITUÍDO na lista de campos, nunca acrescentado: `useColumns` resolve a
 * coluna por `schema.fields.find((f) => f.name === name)` e confere `inList`. Um campo duplicado
 * faria o `find` devolver o ORIGINAL (`inList: false`) e a coluna sumiria em silêncio.
 *
 * Devolve `null` quando não há schema — mesma regra do `DynamicList`, que aceita `null` e deixa a
 * TELA decidir o que mostrar enquanto o metadado não chega.
 */
export function expensesListSchema(schema: MetaEntitySchema | null): MetaEntitySchema | null {
  if (!schema) {
    return null;
  }
  const listView = schema.views.find((view) => view.viewType === 'list');
  if (!listView) {
    return schema;
  }
  const costCenter = costCenterField(schema);
  const projectedView: MetaView = {
    ...listView,
    layout: { ...listView.layout, columns: [...EXPENSES_LIST_COLUMNS] },
  };
  return {
    ...schema,
    /*
     * O rótulo do MÓDULO não é o rótulo da ENTIDADE.
     *
     * `schema.label` de `expenses` é o singular do cadastro ("Despesa"). A worklist é a coleção —
     * o `<h1>` de uma lista de ERP nomeia a LISTA, não um registro. O rótulo continua vindo da
     * tela (projeção local), e o `labelField` do metadado não é tocado.
     */
    label: 'Despesas',
    fields: schema.fields
      /*
       * `reimbursable` e `created_at` saem da lista de CAMPOS, não só da view. Removê-los apenas
       * do `layout.columns` esconderia a coluna, mas o campo continuaria em `schema.fields` — e é
       * de lá que `resolveAgingField` deriva a coluna "Aging" a partir de `created_at` (`datetime`).
       * A ausência dos DOIS é o que a grade exige: coluna e capacidade derivada.
       */
      .filter((field) => !DROPPED_COLUMNS.has(field.name))
      .map((field) => {
        const label = EXPENSE_LIST_LABELS[field.name];
        const relabeled = label ? { ...field, label } : field;
        if (field.name === 'cost_center_code') {
          return costCenter ? { ...costCenter, ...(label ? { label } : {}) } : relabeled;
        }
        // Vencimento permanece como coluna; muda apenas o TIPO que o leitor de aging consulta.
        if (field.name === 'due_date') {
          return { ...relabeled, type: AGING_NEUTRAL_TYPE };
        }
        return relabeled;
      }),
    views: schema.views.map((view) => (view === listView ? projectedView : view)),
  };
}

/** Colunas que a view projetada exibe — usado pelos testes de paridade. */
export function expensesProjectedColumns(): string[] {
  return EXPENSES_LIST_COLUMNS.filter((name) => !DROPPED_COLUMNS.has(name));
}

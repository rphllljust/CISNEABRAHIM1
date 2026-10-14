/**
 * Contratos da engine de renderização.
 *
 * Espelham `apps/api/src/meta/meta.service.ts`. O frontend NÃO conhece entidade: conhece a
 * FORMA da entidade, recebida de `/api/v1/meta/:entity`.
 */

export type FieldType =
  | 'data'
  | 'text'
  | 'currency'
  | 'select'
  | 'link'
  | 'date'
  | 'datetime'
  | 'bool'
  | 'integer';

export type SelectOption = {
  value: string;
  label: string;
};

export type FieldOptions = {
  options?: SelectOption[];
  entity?: string;
  currencyField?: string;
};

export type MetaField = {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  readOnly: boolean;
  permLevel: number;
  options: FieldOptions | null;
  fieldOrder: number;
  inForm: boolean;
  inList: boolean;
  listOrder: number;
  inFilter: boolean;
  inSearch: boolean;
  /**
   * V2 — agregação de coluna (`sum`/`count`/`avg`/`min`/`max`).
   *
   * BLOQUEADA — aggregations — API_CONTRACT_MISSING: a coluna existe em `meta.fields` mas o
   * endpoint não a projeta. O tipo já a declara para que a engine a consuma no dia em que o
   * canal existir, sem nenhuma outra alteração.
   */
  aggregation?: string | null;
  /** V2 — condição de visibilidade `{ field, equals }`. Mesmo bloqueio de canal. */
  visibleWhen?: Record<string, unknown> | null;
};

export type ViewSection = {
  title: string;
  fields: string[];
};

export type FormLayout = {
  sections?: ViewSection[];
};

export type ListLayout = {
  columns?: string[];
};

export type KanbanLayout = {
  groupBy?: string;
  cardFields?: string[];
};

/**
 * LAYOUTS POR TIPO DE VIEW.
 *
 * Cada `view_type` lê chaves próprias de `layout`, e a engine as valida em tempo de render
 * (uma view que não declara `groupBy` recebe um aviso nomeado, não uma tela vazia). Manter os
 * tipos aqui — em vez de um `Record<string, unknown>` — é o que faz o compilador acusar uma
 * tela que monte a view com o eixo errado.
 */
export type PivotLayout = {
  groupBy?: string[];
  valueField?: string;
  aggregateOp?: string;
};

export type TreeLayout = {
  parentField?: string;
  labelField?: string;
  idField?: string;
};

export type GraphLayout = {
  categoryField?: string;
  valueField?: string;
  chartType?: string;
  aggregateOp?: string;
  maxCategories?: number;
};

/**
 * TIPOS DE VIEW — espelha `meta.meta_views_type_chk`, não a lista que a engine sabe desenhar.
 *
 * DEFEITO CORRIGIDO: esta união declarava apenas `form | list | kanban | calendar`, mas a
 * migration 0088 ampliou o CHECK do banco para aceitar também `pivot`, `tree` e `graph` e
 * passou a SEMEAR as três para `service-orders`. O tipo do cliente ficou para trás do banco:
 * o servidor podia devolver um `viewType` que o compilador jurava impossível, e qualquer
 * `switch` exaustivo escrito sobre a união estreita estaria errado por construção.
 *
 * O `& {}` preserva o autocompletar dos literais conhecidos sem fechar o conjunto: uma view
 * nova registrada no banco chega tipada como `string` em vez de erro de compilação — porque
 * acrescentar capacidade é uma escrita no metadata store, não um deploy de frontend.
 */
export type MetaViewType = 'form' | 'list' | 'kanban' | 'calendar' | 'pivot' | 'tree' | 'graph';

export type MetaView = {
  viewType: MetaViewType | (string & {});
  label: string;
  layout: FormLayout &
    ListLayout &
    KanbanLayout &
    PivotLayout &
    TreeLayout &
    GraphLayout;
  isDefault: boolean;
  /** V2 — regras de cor de linha. Mesmo bloqueio de canal das demais capacidades. */
  rowAccent?: unknown;
};

export type MetaTransition = {
  command: string;
  label: string;
  fromStates: string[];
  toState: string;
  permission: string;
  requiresReason: boolean;
  buttonOrder: number;
  /** Calculado pelo SERVIDOR a partir dos grants reais do ator. */
  allowed: boolean;
};

export type MetaWorkflow = {
  stateField: string;
  states: string[];
  transitions: MetaTransition[];
};

export type MetaPermission = {
  action: string;
  permLevel: number;
  requiredPermission: string | null;
  allowed: boolean;
};

/** Schema completo de uma entidade, como o servidor entrega (já filtrado por permissão). */
export type MetaEntitySchema = {
  name: string;
  label: string;
  description: string | null;
  dataSchema: string;
  dataTable: string;
  labelField: string;
  fields: MetaField[];
  /** V2 — campos derivados por fórmula. Mesmo bloqueio de canal. */
  computedFields?: unknown[];
  views: MetaView[];
  workflow: MetaWorkflow | null;
  permissions: MetaPermission[];
  allowedPermLevels: number[];
};

/** Registro de entidade disponível para a engine. */
export type MetaEntitySummary = {
  name: string;
  label: string;
  description: string | null;
};

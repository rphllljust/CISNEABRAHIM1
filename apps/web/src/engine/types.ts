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

export type MetaView = {
  viewType: 'form' | 'list' | 'kanban' | 'calendar';
  label: string;
  layout: FormLayout & ListLayout & KanbanLayout;
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

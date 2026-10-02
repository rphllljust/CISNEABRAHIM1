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

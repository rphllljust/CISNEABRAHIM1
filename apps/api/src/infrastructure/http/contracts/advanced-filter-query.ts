/**
 * PARSER GENÉRICO DE FILTRO AVANÇADO.
 *
 * Os três domínios comerciais (Propostas, Pedidos de compra e Contratos) e os demais módulos
 * publicam o MESMO payload: grupos com conjunção interna, ligados por `connector`, campos por
 * allow-list e valores sempre parametrizados. A validação de FORMA é idêntica em todo lugar; o que
 * muda por domínio é apenas o conjunto de campos aceitos e o predicado de tipo de cada um.
 *
 * Este módulo implementa a forma UMA vez. Cada domínio declara a sua especificação de campos e
 * delega — em vez de reescrever o parser, que é onde divergências de validação nascem.
 */

export type AdvancedFilterKind = 'text' | 'date' | 'enum';

export type AdvancedFilterFieldSpec = {
  /** Nome do campo no contrato do servidor. */
  name: string;
  kind: AdvancedFilterKind;
  /** Aceito apenas quando `kind` é `enum`: validador do vocabulário real do domínio. */
  isValidEnumValue?: (value: string) => boolean;
};

export type AdvancedFilterCondition = {
  field: string;
  operator: string;
  value: string;
};

export type AdvancedFilter = {
  connector: 'AND' | 'OR';
  groups: Array<{ conditions: AdvancedFilterCondition[] }>;
};

export type AdvancedFilterOperator = 'eq' | 'neq' | 'contains' | 'startsWith' | 'before' | 'after';

export const ADVANCED_FILTER_OPERATORS: readonly AdvancedFilterOperator[] = [
  'eq',
  'neq',
  'contains',
  'startsWith',
  'before',
  'after',
];

/** Operadores que cada família de campo admite. Fora disto a condição é recusada. */
const OPERATORS_BY_KIND: Record<AdvancedFilterKind, readonly AdvancedFilterOperator[]> = {
  text: ['eq', 'neq', 'contains', 'startsWith'],
  date: ['before', 'after'],
  enum: ['eq', 'neq'],
};

export const ADVANCED_FILTER_MAX_GROUPS = 8;
export const ADVANCED_FILTER_MAX_CONDITIONS_PER_GROUP = 8;

export class AdvancedFilterParseError extends Error {
  constructor(readonly field: string) {
    super(field);
    this.name = 'AdvancedFilterParseError';
  }
}

/**
 * Valida e normaliza o filtro avançado.
 *
 * Uma condição inválida derruba a requisição (o chamador traduz para 400) em vez de ser descartada:
 * descartar em silêncio faria a tela mostrar um recorte que o servidor não aplicou — o operador
 * leria a lista inteira como resultado de um filtro.
 */
export function parseAdvancedFilter(
  value: unknown,
  specs: readonly AdvancedFilterFieldSpec[],
): AdvancedFilter | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const decoded = decodeJsonValue(value, 'filters');
  if (decoded === undefined) {
    return undefined;
  }
  if (typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new AdvancedFilterParseError('filters');
  }

  const record = decoded as Record<string, unknown>;
  const connector = record['connector'];
  if (connector !== 'AND' && connector !== 'OR') {
    throw new AdvancedFilterParseError('filters.connector');
  }

  const groupsRaw = record['groups'];
  if (!Array.isArray(groupsRaw) || groupsRaw.length === 0) {
    return undefined;
  }
  if (groupsRaw.length > ADVANCED_FILTER_MAX_GROUPS) {
    throw new AdvancedFilterParseError('filters.groups');
  }

  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const groups: AdvancedFilter['groups'] = [];

  for (const groupRaw of groupsRaw) {
    if (!groupRaw || typeof groupRaw !== 'object' || Array.isArray(groupRaw)) {
      throw new AdvancedFilterParseError('filters.groups');
    }
    const conditionsRaw = (groupRaw as Record<string, unknown>)['conditions'];
    if (!Array.isArray(conditionsRaw) || conditionsRaw.length === 0) {
      continue;
    }
    if (conditionsRaw.length > ADVANCED_FILTER_MAX_CONDITIONS_PER_GROUP) {
      throw new AdvancedFilterParseError('filters.groups.conditions');
    }
    groups.push({
      conditions: conditionsRaw.map((condition) => parseCondition(condition, byName)),
    });
  }

  return groups.length > 0 ? { connector, groups } : undefined;
}

function parseCondition(
  value: unknown,
  byName: Map<string, AdvancedFilterFieldSpec>,
): AdvancedFilterCondition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdvancedFilterParseError('filters.conditions');
  }
  const record = value as Record<string, unknown>;
  const field = record['field'];
  const operator = record['operator'];
  const rawValue = record['value'];

  if (typeof field !== 'string') {
    throw new AdvancedFilterParseError('filters.field');
  }
  const spec = byName.get(field);
  if (!spec) {
    throw new AdvancedFilterParseError('filters.field');
  }
  if (typeof operator !== 'string' || !ADVANCED_FILTER_OPERATORS.includes(operator as AdvancedFilterOperator)) {
    throw new AdvancedFilterParseError('filters.operator');
  }
  // Operador que a FAMÍLIA do campo não admite é recusado: `contains` sobre enum exigiria inventar
  // semântica sobre o domínio, e ordem sobre texto não é a intenção quase nunca.
  if (!OPERATORS_BY_KIND[spec.kind].includes(operator as AdvancedFilterOperator)) {
    throw new AdvancedFilterParseError('filters.operator');
  }
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new AdvancedFilterParseError('filters.value');
  }

  const trimmed = rawValue.trim();

  if (spec.kind === 'date' && Number.isNaN(Date.parse(trimmed))) {
    throw new AdvancedFilterParseError('filters.value');
  }
  if (spec.kind === 'enum' && spec.isValidEnumValue && !spec.isValidEnumValue(trimmed)) {
    throw new AdvancedFilterParseError('filters.value');
  }

  return { field, operator, value: trimmed };
}

/**
 * Aceita o valor já decodificado ou a forma textual que viaja na URL.
 *
 * JSON malformado é erro — nunca filtro silenciosamente ausente: ignorar faria a tela exibir a
 * lista inteira como se o recorte tivesse sido aplicado.
 */
function decodeJsonValue(value: unknown, field: string): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AdvancedFilterParseError(field);
  }
}

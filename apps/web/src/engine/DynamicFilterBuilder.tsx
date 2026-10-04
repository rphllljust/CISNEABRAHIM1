import { useMemo, useState } from 'react';
import { t } from '../i18n';
import { toDisplayText } from './FieldRenderer';
import type { MetaEntitySchema, MetaField } from './types';

/**
 * CONSTRUTOR VISUAL DE FILTROS — árvore AND/OR aninhável, serializada para a URL.
 *
 * Espelha o que os três ERPs de referência já resolveram:
 *
 *   Odoo      — `ir.filters`: um filtro é um DOMAIN, ou seja uma ÁRVORE (`['&', ('a','=',1),
 *               '|', ('b','>',2), ('c','=',3)]`), editável no construtor de filtros da UI. Duas
 *               regras lado a lado são implicitamente AND.
 *   ERPNext   — Report Filter / `filters` com `Filter Group`: grupos aninháveis com operador por
 *               grupo, salvos como JSON no relatório.
 *   iDempiere — AD_InfoWindow: cada `AD_InfoColumn` declara se é filtrável, e a InfoWindow monta
 *               os critérios a partir da coluna + operador.
 *
 * O que os três têm em comum, e é o contrato implementado aqui: a ÁRVORE é o dado (não um
 * formulário plano), o operador vive no GRUPO (não na regra), e o filtro é SERIALIZÁVEL — existe
 * fora da tela, para ser salvo, reenviado e compartilhado.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA ENGINE NÃO INVENTA: A AVALIAÇÃO
 *
 * O construtor monta e SERIALIZA a árvore. Avaliar a árvore sobre a página carregada é
 * implementado (`matchesFilterGroup`) porque a lista já tem as linhas em memória, mas o caminho
 * OFICIAL é o servidor: `filterGroupToQuery` produz os query params que a API já aceita. Avaliar
 * no navegador um recorte que o servidor deveria aplicar mostraria "resultado" de uma consulta
 * que ninguém fez — por isso os dois caminhos existem e a tela escolhe.
 */

export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'in'
  | 'is_true'
  | 'is_false';

export type FilterRule = {
  field: string;
  op: FilterOperator;
  value: string;
};

export type FilterGroup = {
  op: 'AND' | 'OR';
  rules: FilterRule[];
  groups?: FilterGroup[];
};

export type DynamicFilterBuilderProps = {
  schema: MetaEntitySchema | null;
  value: FilterGroup;
  onChange: (next: FilterGroup) => void;
  /** Limite de aninhamento. 2 níveis é o que o construtor do Odoo oferece na UI padrão. */
  maxDepth?: number;
};

/**
 * OPERADORES POR TIPO — a decisão central deste componente.
 *
 * Um construtor que oferece `>` para um campo de texto, ou `contains` para um booleano, produz
 * filtro que o servidor não sabe executar e que o operador lê como "a lista está vazia". Todo ERP
 * maduro fecha esse conjunto: o Odoo o deriva do tipo do campo no domain, o NetSuite usa
 * "Available Filters" por tipo de coluna, o Fiori expõe operadores por tipo de dado.
 *
 * Texto não recebe `>`/`<`: ordem lexicográfica sobre descrição é quase nunca a intenção, e um
 * campo `select` é exatamente isso — um texto com conjunto fechado de valores.
 */
const TEXT_OPERATORS: FilterOperator[] = ['=', '!=', 'contains', 'in'];
const NUMBER_OPERATORS: FilterOperator[] = ['=', '!=', '>', '>=', '<', '<='];
const DATE_OPERATORS: FilterOperator[] = ['=', '!=', '>', '>=', '<', '<='];
const SELECT_OPERATORS: FilterOperator[] = ['=', '!=', 'in'];
const BOOL_OPERATORS: FilterOperator[] = ['is_true', 'is_false'];
const LINK_OPERATORS: FilterOperator[] = ['=', '!=', 'in'];

/** Operadores que NÃO consomem valor: o próprio operador é a condição. */
const VALUELESS_OPERATORS: ReadonlySet<FilterOperator> = new Set(['is_true', 'is_false']);

export function operatorsForType(type: MetaField['type'] | undefined): FilterOperator[] {
  switch (type) {
    case 'currency':
    case 'integer':
      return NUMBER_OPERATORS;
    case 'date':
    case 'datetime':
      return DATE_OPERATORS;
    case 'select':
      return SELECT_OPERATORS;
    case 'bool':
      return BOOL_OPERATORS;
    case 'link':
      return LINK_OPERATORS;
    default:
      return TEXT_OPERATORS;
  }
}

/** Primeiro operador de um tipo — o default de uma regra nova. */
export function defaultOperatorFor(type: MetaField['type'] | undefined): FilterOperator {
  return operatorsForType(type)[0] ?? '=';
}

/**
 * Rótulo do operador. SÍMBOLO quando existe um (`=`, `≠`, `∈`) — símbolo não é idioma e não
 * precisa de catálogo. Palavra vai pelo `t()`, como `list.yes`/`list.no`, que já existem.
 */
const OPERATOR_LABELS: Record<FilterOperator, string> = {
  '=': '=',
  '!=': '≠',
  '>': '>',
  '>=': '≥',
  '<': '<',
  '<=': '≤',
  contains: '⊃',
  in: '∈',
  is_true: `= ${t('common.yes')}`,
  is_false: `= ${t('common.no')}`,
};

/** Grupo vazio — o ponto de partida de todo filtro novo. */
export function emptyFilterGroup(op: 'AND' | 'OR' = 'AND'): FilterGroup {
  return { op, rules: [], groups: [] };
}

/**
 * Serializa a árvore para o formato de query string.
 *
 * FORMATO: JSON compacto numa única chave. A alternativa — achatado em `field.op.value` — perde o
 * AGRUPAMENTO, e um filtro que não consegue expressar `(A e B) ou C` não é um construtor, é uma
 * lista de campos. Uma chave só mantém a árvore inteira e é o que o Odoo faz ao gravar o domain
 * em `ir_filters.domain` como texto.
 */
export const FILTER_PARAM = 'filter';

export function filterGroupToQuery(group: FilterGroup): URLSearchParams {
  const params = new URLSearchParams();
  if (!isFilterGroupActive(group)) {
    return params;
  }
  params.set(FILTER_PARAM, JSON.stringify(compactGroup(group)));
  return params;
}

/** Lê a árvore de query params. Estrutura inválida devolve grupo vazio em vez de lançar. */
export function readFilterGroup(
  params: URLSearchParams | string,
  maxDepth = 2,
): FilterGroup {
  const raw =
    typeof params === 'string' ? new URLSearchParams(params).get(FILTER_PARAM) : params.get(FILTER_PARAM);
  if (!raw) {
    return emptyFilterGroup();
  }
  try {
    return normalizeGroup(JSON.parse(raw), maxDepth) ?? emptyFilterGroup();
  } catch {
    return emptyFilterGroup();
  }
}

/** Um grupo sem nenhuma regra (nem em subgrupo) não é um filtro — é um formulário em branco. */
export function isFilterGroupActive(group: FilterGroup): boolean {
  if (
    group.rules.some(
      (rule) =>
        rule.field.trim() !== '' &&
        (VALUELESS_OPERATORS.has(rule.op) || rule.value.trim() !== ''),
    )
  ) {
    return true;
  }
  return (group.groups ?? []).some(isFilterGroupActive);
}

/** Descrição legível da árvore — o "chips" de resumo que o Odoo mostra acima da lista. */
export function describeFilterGroup(group: FilterGroup): string {
  const parts: string[] = [];
  for (const rule of group.rules) {
    if (rule.field.trim() === '') {
      continue;
    }
    if (!VALUELESS_OPERATORS.has(rule.op) && rule.value.trim() === '') {
      continue;
    }
    parts.push(
      VALUELESS_OPERATORS.has(rule.op)
        ? `${rule.field} ${OPERATOR_LABELS[rule.op]}`
        : `${rule.field} ${OPERATOR_LABELS[rule.op]} ${rule.value}`,
    );
  }
  for (const child of group.groups ?? []) {
    const nested = describeFilterGroup(child);
    if (nested !== '') {
      // Parêntese OBRIGATÓRIO: sem ele a descrição de um OR aninhado lê como se estivesse no
      // nível de cima, que é exatamente a leitura errada da árvore.
      parts.push(`(${nested})`);
    }
  }
  return parts.join(` ${group.op} `);
}

/**
 * Avalia a árvore sobre uma linha.
 *
 * Semântica IDÊNTICA à do construtor: o operador do grupo combina as regras E os subgrupos.
 * Comparação numérica quando os DOIS lados são numéricos (`>` sobre `"1000"` compararia texto e
 * diria que `"900" > "1000"` — erro clássico de filtro textual em ERP).
 */
export function matchesFilterGroup(
  group: FilterGroup,
  row: Record<string, unknown>,
): boolean {
  const results: boolean[] = [];

  for (const rule of group.rules) {
    // Regra sem valor é VÁLIDA quando o operador é valueless (`is_true`/`is_false`); nos demais,
    // uma regra sem valor ainda não foi preenchida e não pode restringir a lista.
    if (rule.field.trim() === '') {
      continue;
    }
    if (!VALUELESS_OPERATORS.has(rule.op) && rule.value.trim() === '') {
      continue;
    }
    results.push(matchesRule(rule, row));
  }
  for (const child of group.groups ?? []) {
    if (!isFilterGroupActive(child)) {
      continue;
    }
    results.push(matchesFilterGroup(child, row));
  }

  if (results.length === 0) {
    // Grupo vazio não RESTRINGE: um filtro em branco não pode esconder a lista inteira.
    return true;
  }
  return group.op === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

function matchesRule(rule: FilterRule, row: Record<string, unknown>): boolean {
  const raw = row[rule.field];

  if (rule.op === 'is_true') {
    return raw === true;
  }
  if (rule.op === 'is_false') {
    return raw === false;
  }

  const cell = toDisplayText(raw);
  const target = rule.value.trim();

  if (rule.op === 'in') {
    // Lista separada por vírgula, como o `in` do domain do Odoo.
    return target
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .some((entry) => entry === cell);
  }

  if (rule.op === 'contains') {
    return cell.toLowerCase().includes(target.toLowerCase());
  }

  if (rule.op === '=') {
    return compare(raw, target) === 0;
  }
  if (rule.op === '!=') {
    return compare(raw, target) !== 0;
  }

  const ordering = compare(raw, target);
  if (ordering === null) {
    // Comparação de ordem sobre valor não ordenável é INDETERMINADA. Devolver `false` é a escolha
    // segura: a linha não entra num recorte que não se pode provar.
    return false;
  }
  if (rule.op === '>') {
    return ordering > 0;
  }
  if (rule.op === '>=') {
    return ordering >= 0;
  }
  if (rule.op === '<') {
    return ordering < 0;
  }
  return ordering <= 0;
}

/** Compara célula e alvo. Numérico quando ambos são numéricos; senão comparação de texto. */
function compare(raw: unknown, target: string): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const parsed = Number(target);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return raw === parsed ? 0 : raw > parsed ? 1 : -1;
  }
  const cell = toDisplayText(raw);
  if (cell === '') {
    return null;
  }
  const asNumber = Number(cell);
  const targetNumber = Number(target);
  if (Number.isFinite(asNumber) && Number.isFinite(targetNumber)) {
    return asNumber === targetNumber ? 0 : asNumber > targetNumber ? 1 : -1;
  }
  return cell === target ? 0 : cell > target ? 1 : -1;
}

/**
 * Converte a árvore nos grupos que `matchesFilterGroup` consome, descartando regras em branco.
 *
 * Usado pelo caminho LOCAL — a tela tem as linhas em memória e quer filtrar sem nova consulta.
 */
export function buildFilterGroups(group: FilterGroup): FilterGroup {
  return compactGroup(group);
}

function compactGroup(group: FilterGroup): FilterGroup {
  const rules = group.rules.filter(
    (rule) =>
      rule.field.trim() !== '' &&
      (VALUELESS_OPERATORS.has(rule.op) || rule.value.trim() !== ''),
  );
  const groups = (group.groups ?? [])
    .map(compactGroup)
    .filter((child) => child.rules.length > 0 || (child.groups?.length ?? 0) > 0);
  return { op: group.op, rules, groups };
}

/**
 * Valida e normaliza uma árvore vinda de fora (URL, storage).
 *
 * Descarta o que não bate com o contrato em vez de lançar: uma URL torta tem de produzir uma
 * tela sem filtro, nunca uma tela em branco.
 */
function normalizeGroup(raw: unknown, maxDepth: number, depth = 0): FilterGroup | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const op = candidate['op'] === 'OR' ? 'OR' : 'AND';

  const rules: FilterRule[] = [];
  if (Array.isArray(candidate['rules'])) {
    for (const entry of candidate['rules']) {
      const rule = normalizeRule(entry);
      if (rule) {
        rules.push(rule);
      }
    }
  }

  const groups: FilterGroup[] = [];
  // O limite de profundidade é aplicado na LEITURA, não só na edição: uma URL forjada com 50
  // níveis de aninhamento não pode virar 50 níveis de DOM.
  if (depth < maxDepth && Array.isArray(candidate['groups'])) {
    for (const entry of candidate['groups']) {
      const child = normalizeGroup(entry, maxDepth, depth + 1);
      if (child) {
        groups.push(child);
      }
    }
  }

  return { op, rules, groups };
}

function normalizeRule(raw: unknown): FilterRule | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const field = candidate['field'];
  const value = candidate['value'];
  const op = candidate['op'];
  if (typeof field !== 'string') {
    return null;
  }
  if (!ALL_OPERATORS.has(op as FilterOperator)) {
    return null;
  }
  return {
    field,
    op: op as FilterOperator,
    value: typeof value === 'string' ? value : toDisplayText(value),
  };
}

const ALL_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'contains',
  'in',
  'is_true',
  'is_false',
]);

export function DynamicFilterBuilder({
  schema,
  value,
  onChange,
  maxDepth = 2,
}: DynamicFilterBuilderProps): React.ReactElement | null {
  const fields = useMemo(() => filterableFields(schema), [schema]);
  const [open, setOpen] = useState(() => isFilterGroupActive(value));

  if (!schema || fields.length === 0) {
    return null;
  }

  const summary = describeFilterGroup(value);

  return (
    <section
      data-testid="dynamic-filter-builder"
      data-entity={schema.name}
      className="mb-3 rounded border border-gray-200 bg-white p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          data-testid="dynamic-filter-builder-toggle"
          className="text-xs font-semibold uppercase tracking-wider text-gray-500"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {t('filters.builder')} {open ? '▾' : '▸'}
        </button>
        {isFilterGroupActive(value) ? (
          <div className="flex items-center gap-2">
            <span data-testid="dynamic-filter-builder-summary" className="text-xs text-gray-600">
              {summary}
            </span>
            <button
              type="button"
              data-testid="dynamic-filter-builder-clear"
              className="rounded border border-slate-300 px-2 py-0.5 text-xs"
              onClick={() => onChange(emptyFilterGroup())}
            >
              {t('filters.clearBuilder')}
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <FilterGroupEditor
          group={value}
          fields={fields}
          depth={0}
          maxDepth={maxDepth}
          onChange={onChange}
        />
      ) : null}
    </section>
  );
}

/**
 * Editor de UM grupo — regras, subgrupos e o botão que troca o operador.
 *
 * A recursão é a mesma do dado: um subgrupo é um `FilterGroupEditor` num nível abaixo. É assim
 * que o Odoo desenha o domain e é o que torna `(A e B) ou C` expressável sem caso especial.
 */
function FilterGroupEditor({
  group,
  fields,
  depth,
  maxDepth,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  fields: MetaField[];
  depth: number;
  maxDepth: number;
  onChange: (next: FilterGroup) => void;
  onRemove?: () => void;
}): React.ReactElement {
  const update = (patch: Partial<FilterGroup>): void => onChange({ ...group, ...patch });

  const setRule = (index: number, patch: Partial<FilterRule>): void => {
    update({
      rules: group.rules.map((rule, position) =>
        position === index ? { ...rule, ...patch } : rule,
      ),
    });
  };

  /**
   * Troca de campo — e REBAIXA o operador quando ele não pertence ao tipo novo.
   *
   * Sem isto, trocar `valor (número, >)` por `status (select)` manteria `>` sobre um select: o
   * `<select>` de operador não teria essa opção, o valor renderizado seria o do operador antigo, e
   * o filtro enviado ao servidor seria um recorte que a UI nunca mostrou. Zerar o valor junto é
   * deliberado — um valor digitado para outro campo não é dado válido para este.
   */
  const changeRuleField = (index: number, fieldName: string): void => {
    const field = fields.find((entry) => entry.name === fieldName);
    const allowed = operatorsForType(field?.type);
    setRule(index, {
      field: fieldName,
      op: allowed[0] ?? '=',
      value: '',
    });
  };

  const changeRuleOperator = (index: number, op: FilterOperator): void => {
    // Entrar num operador valueless limpa o valor: `is_true` não tem valor, e deixar o texto
    // antigo no estado produziria um filtro que o resumo mostraria mas o servidor ignoraria.
    setRule(index, VALUELESS_OPERATORS.has(op) ? { op, value: '' } : { op });
  };

  const addRule = (): void => {
    // O campo inicial é o PRIMEIRO filtrável do schema: um `<select>` vazio obrigaria o operador
    // a escolher campo antes de ver que a regra existe, e a regra em branco não filtra nada.
    const field = fields[0];
    update({
      rules: [
        ...group.rules,
        { field: field?.name ?? '', op: defaultOperatorFor(field?.type), value: '' },
      ],
    });
  };

  const removeRule = (index: number): void => {
    update({ rules: group.rules.filter((_rule, position) => position !== index) });
  };

  const addGroup = (): void => {
    update({ groups: [...(group.groups ?? []), emptyFilterGroup(group.op === 'AND' ? 'OR' : 'AND')] });
  };

  const setChild = (index: number, child: FilterGroup): void => {
    update({
      groups: (group.groups ?? []).map((entry, position) =>
        position === index ? child : entry,
      ),
    });
  };

  const removeChild = (index: number): void => {
    update({ groups: (group.groups ?? []).filter((_entry, position) => position !== index) });
  };

  return (
    <div
      data-testid="dynamic-filter-group"
      data-group-op={group.op}
      data-group-depth={String(depth)}
      className={
        depth === 0
          ? ''
          : 'mt-2 rounded border border-dashed border-gray-300 bg-gray-50 p-2'
      }
    >
      <div className="mb-2 flex items-center gap-2">
        <select
          data-testid="dynamic-filter-group-op"
          aria-label={t('filters.operator')}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-xs font-semibold"
          value={group.op}
          onChange={(event) => update({ op: event.target.value === 'OR' ? 'OR' : 'AND' })}
        >
          <option value="AND">AND</option>
          <option value="OR">OR</option>
        </select>
        <button
          type="button"
          data-testid="dynamic-filter-add-rule"
          className="rounded border border-slate-300 px-2 py-0.5 text-xs"
          onClick={addRule}
        >
          {t('filters.addCondition')}
        </button>
        {depth < maxDepth ? (
          <button
            type="button"
            data-testid="dynamic-filter-add-group"
            className="rounded border border-slate-300 px-2 py-0.5 text-xs"
            onClick={addGroup}
          >
            {t('filters.addGroup')}
          </button>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            data-testid="dynamic-filter-remove-group"
            aria-label={t('filters.removeGroup')}
            className="ml-auto rounded border border-red-200 px-2 py-0.5 text-xs text-red-700"
            onClick={onRemove}
          >
            {t('filters.removeGroup')}
          </button>
        ) : null}
      </div>

      {group.rules.map((rule, index) => {
        const field = fields.find((entry) => entry.name === rule.field) ?? null;
        const operators = operatorsForType(field?.type);
        const valueless = VALUELESS_OPERATORS.has(rule.op);
        return (
          <div key={`rule-${index}`} data-testid="dynamic-filter-rule" className="mb-1 flex items-center gap-2">
            <select
              data-testid="dynamic-filter-rule-field"
              aria-label={t('filters.field')}
              className="rounded border border-gray-300 px-1.5 py-0.5 text-sm"
              value={rule.field}
              onChange={(event) => changeRuleField(index, event.target.value)}
            >
              {fields.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.label}
                </option>
              ))}
            </select>

            <select
              data-testid="dynamic-filter-rule-op"
              aria-label={t('filters.operator')}
              className="rounded border border-gray-300 px-1.5 py-0.5 text-sm"
              value={rule.op}
              onChange={(event) => changeRuleOperator(index, event.target.value as FilterOperator)}
            >
              {/* Só os operadores que o TIPO aceita chegam à UI — é o que impede filtro inválido. */}
              {operators.map((operator) => (
                <option key={operator} value={operator}>
                  {OPERATOR_LABELS[operator]}
                </option>
              ))}
            </select>

            {valueless ? null : (
              <RuleValueInput
                field={field}
                rule={rule}
                onChange={(next) => setRule(index, { value: next })}
              />
            )}

            <button
              type="button"
              data-testid="dynamic-filter-remove-rule"
              aria-label={t('filters.removeCondition')}
              className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-700"
              onClick={() => removeRule(index)}
            >
              ×
            </button>
          </div>
        );
      })}

      {(group.groups ?? []).map((child, index) => (
        <FilterGroupEditor
          key={`group-${index}`}
          group={child}
          fields={fields}
          depth={depth + 1}
          maxDepth={maxDepth}
          onChange={(next) => setChild(index, next)}
          onRemove={() => removeChild(index)}
        />
      ))}
    </div>
  );
}

/**
 * Controle do valor, por TIPO do campo.
 *
 * `select` vira `<select>` com as opções do metadado — e `in` sobre um select continua texto,
 * porque uma lista de valores não cabe num seletor único. `date` vira `<input type="date">`.
 * O resto é texto. Mesmo mapa tipo→controle do formulário e da lista.
 */
function RuleValueInput({
  field,
  rule,
  onChange,
}: {
  field: MetaField | null;
  rule: FilterRule;
  onChange: (next: string) => void;
}): React.ReactElement {
  const className = 'rounded border border-gray-300 px-1.5 py-0.5 text-sm';
  const label = `${t('filters.value')}: ${field?.label ?? rule.field}`;

  if (field?.type === 'select' && rule.op !== 'in') {    return (
      <select
        data-testid="dynamic-filter-rule-value"
        aria-label={label}
        className={className}
        value={rule.value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">—</option>
        {(field.options?.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  const inputType = field?.type === 'date' || field?.type === 'datetime' ? 'date' : 'text';
  return (
    <input
      data-testid="dynamic-filter-rule-value"
      aria-label={label}
      type={inputType}
      className={className}
      value={rule.value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * Campos oferecidos pelo construtor.
 *
 * `in_filter` do metadado é a fonte; sem nenhum campo marcado, cai para os campos de lista —
 * um construtor sem campo nenhum seria um painel que não filtra. `readOnly` fica de fora: filtrar
 * por campo que o operador não edita é legítimo, mas um campo acima do nível dele não chega aqui.
 */
function filterableFields(schema: MetaEntitySchema | null): MetaField[] {
  if (!schema) {
    return [];
  }
  const allowed = (field: MetaField): boolean =>
    schema.allowedPermLevels.includes(field.permLevel);
  const declared = schema.fields.filter((field) => field.inFilter && allowed(field));
  const pool = declared.length > 0 ? declared : schema.fields.filter((field) => field.inList && allowed(field));
  return pool.slice().sort((left, right) => left.fieldOrder - right.fieldOrder);
}

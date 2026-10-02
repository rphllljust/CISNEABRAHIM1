/**
 * Capacidades V2 da engine — computed fields, aggregations, condicionalidade e accents.
 *
 * CANAL DE TRANSPORTE, DECLARADO SEM EUFEMISMO: o endpoint que a engine consome
 * (`GET /api/v1/meta/:entity`) projeta `meta.fields` COLUNA A COLUNA — `aggregation` e
 * `visible_when` não estão nessa projeção — e `meta.computed_fields` é tabela nova, sem rota.
 * Nesta sessão é PROIBIDO tocar `apps/api/`.
 *
 * O que a API devolve CRU é `meta.fields.options` (jsonb) e `meta.views.layout` (jsonb). São
 * esses dois canais que carregam a configuração V2:
 *   - `field.options.aggregation` e `field.options.visibleWhen` → declaração DO CAMPO;
 *   - `view.layout.rowAccents` e `view.layout.computedFields` → declaração DA VIEW.
 *
 * Isto NÃO é contorno: `options` existe precisamente para configuração que varia por tipo de
 * campo, e `layout` para composição da view. As colunas de primeira classe em `meta.*`
 * (migration 0087) ficam prontas para quando a projeção da API incluí-las — quando isso
 * acontecer, só o leitor abaixo muda; nenhum componente da engine.
 */

export type ComputedFormulaOp = 'diff_days';

/**
 * Fórmula de campo computado.
 *
 * Conjunto FECHADO de operadores. Não é linguagem genérica, não é `eval`, e nada que venha do
 * metadata store é executado como código: a engine reconhece a operação pelo nome e aplica a
 * implementação local. Fórmula desconhecida não quebra a lista — a coluna some.
 */
export type ComputedFormula = {
  op: ComputedFormulaOp;
  args: string[];
};

/** Campo derivado, declarado na view. Não existe no banco. */
export type ComputedField = {
  name: string;
  label: string;
  type: string;
  formula: ComputedFormula;
  listOrder: number;
  aggregation?: AggregationKind;
  permLevel: number;
};

export type AggregationKind = 'sum' | 'count' | 'avg' | 'min' | 'max';

/** Visibilidade condicional: `field` igual a `equals` mostra; qualquer outro valor esconde. */
export type VisibleWhen = {
  field: string;
  equals: string;
};

/** Cor de linha por regra. Primeira regra que casar vence. */
export type RowAccentRule = {
  when: { field: string; equals: string };
  accent: RowAccentToken;
};

/**
 * Tokens SEMÂNTICOS de accent — nunca hexadecimal.
 *
 * A engine não conhece a paleta: ela publica o TOKEN e o design system decide a cor. Um `#b91c1c`
 * gravado no metadado amarraria a regra de negócio a um valor visual, e trocar o tema exigiria
 * UPDATE no banco.
 */
export type RowAccentToken = 'critical' | 'warning' | 'info' | 'success' | 'neutral';

const AGGREGATION_KINDS: ReadonlySet<string> = new Set(['sum', 'count', 'avg', 'min', 'max']);
const ACCENT_TOKENS: ReadonlySet<string> = new Set([
  'critical',
  'warning',
  'info',
  'success',
  'neutral',
]);
const COMPUTED_TYPES: ReadonlySet<string> = new Set([
  'data',
  'text',
  'currency',
  'select',
  'link',
  'date',
  'datetime',
  'bool',
  'integer',
]);

export function isAggregationKind(value: unknown): value is AggregationKind {
  return typeof value === 'string' && AGGREGATION_KINDS.has(value);
}

export function isRowAccentToken(value: unknown): value is RowAccentToken {
  return typeof value === 'string' && ACCENT_TOKENS.has(value);
}

/**
 * Lê `visibleWhen` de um campo.
 *
 * Contrato suportado nesta versão: SOMENTE `{ field, equals }`. Um objeto com chaves extras
 * continua válido — as extras são ignoradas, não rejeitadas —, mas um objeto sem `field` ou
 * sem `equals` é INVÁLIDO e o campo permanece visível. Fail-open aqui é deliberado: esconder
 * um campo por causa de uma regra malformada apagaria dado da tela sem explicação.
 */
export function readVisibleWhen(options: Record<string, unknown> | null): VisibleWhen | null {
  if (!options) {
    return null;
  }
  const raw = options['visibleWhen'];
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const field = candidate['field'];
  const equals = candidate['equals'];
  if (typeof field !== 'string' || field.trim() === '') {
    return null;
  }
  if (typeof equals !== 'string') {
    return null;
  }
  return { field, equals };
}

/** Lê `aggregation` de um campo. Valor fora do contrato é tratado como ausente. */
export function readAggregation(options: Record<string, unknown> | null): AggregationKind | null {
  if (!options) {
    return null;
  }
  const raw = options['aggregation'];
  return isAggregationKind(raw) ? raw : null;
}

/**
 * Lê os campos computados da view.
 *
 * Fórmula malformada faz o campo ser DESCARTADO — nunca lança. Uma lista que não renderiza
 * porque um administrador digitou `op` errado é pior que uma lista sem a coluna derivada.
 */
export function readComputedFields(
  layout: Record<string, unknown> | undefined,
  allowedPermLevels: readonly number[],
): ComputedField[] {
  const raw = layout?.['computedFields'];
  if (!Array.isArray(raw)) {
    return [];
  }
  const parsed: ComputedField[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const name = candidate['name'];
    const label = candidate['label'];
    const type = candidate['type'];
    const permLevel = candidate['permLevel'];
    const listOrder = candidate['listOrder'];

    if (typeof name !== 'string' || name.trim() === '') {
      continue;
    }
    if (typeof label !== 'string' || label.trim() === '') {
      continue;
    }
    if (typeof type !== 'string' || !COMPUTED_TYPES.has(type)) {
      continue;
    }
    const formula = readFormula(candidate['formula']);
    if (!formula) {
      continue;
    }
    const level = typeof permLevel === 'number' && Number.isFinite(permLevel) ? permLevel : 0;
    // Segunda barreira de permissão: campo acima do nível do ator não entra na view.
    if (!allowedPermLevels.includes(level)) {
      continue;
    }
    const aggregation = isAggregationKind(candidate['aggregation'])
      ? candidate['aggregation']
      : undefined;
    parsed.push({
      name,
      label,
      type,
      formula,
      listOrder: typeof listOrder === 'number' && Number.isFinite(listOrder) ? listOrder : 0,
      ...(aggregation ? { aggregation } : {}),
      permLevel: level,
    });
  }
  return parsed.sort((left, right) => left.listOrder - right.listOrder);
}

function readFormula(raw: unknown): ComputedFormula | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const op = candidate['op'];
  const args = candidate['args'];
  // ÚNICA operação suportada nesta versão. Nada de linguagem genérica.
  if (op !== 'diff_days') {
    return null;
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    return null;
  }
  if (args.length !== 2) {
    return null;
  }
  return { op: 'diff_days', args: args as string[] };
}

/**
 * Lê as regras de accent de linha da view.
 *
 * Regra malformada é descartada individualmente — as demais continuam valendo. Accent fora dos
 * tokens conhecidos também é descartado: aplicar uma cor arbitrária vinda do banco furaria o
 * design system.
 */
export function readRowAccents(
  layout: Record<string, unknown> | undefined,
): RowAccentRule[] {
  const raw = layout?.['rowAccents'];
  if (!Array.isArray(raw)) {
    return [];
  }
  const rules: RowAccentRule[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const when = candidate['when'];
    const accent = candidate['accent'];
    if (typeof when !== 'object' || when === null) {
      continue;
    }
    const condition = when as Record<string, unknown>;
    const field = condition['field'];
    const equals = condition['equals'];
    if (typeof field !== 'string' || field.trim() === '') {
      continue;
    }
    if (typeof equals !== 'string') {
      continue;
    }
    if (!isRowAccentToken(accent)) {
      continue;
    }
    rules.push({ when: { field, equals }, accent });
  }
  return rules;
}

/**
 * Avalia uma fórmula sobre a linha.
 *
 * `diff_days` devolve dias CORRIDOS entre a data do campo e hoje. `today` é o único literal
 * aceito à esquerda; a direita é SEMPRE o nome de um campo da linha. Devolve `null` quando o
 * valor não é uma data legível — a célula mostra "—" em vez de um número inventado.
 */
export function evaluateFormula(
  formula: ComputedFormula,
  row: Record<string, unknown>,
): number | null {
  if (formula.op !== 'diff_days') {
    return null;
  }
  const [left, right] = formula.args;
  if (left === undefined || right === undefined) {
    return null;
  }
  // O literal `today` é o único símbolo reconhecido; qualquer outra coisa é nome de campo.
  const leftDate = left === 'today' ? new Date() : toDate(row[left]);
  const rightDate = right === 'today' ? new Date() : toDate(row[right]);
  if (!leftDate || !rightDate) {
    return null;
  }
  const elapsed = leftDate.getTime() - rightDate.getTime();
  return Math.floor(elapsed / 86_400_000);
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Avalia o accent de uma linha: primeira regra que casar vence.
 *
 * `null` quando nenhuma casa — a linha permanece sem destaque, que é o estado neutro.
 */
export function evaluateRowAccent(
  rules: readonly RowAccentRule[],
  row: Record<string, unknown>,
): RowAccentToken | null {
  for (const rule of rules) {
    const value = row[rule.when.field];
    if (typeof value === 'string' && value === rule.when.equals) {
      return rule.accent;
    }
  }
  return null;
}

/**
 * Um campo é visível, dado o estado atual do formulário?
 *
 * Campo sem `visibleWhen` é SEMPRE visível — o caminho comum não paga por esta capacidade.
 */
export function isFieldVisible(
  visibleWhen: VisibleWhen | null,
  values: Record<string, unknown>,
): boolean {
  if (!visibleWhen) {
    return true;
  }
  const current = values[visibleWhen.field];
  if (typeof current !== 'string') {
    // Valor ausente ou de tipo inesperado: a condição NÃO casa, e o campo fica escondido —
    // que é o comportamento declarado por quem escreveu a regra.
    return false;
  }
  return current === visibleWhen.equals;
}

/**
 * Aplica uma agregação a um conjunto de valores.
 *
 * Opera sobre o conjunto EFETIVAMENTE entregue à lista — a engine não pede total ao servidor,
 * porque não existe endpoint para isso. `null` quando o conjunto está vazio ou quando nenhum
 * valor é numérico, para que o rodapé mostre "—" em vez de "0" (que seria um total falso).
 */
export function applyAggregation(
  kind: AggregationKind,
  values: readonly unknown[],
): number | null {
  if (values.length === 0) {
    return null;
  }
  if (kind === 'count') {
    return values.length;
  }
  const numbers = values
    .map(toNumber)
    .filter((value): value is number => value !== null);
  if (numbers.length === 0) {
    return null;
  }
  if (kind === 'sum') {
    return numbers.reduce((accumulator, value) => accumulator + value, 0);
  }
  if (kind === 'avg') {
    return numbers.reduce((accumulator, value) => accumulator + value, 0) / numbers.length;
  }
  if (kind === 'min') {
    return Math.min(...numbers);
  }
  return Math.max(...numbers);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  // Valores monetários chegam como string com ponto decimal; vírgula é aceita por tolerância
  // a payload localizado, não como formato esperado.
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Formata um total conforme o tipo do campo. */
export function formatAggregate(kind: AggregationKind, total: number | null, type: string): string {
  if (total === null) {
    return '—';
  }
  if (kind === 'count') {
    return String(total);
  }
  if (type === 'currency') {
    return total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (type === 'integer') {
    return String(Math.round(total));
  }
  return total.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

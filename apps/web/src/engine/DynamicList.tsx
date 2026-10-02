import { useMemo, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { FieldRenderer, toDisplayText } from './FieldRenderer';
import {
  applyAggregation,
  evaluateFormula,
  evaluateRowAccent,
  formatAggregate,
  readAggregation,
  readComputedFields,
  readRowAccents,
  type AggregationKind,
  type ComputedField,
  type RowAccentToken,
} from './metadata-v2';
import type { MetaEntitySchema, MetaField } from './types';

/**
 * Lista dirigida por metadados.
 *
 * Colunas, ordem e quais campos são filtráveis vêm da `list` view + `in_list`/`list_order`.
 * A engine não conhece coluna alguma: `columns` do layout manda, e `field_order` é o
 * fallback.
 *
 * CAPACIDADES V2 — declaradas em `meta.*` e lidas do CANAL OFICIAL da projeção da API:
 *   - CAMPOS COMPUTADOS (`schema.computedFields`): coluna derivada por fórmula fechada;
 *   - AGREGAÇÕES (`field.aggregation`): total de coluna no rodapé;
 *   - ACCENTS DE LINHA (`view.rowAccent`): destaque semântico por regra de negócio.
 *
 * BLOQUEADA — computed_fields, aggregations, row_accents — API_CONTRACT_MISSING: as colunas
 * existem em `meta.*` (migration 0087) mas o endpoint não as projeta. Os leitores aceitam um
 * parâmetro de compatibilidade para payloads antigos; o canal oficial tem precedência.
 */
export type DynamicListRow = Record<string, unknown> & { id: string };

export type DynamicListProps = {
  /**
   * Schema da entidade.
   *
   * PODE SER `null` — mesma regra do `DynamicKanban`: enquanto o metadado não chega, a lista
   * não tem coluna para desenhar e a TELA decide o que mostrar. Lançar aqui derrubaria a
   * árvore inteira por um atraso de rede que a tela não controla.
   */
  schema: MetaEntitySchema | null;
  rows: DynamicListRow[];
  /** Ação por linha (ex.: botões de comando), injetada pela tela. */
  renderRowActions?: (row: DynamicListRow) => React.ReactNode;
  onRowClick?: (row: DynamicListRow) => void;
  emptyMessage?: string;
  /**
   * Seleção múltipla. Ausente = sem coluna de seleção.
   *
   * `ReadonlySet` porque o hook de seleção do operador (`useSelection`) devolve um Set, e
   * convertê-lo em array a cada render custaria uma cópia por linha. A engine só LÊ.
   */
  selectedIds?: ReadonlySet<string> | string[];
  onSelectionChange?: (ids: string[]) => void;
  /**
   * Campo que carrega o responsável e handler de reatribuição.
   *
   * Sem `onReassign`, a coluna apenas EXIBE o responsável — comportamento correto quando o
   * backend não publica endpoint de atribuição para a entidade.
   */
  ownerField?: string;
  onReassign?: (row: DynamicListRow, owner: string) => void;
  reassignOptions?: Array<{ value: string; label: string }>;
  /** Totalização por coluna + aging médio no rodapé. */
  showTotals?: boolean;
  /** Campo de data usado para aging. Ausente = deriva de `created_at` se existir. */
  agingField?: string;
  /**
   * Substitui a renderização de UMA coluna, pelo nome do campo.
   *
   * Existe para valores CALCULADOS que não são coluna da tabela (ex.: saldo de conta, que o
   * servidor reconstrói a cada leitura). A engine não sabe somar saldo — e não deve aprender:
   * quem entrega a célula é a tela, e a engine apenas reserva a coluna.
   *
   * Devolver `undefined` mantém o `FieldRenderer` padrão: o slot é um OVERRIDE, não uma
   * obrigação de desenhar todas as células à mão.
   */
  renderCell?: (field: MetaField, row: DynamicListRow) => ReactNode;
};

export function DynamicList({
  schema,
  rows,
  renderRowActions,
  onRowClick,
  emptyMessage,
  selectedIds,
  onSelectionChange,
  ownerField,
  onReassign,
  reassignOptions,
  showTotals = false,
  agingField,
  renderCell,
}: DynamicListProps): React.ReactElement {
  const columns = useColumns(schema);
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' } | null>(null);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const selectable = selectedIds !== undefined && onSelectionChange !== undefined;
  const owner = ownerField
    ? schema?.fields.find((field) => field.name === ownerField) ?? null
    : null;
  const aging = resolveAgingField(schema, agingField);

  /*
   * CAMPOS COMPUTADOS e ACCENTS — lidos do CANAL OFICIAL (`schema.computedFields` e
   * `view.rowAccent`). Nenhum dos dois é coluna de banco: um é fórmula, o outro é regra de
   * apresentação. O segundo argumento dos leitores é compatibilidade com payload antigo.
   */
  const listView = schema?.views.find((view) => view.viewType === 'list');
  const computedFields = useMemo(
    () =>
      readComputedFields(
        listView?.layout,
        schema?.allowedPermLevels ?? [],
        schema?.computedFields,
      ),
    [listView?.layout, schema?.allowedPermLevels, schema?.computedFields],
  );
  const rowAccentRules = useMemo(
    () => readRowAccents(listView?.layout, listView?.rowAccent),
    [listView?.layout, listView?.rowAccent],
  );

  const isSelected = (id: string): boolean =>
    selectedIds === undefined
      ? false
      : Array.isArray(selectedIds)
        ? selectedIds.includes(id)
        : selectedIds.has(id);

  const allSelected =
    selectable && rows.length > 0 && rows.every((row) => isSelected(row.id));

  const toggleSort = (name: string): void => {
    setSort((current) =>
      current?.field === name
        ? { field: name, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { field: name, direction: 'asc' },
    );
  };

  const toggleAll = (): void => {
    if (!selectable) {
      return;
    }
    onSelectionChange(allSelected ? [] : rows.map((row) => row.id));
  };

  const toggleRow = (id: string): void => {
    if (!selectable) {
      return;
    }
    const current = Array.isArray(selectedIds) ? selectedIds : [...selectedIds];
    onSelectionChange(
      isSelected(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const extraColumns = (owner ? 1 : 0) + (aging ? 1 : 0) + computedFields.length;
  const totalColumns = columns.length + extraColumns + (renderRowActions ? 1 : 0) + (selectable ? 1 : 0);

  /*
   * AGREGAÇÕES — o rodapé é calculado a partir das DECLARAÇÕES do metadado, não de um
   * `showTotals` que soma por tipo. Um campo sem `aggregation` não é totalizado.
   *
   * A soma roda sobre `sorted` (o conjunto EFETIVAMENTE exibido), não sobre a base inteira:
   * o total tem de bater com as linhas que o operador está vendo.
   */
  const footer = useMemo(
    () => buildFooter(columns, computedFields, sorted, showTotals),
    [columns, computedFields, sorted, showTotals],
  );

  if (!schema) {
    return (
      <p className="text-sm text-gray-600" data-testid="dynamic-list-awaiting-schema" aria-busy="true">
        {t('common.loading')}
      </p>
    );
  }

  return (
    <table
      className="w-full text-sm"
      data-testid="dynamic-list"
      data-entity={schema.name}
      data-column-count={String(columns.length)}
      /*
       * `data-list-count` é o número de linhas RENDERIZADAS — não um total que a engine
       * calculou. Serve à prova de que o filtro do KPI mudou o conjunto exibido: sem ele, a
       * única forma de medir seria contar `tr` no teste, o que confundiria linha de rodapé
       * com registro.
       */
      data-list-count={String(rows.length)}
    >
      <thead>
        <tr>
          {selectable ? (
            <th scope="col" className="w-8 border-b border-gray-200 px-2 py-1.5">
              <input
                type="checkbox"
                data-testid="dynamic-list-select-all"
                aria-label={t('list.selectRow')}
                checked={allSelected}
                onChange={toggleAll}
              />
            </th>
          ) : null}
          {columns.map((column) => (
            <th
              key={column.name}
              scope="col"
              className="border-b border-gray-200 px-2 py-1.5 text-left text-xs font-semibold text-gray-600"
              aria-sort={
                sort?.field === column.name
                  ? sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              }
            >
              <button
                type="button"
                className="inline-flex items-center gap-1"
                onClick={() => toggleSort(column.name)}
              >
                {column.label}
                {sort?.field === column.name ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </th>
          ))}
          {owner ? (
            <th scope="col" className="border-b border-gray-200 px-2 py-1.5 text-left text-xs font-semibold text-gray-600">
              {owner.label}
            </th>
          ) : null}
          {aging ? (
            <th scope="col" className="border-b border-gray-200 px-2 py-1.5 text-left text-xs font-semibold text-gray-600">
              Aging
            </th>
          ) : null}
          {/*
            COLUNAS COMPUTADAS — rótulo do metadado, valor derivado por fórmula. A engine não
            sabe o que "Dias em atraso" significa: ela sabe aplicar `diff_days`.
          */}
          {computedFields.map((field) => (
            <th
              key={field.name}
              scope="col"
              data-computed-field={field.name}
              className="border-b border-gray-200 px-2 py-1.5 text-left text-xs font-semibold text-gray-600"
            >
              {field.label}
            </th>
          ))}
          {renderRowActions ? (
            <th scope="col" className="border-b border-gray-200 px-2 py-1.5 text-right text-xs font-semibold text-gray-600">
              {t('common.actions')}
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr>
            <td colSpan={totalColumns} className="px-2 py-3 text-gray-500">
              {emptyMessage ?? t('common.empty')}
            </td>
          </tr>
        ) : (
          sorted.map((row) => {
            const accent = evaluateRowAccent(rowAccentRules, row);
            return (
            <tr
              key={row.id}
              data-testid="dynamic-list-row"
              data-row-id={row.id}
              /* O ACCENT é publicado como TOKEN semântico; o design system decide a cor. */
              data-row-accent={accent ?? null}
              className={[
                onRowClick ? 'cursor-pointer hover:bg-gray-50' : '',
                isSelected(row.id) ? 'bg-slate-100' : '',
                accent ? rowAccentClass(accent) : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {selectable ? (
                <td className="border-b border-gray-100 px-2 py-1.5">
                  <input
                    type="checkbox"
                    data-testid="dynamic-list-select-row"
                    aria-label={t('list.selectRow')}
                    checked={isSelected(row.id)}
                    onChange={() => toggleRow(row.id)}
                    // Sem isto, marcar a caixa também abriria o detalhe da linha.
                    onClick={(event) => event.stopPropagation()}
                  />
                </td>
              ) : null}
              {columns.map((column) => (
                <td key={column.name} className="border-b border-gray-100 px-2 py-1.5">
                  {renderCell?.(column, row) ?? (
                    <FieldRenderer field={column} value={row[column.name]} />
                  )}
                </td>
              ))}
              {owner ? (
                <td className="border-b border-gray-100 px-2 py-1.5">
                  <OwnerCell
                    row={row}
                    ownerField={owner}
                    onReassign={onReassign}
                    reassignOptions={reassignOptions}
                  />
                </td>
              ) : null}
              {aging ? (
                <td className="border-b border-gray-100 px-2 py-1.5">
                  <AgingBadge value={row[aging.name]} />
                </td>
              ) : null}
              {/*
                CÉLULAS COMPUTADAS — o valor é CALCULADO aqui, a partir do DTO da linha.
                Fórmula que não resolve (data ausente, op desconhecida) devolve `null` e a
                célula mostra "—": um número inventado seria pior que um vazio declarado.
              */}
              {computedFields.map((field) => (
                <td
                  key={field.name}
                  data-computed-cell={field.name}
                  className="border-b border-gray-100 px-2 py-1.5 tabular-nums"
                >
                  <ComputedCell field={field} row={row} />
                </td>
              ))}
              {renderRowActions ? (
                <td
                  className="border-b border-gray-100 px-2 py-1.5 text-right"
                  onClick={(event) => event.stopPropagation()}
                >
                  {renderRowActions(row)}
                </td>
              ) : null}
            </tr>
            );
          })
        )}
      </tbody>
      {footer.length > 0 ? (
        <tfoot>
          <tr data-testid="dynamic-list-totals">
            {selectable ? <td className="border-t border-gray-300 px-2 py-1.5" /> : null}
            {columns.map((column, index) => (
              <td
                key={column.name}
                data-total-field={column.name}
                className="border-t border-gray-300 px-2 py-1.5 text-xs font-semibold"
              >
                {index === 0 ? (
                  <span data-testid="dynamic-list-total-count">
                    {sorted.length} {t('list.count').toLowerCase()}
                  </span>
                ) : null}
                {/*
                  TOTAL GERAL no header: soma dos campos que DECLARAM agregação. Antes a engine
                  somava por tipo (`currency`); agora totaliza o que o metadado mandar.
                */}
                {aggregateLabel(column, sorted, footer)}
              </td>
            ))}
            {owner ? <td className="border-t border-gray-300 px-2 py-1.5" /> : null}
            {aging ? (
              <td
                data-total-field="__aging"
                className="border-t border-gray-300 px-2 py-1.5 text-xs font-semibold"
              >
                {t('list.avgAging')}: {averageAging(sorted, aging.name)}
              </td>
            ) : null}
            {computedFields.map((field) => (
              <td
                key={field.name}
                data-total-computed-field={field.name}
                className="border-t border-gray-300 px-2 py-1.5 text-xs font-semibold"
              >
                {aggregateLabel(field, sorted, footer)}
              </td>
            ))}
            {renderRowActions ? <td className="border-t border-gray-300" /> : null}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

/**
 * Rótulo de total de uma coluna, a partir da AGREGAÇÃO DECLARADA no metadado.
 *
 * Sem `aggregation` não há total — nem "0", nem vazio ambíguo: nada. É o que permite o
 * rodapé somar só o que faz sentido somar, sem a engine adivinhar por tipo.
 */
function aggregateLabel(
  column: MetaField | ComputedField,
  rows: DynamicListRow[],
  footer: ReadonlyArray<{ name: string; kind: AggregationKind; total: number | null }>,
): React.ReactNode {
  const entry = footer.find((candidate) => candidate.name === column.name);
  if (!entry) {
    return null;
  }
  const values = rows.map((row) => resolveCellValue(column, row));
  const text = formatAggregate(entry.kind, entry.total, column.type);
  return (
    <span
      data-aggregate-kind={entry.kind}
      className="ml-1 tabular-nums"
      title={`${entry.kind}(${column.label}) · ${values.length}`}
    >
      Total: {text}
    </span>
  );
}

/** Valor de uma célula: computado por fórmula, ou direto do campo. */
function resolveCellValue(
  column: MetaField | ComputedField,
  row: DynamicListRow,
): unknown {
  if (isComputedField(column)) {
    return evaluateFormula(column.formula, row);
  }
  return row[column.name];
}

function isComputedField(column: MetaField | ComputedField): column is ComputedField {
  return 'formula' in column;
}

/**
 * Célula de campo computado.
 *
 * Formata conforme o TIPO declarado pelo metadado — `integer` sai como número, o resto como
 * texto. `null` (fórmula que não resolveu) sai como "—" e é MARCADO com
 * `data-computed-empty`, para que uma prova consiga distinguir "não calculou" de "calculou 0".
 */
function ComputedCell({
  field,
  row,
}: {
  field: ComputedField;
  row: DynamicListRow;
}): React.ReactElement {
  const value = evaluateFormula(field.formula, row);
  if (value === null) {
    return (
      <span data-computed-empty={field.name} className="text-xs text-gray-400">
        —
      </span>
    );
  }
  return (
    <span data-computed-value={field.name} className="text-sm">
      {field.type === 'integer' ? String(value) : String(value)}
    </span>
  );
}

/**
 * Classes de accent por TOKEN semântico.
 *
 * Tokens, nunca hexadecimal: trocar o tema não exige UPDATE no metadata store, e a regra de
 * negócio ("vencido é crítico") fica separada da cor que a representa.
 */
function rowAccentClass(accent: RowAccentToken): string {
  if (accent === 'critical') {
    return 'bg-red-50 border-l-2 border-l-red-600';
  }
  if (accent === 'warning') {
    return 'bg-amber-50 border-l-2 border-l-amber-500';
  }
  if (accent === 'info') {
    return 'bg-blue-50 border-l-2 border-l-blue-500';
  }
  if (accent === 'success') {
    return 'bg-green-50 border-l-2 border-l-green-600';
  }
  return '';
}

/**
 * Monta o rodapé a partir das agregações declaradas.
 *
 * Devolve apenas as colunas que TÊM agregação — se nenhuma tiver, o `<tfoot>` não é renderizado.
 */
function buildFooter(
  columns: MetaField[],
  computedFields: ComputedField[],
  rows: DynamicListRow[],
  showTotals: boolean,
): Array<{ name: string; kind: AggregationKind; total: number | null }> {
  if (!showTotals) {
    return [];
  }
  const entries: Array<{ name: string; kind: AggregationKind; total: number | null }> = [];
  for (const column of columns) {
    const kind = readAggregation(column.options ?? null, column.aggregation);
    if (!kind) {
      continue;
    }
    const values = rows.map((row) => row[column.name]);
    entries.push({ name: column.name, kind, total: applyAggregation(kind, values) });
  }
  for (const field of computedFields) {
    if (!field.aggregation) {
      continue;
    }
    const values = rows.map((row) => evaluateFormula(field.formula, row));
    entries.push({ name: field.name, kind: field.aggregation, total: applyAggregation(field.aggregation, values) });
  }
  return entries;
}

/**
 * Responsável, com reatribuição inline quando a tela fornece o handler.
 *
 * Sem handler a célula é SOMENTE LEITURA — a engine não inventa um endpoint de atribuição.
 */
function OwnerCell({
  row,
  ownerField,
  onReassign,
  reassignOptions,
}: {
  row: DynamicListRow;
  ownerField: MetaField;
  onReassign?: (row: DynamicListRow, owner: string) => void;
  reassignOptions?: Array<{ value: string; label: string }>;
}): React.ReactElement {
  const current = toDisplayText(row[ownerField.name]);
  const display = current.trim() === '' ? t('list.unassigned') : current;

  if (!onReassign || !reassignOptions || reassignOptions.length === 0) {
    return (
      <span data-testid="dynamic-list-owner" className="text-sm">
        {display}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-700"
        aria-hidden="true"
      >
        {initials(display)}
      </span>
      <select
        data-testid="dynamic-list-owner-select"
        data-owner-field={ownerField.name}
        aria-label={`${ownerField.label}: ${display}`}
        className="rounded border border-gray-300 px-1 py-0.5 text-xs"
        value={current}
        onChange={(event) => onReassign(row, event.target.value)}
      >
        <option value="">{t('list.unassigned')}</option>
        {reassignOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * Aging por linha: "há N dias", com cor por faixa.
 *
 * Verde até 7 dias, amarelo até 30, vermelho acima. As faixas são de APRESENTAÇÃO — não são
 * SLA. Um SLA real viria do backend por entidade; enquanto não vem, a engine não finge que
 * estes números são prazo contratual.
 */
export function AgingBadge({ value }: { value: unknown }): React.ReactElement {
  const days = daysSince(value);

  if (days === null) {
    return <span className="text-xs text-gray-400">—</span>;
  }

  const tone = days > 30 ? 'red' : days > 7 ? 'amber' : 'green';
  const toneClass =
    tone === 'red'
      ? 'bg-red-50 text-red-700 ring-red-500/20'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-700 ring-amber-500/20'
        : 'bg-green-50 text-green-700 ring-green-500/20';

  return (
    <span
      data-testid="dynamic-list-aging"
      data-aging-days={String(days)}
      data-aging-tone={tone}
      className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${toneClass}`}
    >
      {days === 0 ? t('aging.today') : `há ${days} ${t('aging.days')}`}
    </span>
  );
}

/**
 * Colunas da lista.
 *
 * Ordem: `layout.columns` quando declarado (permite reordenar sem deploy); senão
 * `list_order` do metadado. Campos fora do nível do ator nunca entram — o servidor já os
 * removeu, e o filtro aqui é a segunda barreira.
 */
function useColumns(schema: MetaEntitySchema | null): MetaField[] {
  return useMemo(() => {
    if (!schema) {
      return [];
    }
    const listView = schema.views.find((view) => view.viewType === 'list');
    const declared = listView?.layout.columns ?? [];
    const byName = new Map(schema.fields.map((field) => [field.name, field]));
    const allowed = (field: MetaField): boolean =>
      field.inList && schema.allowedPermLevels.includes(field.permLevel);

    if (declared.length > 0) {
      return declared
        .map((name) => byName.get(name))
        .filter((field): field is MetaField => field !== undefined && allowed(field));
    }
    return schema.fields
      .filter(allowed)
      .slice()
      .sort((left, right) => left.listOrder - right.listOrder);
  }, [schema]);
}

function resolveAgingField(
  schema: MetaEntitySchema | null,
  explicit?: string,
): MetaField | null {
  if (!schema) {
    return null;
  }
  if (explicit) {
    return schema.fields.find((field) => field.name === explicit) ?? null;
  }
  return (
    schema.fields.find((field) => field.name === 'created_at') ??
    schema.fields.find((field) => field.type === 'datetime' || field.type === 'date') ??
    null
  );
}

/** Dias corridos desde a data. `null` quando o valor não é uma data legível. */
export function daysSince(value: unknown): number | null {
  const text = toDisplayText(value);
  if (text.trim() === '') {
    return null;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const elapsed = Date.now() - parsed.getTime();
  if (elapsed < 0) {
    return 0;
  }
  return Math.floor(elapsed / 86_400_000);
}

function sortRows(
  rows: DynamicListRow[],
  sort: { field: string; direction: 'asc' | 'desc' } | null,
): DynamicListRow[] {
  if (!sort) {
    return rows;
  }
  const factor = sort.direction === 'asc' ? 1 : -1;
  return rows.slice().sort((left, right) => {
    const a = left[sort.field];
    const b = right[sort.field];
    if (a === b) {
      return 0;
    }
    if (a === null || a === undefined) {
      return 1;
    }
    if (b === null || b === undefined) {
      return -1;
    }
    return toDisplayText(a).localeCompare(toDisplayText(b), 'pt-BR') * factor;
  });
}

function averageAging(rows: DynamicListRow[], field: string): string {
  const values = rows
    .map((row) => daysSince(row[field]))
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return '—';
  }
  const average = values.reduce((accumulator, value) => accumulator + value, 0) / values.length;
  return `${average.toFixed(1)} ${t('aging.days')}`;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

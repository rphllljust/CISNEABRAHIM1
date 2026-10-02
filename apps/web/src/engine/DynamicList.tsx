import { useMemo, useState } from 'react';
import { t } from '../i18n';
import { FieldRenderer, toDisplayText } from './FieldRenderer';
import type { MetaEntitySchema, MetaField } from './types';

/**
 * Lista dirigida por metadados.
 *
 * Colunas, ordem e quais campos são filtráveis vêm da `list` view + `in_list`/`list_order`.
 * A engine não conhece coluna alguma: `columns` do layout manda, e `field_order` é o
 * fallback.
 *
 * TRÊS CAPACIDADES DE ERP que não existem em tabela artesanal:
 *   - SELECIONAR linhas (habilita ações em lote);
 *   - RESPONSÁVEL por linha, com reatribuição inline quando a tela fornece o handler;
 *   - AGING e TOTALIZAÇÃO no rodapé, derivados das colunas que o metadado declarou.
 */
export type DynamicListRow = Record<string, unknown> & { id: string };

export type DynamicListProps = {
  schema: MetaEntitySchema;
  rows: DynamicListRow[];
  /** Ação por linha (ex.: botões de comando), injetada pela tela. */
  renderRowActions?: (row: DynamicListRow) => React.ReactNode;
  onRowClick?: (row: DynamicListRow) => void;
  emptyMessage?: string;
  /** Seleção múltipla. Ausente = sem coluna de seleção. */
  selectedIds?: string[];
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
}: DynamicListProps): React.ReactElement {
  const columns = useColumns(schema);
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' } | null>(null);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const selectable = selectedIds !== undefined && onSelectionChange !== undefined;
  const owner = ownerField
    ? schema.fields.find((field) => field.name === ownerField) ?? null
    : null;
  const aging = resolveAgingField(schema, agingField);

  const allSelected = selectable && rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));

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
    onSelectionChange(
      selectedIds.includes(id) ? selectedIds.filter((current) => current !== id) : [...selectedIds, id],
    );
  };

  const extraColumns = (owner ? 1 : 0) + (aging ? 1 : 0);
  const totalColumns = columns.length + extraColumns + (renderRowActions ? 1 : 0) + (selectable ? 1 : 0);

  return (
    <table
      className="w-full text-sm"
      data-testid="dynamic-list"
      data-entity={schema.name}
      data-column-count={String(columns.length)}
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
          sorted.map((row) => (
            <tr
              key={row.id}
              data-testid="dynamic-list-row"
              data-row-id={row.id}
              className={[
                onRowClick ? 'cursor-pointer hover:bg-gray-50' : '',
                selectable && selectedIds.includes(row.id) ? 'bg-slate-100' : '',
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
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleRow(row.id)}
                    // Sem isto, marcar a caixa também abriria o detalhe da linha.
                    onClick={(event) => event.stopPropagation()}
                  />
                </td>
              ) : null}
              {columns.map((column) => (
                <td key={column.name} className="border-b border-gray-100 px-2 py-1.5">
                  <FieldRenderer field={column} value={row[column.name]} />
                </td>
              ))}
              {owner ? (
                <td className="border-b border-gray-100 px-2 py-1.5">
                  <OwnerCell
                    schema={schema}
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
              {renderRowActions ? (
                <td
                  className="border-b border-gray-100 px-2 py-1.5 text-right"
                  onClick={(event) => event.stopPropagation()}
                >
                  {renderRowActions(row)}
                </td>
              ) : null}
            </tr>
          ))
        )}
      </tbody>
      {showTotals && sorted.length > 0 ? (
        <tfoot>
          <tr data-testid="dynamic-list-totals">
            <td colSpan={selectable ? 1 : 0} className="px-2 py-1.5" />
            {columns.map((column, index) => (
              <td
                key={column.name}
                data-total-field={column.name}
                className="border-t border-gray-300 px-2 py-1.5 text-xs font-semibold"
              >
                {index === 0 ? `${sorted.length} ${t('list.count').toLowerCase()}` : null}
                {column.type === 'currency' ? (
                  <span className="ml-1 tabular-nums">{sumCurrency(sorted, column.name)}</span>
                ) : null}
                {column.type === 'integer' && column.name === 'row_version' ? (
                  <span className="ml-1 tabular-nums">{sumNumbers(sorted, column.name)}</span>
                ) : null}
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
            {renderRowActions ? <td className="border-t border-gray-300" /> : null}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

/**
 * Responsável, com reatribuição inline quando a tela fornece o handler.
 *
 * Sem handler a célula é SOMENTE LEITURA — a engine não inventa um endpoint de atribuição.
 */
function OwnerCell({
  schema,
  row,
  ownerField,
  onReassign,
  reassignOptions,
}: {
  schema: MetaEntitySchema;
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
function useColumns(schema: MetaEntitySchema): MetaField[] {
  return useMemo(() => {
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

function resolveAgingField(schema: MetaEntitySchema, explicit?: string): MetaField | null {
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

function sumCurrency(rows: DynamicListRow[], field: string): string {
  const total = rows.reduce((accumulator, row) => {
    const parsed = Number(toDisplayText(row[field]).replace(',', '.'));
    return Number.isFinite(parsed) ? accumulator + parsed : accumulator;
  }, 0);
  return total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sumNumbers(rows: DynamicListRow[], field: string): string {
  const total = rows.reduce((accumulator, row) => {
    const parsed = Number(toDisplayText(row[field]));
    return Number.isFinite(parsed) ? accumulator + parsed : accumulator;
  }, 0);
  return String(total);
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

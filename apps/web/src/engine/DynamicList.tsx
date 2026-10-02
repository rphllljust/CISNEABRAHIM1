import { useMemo, useState } from 'react';
import { FieldRenderer, toDisplayText } from './FieldRenderer';
import type { MetaEntitySchema, MetaField } from './types';

/**
 * Lista dirigida por metadados.
 *
 * Colunas, ordem e quais campos são filtráveis vêm da `list` view + `in_list`/`list_order`.
 * A engine não conhece coluna alguma: `columns` do layout manda, e `field_order` é o
 * fallback.
 */
export type DynamicListProps = {
  schema: MetaEntitySchema;
  rows: Array<Record<string, unknown> & { id: string }>;
  /** Ação por linha (ex.: botões de comando), injetada pela tela. */
  renderRowActions?: (row: Record<string, unknown> & { id: string }) => React.ReactNode;
  onRowClick?: (row: Record<string, unknown> & { id: string }) => void;
  emptyMessage?: string;
};

export function DynamicList({
  schema,
  rows,
  renderRowActions,
  onRowClick,
  emptyMessage = 'Nenhum registro encontrado.',
}: DynamicListProps): React.ReactElement {
  const columns = useColumns(schema);
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' } | null>(null);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  const toggleSort = (name: string): void => {
    setSort((current) =>
      current?.field === name
        ? { field: name, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { field: name, direction: 'asc' },
    );
  };

  return (
    <table className="w-full text-sm" data-testid="dynamic-list" data-entity={schema.name}>
      <thead>
        <tr>
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
          {renderRowActions ? (
            <th scope="col" className="border-b border-gray-200 px-2 py-1.5 text-right text-xs font-semibold text-gray-600">
              Ações
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr>
            <td colSpan={columns.length + (renderRowActions ? 1 : 0)} className="px-2 py-3 text-gray-500">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          sorted.map((row) => (
            <tr
              key={row.id}
              className={onRowClick ? 'cursor-pointer hover:bg-gray-50' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.name} className="border-b border-gray-100 px-2 py-1.5">
                  <FieldRenderer field={column} value={row[column.name]} />
                </td>
              ))}
              {renderRowActions ? (
                <td className="border-b border-gray-100 px-2 py-1.5 text-right">
                  {renderRowActions(row)}
                </td>
              ) : null}
            </tr>
          ))
        )}
      </tbody>
    </table>
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

function sortRows(
  rows: Array<Record<string, unknown> & { id: string }>,
  sort: { field: string; direction: 'asc' | 'desc' } | null,
): Array<Record<string, unknown> & { id: string }> {
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

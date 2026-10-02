import { useMemo, useState } from 'react';
import { t } from '../i18n';
import type { DynamicListRow } from './DynamicList';
import type { MetaEntitySchema } from './types';
import {
  readFieldList,
  readFieldName,
  readLayout,
  readString,
  type ResolvedViewField,
} from './view-layout';

/**
 * VISÃO DE TABELA DINÂMICA (PIVOT) dirigida por metadado.
 *
 * Lê `meta.views[viewType='pivot'].layout`:
 *   - `groupBy`     — campos das LINHAS (o eixo de agrupamento)
 *   - `aggregate`   — campo cujo valor é totalizado nas COLUNAS
 *   - `aggregateOp` — como totalizar: `sum` | `count` | `avg` | `min` | `max`
 *   - `columnField` — campo opcional que abre as COLUNAS (pivot cruzado)
 *
 * Um pivot é a pergunta "quanto, por quê" — e as duas metades dessa pergunta são
 * configuração, não código. Trocar `aggregateOp` de `sum` para `avg` via SQL muda a tabela
 * sem deploy, que é exatamente o que o E2E prova.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * TOTALIZA SOBRE O QUE FOI ENTREGUE
 *
 * A engine NÃO pede o total ao servidor: não existe endpoint de agregação (`GAP_DE_API`
 * declarado). Ela soma a página que recebeu e DIZ ISSO na tela (`data-pivot-scope`), em vez
 * de apresentar um número parcial como se fosse o total da empresa. Um total errado e
 * silencioso é pior que um total ausente.
 */

export type PivotAggregateOp = 'sum' | 'count' | 'avg' | 'min' | 'max';

const AGGREGATE_OPS: readonly PivotAggregateOp[] = ['sum', 'count', 'avg', 'min', 'max'];

/** `count` é o default: é a única operação que funciona sem campo numérico declarado. */
export function isAggregateOp(value: unknown): value is PivotAggregateOp {
  return typeof value === 'string' && (AGGREGATE_OPS as readonly string[]).includes(value);
}

export type DynamicPivotProps = {
  schema: MetaEntitySchema;
  rows: DynamicListRow[];
  viewType?: string;
  onCellClick?: (group: Record<string, string>, column: string | null) => void;
  emptyMessage?: string;
};

type PivotCell = {
  key: string;
  rows: DynamicListRow[];
};

/** Valor de agrupamento como texto estável. `null`/vazio viram o rótulo declarado. */
function groupValue(row: DynamicListRow, field: string): string {
  const value = row[field];
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return String(value);
}

/** Converte para número aceitando string monetária; `null` quando não é numérico. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Aplica a operação a um conjunto de linhas.
 *
 * `null` quando o conjunto está vazio ou quando NENHUM valor é numérico — a célula mostra
 * "—" em vez de "0". Um zero inventado num relatório financeiro é um dado falso, e o
 * operador não tem como distinguir "soma zero" de "não consegui somar".
 */
export function applyPivotOp(
  op: PivotAggregateOp,
  rows: DynamicListRow[],
  aggregateField: string | null,
): number | null {
  if (rows.length === 0) {
    return null;
  }
  if (op === 'count') {
    return rows.length;
  }
  if (!aggregateField) {
    return null;
  }
  const numbers = rows
    .map((row) => toNumber(row[aggregateField]))
    .filter((value): value is number => value !== null);
  if (numbers.length === 0) {
    return null;
  }
  if (op === 'sum') {
    return numbers.reduce((total, value) => total + value, 0);
  }
  if (op === 'avg') {
    return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  }
  if (op === 'min') {
    return Math.min(...numbers);
  }
  return Math.max(...numbers);
}

/** Formata o total conforme a operação e o tipo do campo. */
export function formatPivotValue(
  op: PivotAggregateOp,
  value: number | null,
  fieldType: string | undefined,
): string {
  if (value === null) {
    return '—';
  }
  if (op === 'count') {
    return String(value);
  }
  if (fieldType === 'currency') {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (fieldType === 'integer') {
    return String(Math.round(value));
  }
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function DynamicPivot({
  schema,
  rows,
  viewType = 'pivot',
  onCellClick,
  emptyMessage,
}: DynamicPivotProps): React.ReactElement {
  const layout = useMemo(() => readLayout(schema, viewType), [schema, viewType]);

  const groupByNames = readFieldList(layout, 'groupBy');
  const aggregateName = readFieldName(layout, 'aggregate');
  const rawOp = readString(layout, 'aggregateOp');
  // Operação desconhecida cai para `count` em vez de quebrar: contar é sempre possível.
  const op: PivotAggregateOp = isAggregateOp(rawOp) ? rawOp : 'count';
  const columnField = readFieldName(layout, 'columnField');

  // `resolveViewField` resolve UMA chave de layout; aqui o eixo é uma LISTA de campos, então
  // cada nome é resolvido individualmente contra o schema.
  const resolvedGroups: ResolvedViewField[] = groupByNames.map((name) => {
    const field = schema.fields.find((candidate) => candidate.name === name) ?? null;
    return { name, field, missing: field === null };
  });
  const aggregateResolved = aggregateName
    ? (() => {
        const field = schema.fields.find((candidate) => candidate.name === aggregateName) ?? null;
        return { name: aggregateName, field, missing: field === null };
      })()
    : null;

  /**
   * Colunas do pivot cruzado. Sem `columnField`, há UMA coluna implícita — o pivot vira um
   * agrupamento simples, que é o caso mais comum e não deve exigir configuração extra.
   */
  const columnKeys = useMemo(() => {
    if (!columnField) {
      return [null] as (string | null)[];
    }
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const row of rows) {
      const value = groupValue(row, columnField);
      if (!seen.has(value)) {
        seen.add(value);
        keys.push(value);
      }
    }
    return keys.sort((left, right) => left.localeCompare(right, 'pt-BR'));
  }, [rows, columnField]);

  /** Linhas do pivot, na ordem em que os grupos aparecem nos dados. */
  const cellRows = useMemo(() => {
    if (resolvedGroups.length === 0) {
      return [];
    }
    const order: string[] = [];
    const byGroup = new Map<string, DynamicListRow[]>();

    for (const row of rows) {
      const group = resolvedGroups.map((field) => groupValue(row, field.name));
      const key = group.join('\u0000');
      const bucket = byGroup.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        byGroup.set(key, [row]);
        order.push(key);
      }
    }

    return order.map((key) => {
      const groupRows = byGroup.get(key) ?? [];
      const values = key.split('\u0000');
      const cells: PivotCell[] = columnKeys.map((column) => {
        const scoped =
          column === null ? groupRows : groupRows.filter((r) => groupValue(r, columnField!) === column);
        return { key: column ?? '__all__', rows: scoped };
      });
      return { key, values, rows: groupRows, cells };
    });
  }, [rows, resolvedGroups, columnKeys, columnField]);

  const grandTotalRows = rows;
  const aggregateType = aggregateResolved?.field?.type;

  if (!layout || (resolvedGroups.length === 0 && !aggregateName)) {
    return (
      <div
        data-testid="dynamic-pivot"
        data-entity={schema.name}
        data-view-type={viewType}
        data-pivot-gap="groupBy"
        className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      >
        A view <strong>{viewType}</strong> não declara <code>layout.groupBy</code> no metadata
        store, então não há eixo de agrupamento para montar a tabela.
      </div>
    );
  }

  const columnLabel =
    columnField === null
      ? t('pivot.all', 'Total')
      : (schema.fields.find((field) => field.name === columnField)?.label ?? columnField);

  return (
    <div
      data-testid="dynamic-pivot"
      data-entity={schema.name}
      data-view-type={viewType}
      // A PROVA no DOM: o eixo, o campo totalizado e a operação que a view declarou.
      data-group-by={groupByNames.join(',')}
      data-aggregate={aggregateName ?? ''}
      data-aggregate-op={op}
      data-column-field={columnField ?? ''}
      data-pivot-scope="loaded-page"
      className="overflow-x-auto rounded border border-slate-200 bg-white"
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-600">
            {resolvedGroups.map((field) => (
              <th key={field.name} className="px-3 py-2">
                {field.field?.label ?? field.name}
              </th>
            ))}
            {columnKeys.map((column) => (
              <th key={column ?? '__all__'} className="px-3 py-2 text-right">
                {column === null ? columnLabel : column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cellRows.map((row) => (
            <tr key={row.key} data-pivot-row className="border-b border-slate-100">
              {row.values.map((value, index) => (
                <th
                  key={resolvedGroups[index]?.name ?? index}
                  scope="row"
                  className="px-3 py-2 text-left font-medium text-slate-800"
                >
                  {value}
                </th>
              ))}
              {row.cells.map((cell, index) => {
                const total = applyPivotOp(op, cell.rows, aggregateName);
                return (
                  <td
                    key={cell.key}
                    data-pivot-cell={formatPivotValue(op, total, aggregateType)}
                    data-pivot-cell-rows={cell.rows.length}
                    className="px-3 py-2 text-right tabular-nums text-slate-700"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const group: Record<string, string> = {};
                        resolvedGroups.forEach((field, position) => {
                          group[field.name] = row.values[position] ?? '';
                        });
                        onCellClick?.(group, columnKeys[index] ?? null);
                      }}
                      className="underline-offset-2 hover:underline"
                    >
                      {formatPivotValue(op, total, aggregateType)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {/*
         * TOTAL GERAL em `<tfoot>` e com atributo próprio: o E2E exige `[data-pivot-total]`,
         * e separar o rodapé das células permite provar que existe sem contar colunas.
         */}
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <td className="px-3 py-2 text-left" colSpan={Math.max(resolvedGroups.length, 1)}>
              {t('list.total', 'Total')}
            </td>
            {columnKeys.map((column) => {
              const scoped =
                column === null
                  ? grandTotalRows
                  : grandTotalRows.filter((r) => groupValue(r, columnField!) === column);
              const total = applyPivotOp(op, scoped, aggregateName);
              return (
                <td
                  key={column ?? '__all__'}
                  data-pivot-total
                  data-pivot-total-rows={scoped.length}
                  className="px-3 py-2 text-right tabular-nums"
                >
                  {formatPivotValue(op, total, aggregateType)}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>

      {rows.length === 0 ? (
        <p data-testid="pivot-empty" className="px-4 py-3 text-sm text-slate-500">
          {emptyMessage ?? t('common.empty', 'Nenhum registro encontrado.')}
        </p>
      ) : null}

      {/*
       * ESCOPO DECLARADO. O total é da PÁGINA carregada, não do banco. Esconder isso faria o
       * relatório mentir por omissão.
       */}
      <p data-testid="pivot-scope" className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        {t(
          'pivot.scope',
          'Total calculado sobre os registros carregados nesta página — não há endpoint de agregação no servidor.',
        )}
      </p>

      {aggregateResolved?.missing ? (
        <p data-testid="pivot-aggregate-gap" className="px-4 py-2 text-xs text-amber-700">
          O layout declara <code>aggregate={aggregateResolved.name}</code>, que não existe em{' '}
          <code>meta.fields</code> de {schema.name}.
        </p>
      ) : null}

      {rawOp !== null && !isAggregateOp(rawOp) ? (
        <p data-testid="pivot-op-gap" className="px-4 py-2 text-xs text-amber-700">
          <code>aggregateOp={rawOp}</code> não é uma operação conhecida (
          {AGGREGATE_OPS.join(' | ')}). A tabela contou os registros.
        </p>
      ) : null}
    </div>
  );
}

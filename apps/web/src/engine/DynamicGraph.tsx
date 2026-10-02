import { useMemo } from 'react';
import { t } from '../i18n';
import type { MetaEntitySchema } from './types';
import { readBoolean, readFieldName, readLayout, readString } from './view-layout';

/**
 * VISÃO DE GRÁFICO dirigida por metadado.
 *
 * Lê `meta.views[viewType='graph'].layout`:
 *   - `categoryField` — eixo das categorias (X)
 *   - `valueField`    — campo cujo valor define a altura (Y)
 *   - `chartType`     — `bar` | `column` | `line` (default `bar`)
 *   - `aggregateOp`   — como reduzir várias linhas da mesma categoria
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE BARRAS EM HTML E NÃO UMA BIBLIOTECA DE GRÁFICOS
 *
 * Uma lib de chart traz canvas/SVG opaco: o DOM não expõe "quantas barras", então a prova
 * visual viraria "olhe o screenshot". Desenhando as barras como elementos com
 * `data-graph-bar`, cada barra é um nó verificável — o E2E conta barras, lê o valor e o
 * rótulo. Prova de DOM em vez de prova de imagem.
 *
 * Escala: as barras são proporcionais ao MAIOR valor do conjunto, não a um teto fixo. Sem
 * valor numérico, a barra some e a categoria mostra "—" — o gráfico não inventa altura para
 * dado que não existe.
 */

export type GraphChartType = 'bar' | 'line' | 'column';

const CHART_TYPES: readonly GraphChartType[] = ['bar', 'line', 'column'];

export function isChartType(value: unknown): value is GraphChartType {
  return typeof value === 'string' && (CHART_TYPES as readonly string[]).includes(value);
}

export type DynamicGraphProps = {
  schema: MetaEntitySchema;
  rows: Record<string, unknown>[];
  viewType?: string;
  /** Máximo de categorias exibidas; o excedente é declarado, não silenciado. */
  maxCategories?: number;
  onBarClick?: (category: string) => void;
  emptyMessage?: string;
};

type GraphBucket = {
  category: string;
  rows: Record<string, unknown>[];
  value: number | null;
};

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

/** Reduz as linhas de uma categoria a um valor. Sem `valueField`, a contagem é a medida. */
function reduceBucket(
  rows: Record<string, unknown>[],
  valueField: string | null,
  op: string,
): number | null {
  if (!valueField || op === 'count') {
    return rows.length;
  }
  const numbers = rows
    .map((row) => toNumber(row[valueField]))
    .filter((value): value is number => value !== null);
  if (numbers.length === 0) {
    return null;
  }
  if (op === 'avg') {
    return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  }
  if (op === 'min') {
    return Math.min(...numbers);
  }
  if (op === 'max') {
    return Math.max(...numbers);
  }
  return numbers.reduce((total, value) => total + value, 0);
}

/** Buckets por categoria, ordenados do maior para o menor — leitura de ranking. */
export function buildBuckets(
  rows: Record<string, unknown>[],
  categoryField: string,
  valueField: string | null,
  op: string,
): GraphBucket[] {
  const order: string[] = [];
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const row of rows) {
    const raw = row[categoryField];
    const category =
      raw === null || raw === undefined || String(raw) === '' ? '—' : String(raw);
    const bucket = groups.get(category);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(category, [row]);
      order.push(category);
    }
  }

  return order
    .map((category) => {
      const groupRows = groups.get(category) ?? [];
      return { category, rows: groupRows, value: reduceBucket(groupRows, valueField, op) };
    })
    .sort((left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity));
}

export function DynamicGraph({
  schema,
  rows,
  viewType = 'graph',
  maxCategories = 12,
  onBarClick,
  emptyMessage,
}: DynamicGraphProps): React.ReactElement {
  const layout = useMemo(() => readLayout(schema, viewType), [schema, viewType]);

  const categoryField = readFieldName(layout, 'categoryField');
  const valueField = readFieldName(layout, 'valueField');
  const rawChartType = readString(layout, 'chartType');
  const chartType: GraphChartType = isChartType(rawChartType) ? rawChartType : 'bar';
  const op = readString(layout, 'aggregateOp') ?? (valueField ? 'sum' : 'count');
  const showValues = readBoolean(layout, 'showValues', true);

  const buckets = useMemo(
    () => (categoryField ? buildBuckets(rows, categoryField, valueField, op) : []),
    [rows, categoryField, valueField, op],
  );

  if (!categoryField) {
    return (
      <div
        data-testid="dynamic-graph"
        data-entity={schema.name}
        data-view-type={viewType}
        data-graph-gap="categoryField"
        className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      >
        A view <strong>{viewType}</strong> não declara <code>layout.categoryField</code> no
        metadata store, então não há eixo de categorias para desenhar o gráfico.
      </div>
    );
  }

  const shown = buckets.slice(0, Math.max(maxCategories, 1));
  const hidden = buckets.length - shown.length;
  // Escala pelo MAIOR valor do conjunto exibido; piso em 1 para não dividir por zero.
  const peak = shown.reduce((max, bucket) => Math.max(max, Math.abs(bucket.value ?? 0)), 0) || 1;
  const categoryType = schema.fields.find((field) => field.name === categoryField)?.label ?? categoryField;
  const valueLabel = valueField
    ? (schema.fields.find((field) => field.name === valueField)?.label ?? valueField)
    : t('graph.count', 'Registros');

  const format = (value: number | null): string => {
    if (value === null) {
      return '—';
    }
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  };

  // Em `column` o eixo é horizontal e a altura é a categoria; em `bar`/`line`, o contrário.
  const vertical = chartType === 'column';
  // `line` desenha a série como barras finas com marcador: continua sendo DOM contável por
  // `[data-graph-bar]`, mas comunica sequência em vez de magnitude isolada.
  const isLine = chartType === 'line';

  return (
    <div
      data-testid="dynamic-graph"
      data-entity={schema.name}
      data-view-type={viewType}
      // A PROVA no DOM: eixo, medida e tipo que a view declarou.
      data-category-field={categoryField}
      data-value-field={valueField ?? ''}
      data-chart-type={chartType}
      data-graph-bars={shown.length}
      data-graph-peak={peak}
      data-graph-hidden={hidden}
      className="rounded border border-slate-200 bg-white p-4"
    >
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">
          {valueLabel} {t('graph.by', 'por')} {categoryType}
        </h3>
        <p className="text-xs text-slate-500">
          {t('graph.drivenBy', 'Eixo e medida vêm do metadata store')} ·{' '}
          {t('graph.op', 'operação')} <strong>{op}</strong> · {chartType}
        </p>
      </header>

      <div
        role="img"
        aria-label={`${valueLabel} ${t('graph.by', 'por')} ${categoryType}`}
        className={
          vertical
            ? 'flex items-end gap-2 overflow-x-auto border-b border-slate-200 pb-1'
            : 'flex flex-col gap-2'
        }
        style={vertical ? { minHeight: 160 } : undefined}
      >
        {shown.map((bucket) => {
          const ratio = bucket.value === null ? 0 : Math.min(Math.abs(bucket.value) / peak, 1);
          const percent = Math.max(ratio * 100, bucket.value === null ? 0 : 2);
          return (
            <div
              key={bucket.category}
              className={vertical ? 'flex w-16 shrink-0 flex-col items-center' : 'flex items-center gap-2'}
            >
              {vertical ? (
                <>
                  <span className="text-[11px] tabular-nums text-slate-600">
                    {showValues ? format(bucket.value) : ''}
                  </span>
                  <button
                    type="button"
                    data-graph-bar={bucket.category}
                    data-graph-value={bucket.value ?? ''}
                    data-graph-rows={bucket.rows.length}
                    onClick={() => onBarClick?.(bucket.category)}
                    style={{ height: `${Math.round(percent)}%`, minHeight: bucket.value === null ? 0 : 4 }}
                    className="w-8 rounded-t bg-sky-600 hover:bg-sky-700"
                    title={`${bucket.category}: ${format(bucket.value)}`}
                  />
                  <span className="w-16 truncate text-center text-[11px] text-slate-600">
                    {bucket.category}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-32 shrink-0 truncate text-[11px] text-slate-600" title={bucket.category}>
                    {bucket.category}
                  </span>
                  <button
                    type="button"
                    data-graph-bar={bucket.category}
                    data-graph-value={bucket.value ?? ''}
                    data-graph-rows={bucket.rows.length}
                    onClick={() => onBarClick?.(bucket.category)}
                    style={{ width: `${percent}%`, minWidth: bucket.value === null ? 0 : 4, height: isLine ? 3 : 16 }}
                    className={`${isLine ? 'rounded-full bg-emerald-600' : 'rounded-r bg-sky-600'} hover:brightness-90`}
                    title={`${bucket.category}: ${format(bucket.value)}`}
                  />
                  {showValues ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-600">
                      {format(bucket.value)}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>

      {hidden > 0 ? (
        <p data-testid="graph-truncated" className="mt-2 text-xs text-slate-500">
          {hidden} {t('graph.hidden', 'categorias além das exibidas.')}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p data-testid="graph-empty" className="mt-2 text-sm text-slate-500">
          {emptyMessage ?? t('common.empty', 'Nenhum registro encontrado.')}
        </p>
      ) : null}

      {rawChartType !== null && !isChartType(rawChartType) ? (
        <p data-testid="graph-type-gap" className="mt-2 text-xs text-amber-700">
          <code>chartType={rawChartType}</code> não é um tipo conhecido ({CHART_TYPES.join(' | ')}
          ). O gráfico foi desenhado em barras.
        </p>
      ) : null}
    </div>
  );
}

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../ui/utils/cn';
import type { DashboardKpi } from '../utils/build-dashboard-kpis';

/**
 * VISUALIZATION PRIMITIVES (CISNE BI dashboard) — VIZ-001
 *
 * Primitivas presentacionais, tipadas, reutilizaveis, acessiveis e responsivas.
 * Nenhuma regra empresarial e calculada aqui: recebem valores ja resolvidos
 * pelo backend. NO_DATA != 0; available=false nunca aparece como zero.
 * Estados suportados: loading | error | denied | empty | noData | partial | ready.
 */

/** Classe canonica do card de grafico (era duplicada em 4 componentes). */
export const chartCardClassName = 'm-0 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5';

export type ChartStatus = 'ready' | 'loading' | 'error' | 'denied' | 'noData' | 'empty' | 'partial';

const STATUS_TEXT: Record<Exclude<ChartStatus, 'ready' | 'partial'>, string> = {
  loading: 'Carregando dados…',
  error: 'Não foi possível carregar os dados.',
  denied: 'Sem acesso a estes dados.',
  noData: 'Sem dados para exibir.',
  empty: 'Sem dados no período.',
};

/**
 * Notice de estado de grafico. NUNCA renderiza "0" para noData/denied/empty:
 * "sem dado" e "zero real" sao estados distintos (backend entrega o valor resolvido).
 */
export function ChartStateNotice({
  status,
  errorMessage,
}: {
  status: Exclude<ChartStatus, 'ready'>;
  errorMessage?: string;
}) {
  if (status === 'partial') {
    return (
      <p className="mt-4 text-xs text-gray-500" role="status">
        Dados parciais (algumas métricas indisponíveis no escopo).
      </p>
    );
  }
  const message = status === 'error' ? errorMessage ?? STATUS_TEXT.error : STATUS_TEXT[status];
  const role = status === 'error' ? 'alert' : 'status';
  return (
    <p className="mt-4 text-xs text-gray-500" role={role} aria-live="polite">
      {message}
    </p>
  );
}

/** Tabela acessivel generica (screen reader) com os mesmos dados do grafico. */
export function AccessibleDataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  cell,
}: {
  caption: string;
  columns: Array<{ key: string; header: string }>;
  rows: T[];
  rowKey: (row: T) => string;
  cell: (row: T, key: string) => ReactNode;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th scope="col" key={column.key}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column, index) =>
              index === 0 ? (
                <th scope="row" key={column.key} data-cell={column.key}>
                  {cell(row, column.key)}
                </th>
              ) : (
                <td key={column.key} data-cell={column.key}>
                  {cell(row, column.key)}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** KPI presentacional (KPI wrapper canonico). Valor vem resolvido do backend. */
export function Kpi({ kpi, highlighted }: { kpi: DashboardKpi; highlighted: boolean }) {
  const content = (
    <>
      <p className={cn('text-sm font-medium', highlighted ? 'text-brand-800' : 'text-gray-500')}>
        {kpi.label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={cn('text-xl font-semibold tabular-nums', highlighted ? 'text-brand-700' : 'text-gray-900')}
          aria-hidden="true"
        >
          {kpi.value}
        </span>
        {kpi.unit ? (
          <span className={cn('text-sm', highlighted ? 'text-brand-700/70' : 'text-gray-500')}>
            {kpi.unit}
          </span>
        ) : null}
      </p>
      {kpi.context ? (
        <p className={cn('mt-1.5 text-xs', highlighted ? 'text-brand-700/60' : 'text-gray-400')}>
          {kpi.context}
        </p>
      ) : null}
    </>
  );

  const cellClass = cn('min-h-24 px-3.5 py-3.5', highlighted && 'bg-brand-50/60');

  if (kpi.href) {
    return (
      <Link className={cn(cellClass, 'block text-inherit no-underline hover:bg-gray-50/80')} to={kpi.href} aria-label={kpi.ariaLabel}>
        {content}
      </Link>
    );
  }

  return (
    <article className={cellClass} aria-label={kpi.ariaLabel}>
      {content}
    </article>
  );
}

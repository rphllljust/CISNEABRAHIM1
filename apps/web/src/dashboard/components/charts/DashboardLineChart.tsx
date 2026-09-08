import { useState } from 'react';
import { formatDateLabel } from '../../utils/dashboard-formatters';
import { AccessibleDataTable, chartCardClassName } from '../../primitives';
import type { ExecutiveTrendPoint } from '../../types/dashboard.types';

type DashboardLineChartProps = {
  chartId: string;
  title: string;
  description: string;
  summary: string;
  points: ExecutiveTrendPoint[];
};

const WIDTH = 260;
const HEIGHT = 90;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 70;

export function DashboardLineChart({
  chartId,
  title,
  description,
  summary,
  points,
}: DashboardLineChartProps) {
  const titleId = `${chartId}-title`;
  const descId = `${chartId}-desc`;
  const summaryId = `${chartId}-summary`;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const maxValue = Math.max(1, ...points.flatMap((point) => [point.opened, point.completed]));
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;

  const toX = (index: number) =>
    points.length <= 1 ? WIDTH / 2 : (index / (points.length - 1)) * WIDTH;
  const toY = (value: number) => PLOT_BOTTOM - (value / maxValue) * plotHeight;

  const openedPath = buildPath(points, (point) => point.opened, toX, toY);
  const completedPath = buildPath(points, (point) => point.completed, toX, toY);
  const activePoint = activeIndex !== null ? points[activeIndex] : null;
  const lastIndex = points.length - 1;

  return (
    <figure
      className={chartCardClassName}
      aria-labelledby={titleId}
      aria-describedby={`${descId} ${summaryId}`}
    >
      <figcaption>
        <h3 id={titleId} className="text-sm font-semibold text-gray-900">
          {title}
        </h3>
        <p id={descId} className="mt-1 text-xs text-gray-500">
          {description}
        </p>
      </figcaption>

      {points.length === 0 ? (
        <p className="mt-4 text-xs text-gray-500">Sem dados no período.</p>
      ) : (
        <>
          <div className="relative mt-4 w-full">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-24 w-full overflow-visible" aria-hidden>
              <line x1="0" y1="20" x2={WIDTH} y2="20" stroke="#F3F4F6" strokeWidth="1" />
              <line x1="0" y1="45" x2={WIDTH} y2="45" stroke="#F3F4F6" strokeWidth="1" />
              <line x1="0" y1="70" x2={WIDTH} y2="70" stroke="#F3F4F6" strokeWidth="1" />
              <polyline
                points={pathToPolyline(completedPath)}
                fill="none"
                stroke="#166860"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={pathToPolyline(openedPath)}
                fill="none"
                stroke="#D1D5DB"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="1 5"
              />
              {lastIndex >= 0 && points[lastIndex] ? (
                <circle
                  cx={toX(lastIndex)}
                  cy={toY(points[lastIndex].completed)}
                  r="3"
                  fill="#166860"
                />
              ) : null}
            </svg>
            <div className="pointer-events-none absolute inset-0">
              {points.map((point, index) => (
                <button
                  key={point.date}
                  type="button"
                  className="pointer-events-auto absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 border-0 bg-transparent p-0"
                  style={{
                    left: `${(toX(index) / WIDTH) * 100}%`,
                    top: '50%',
                  }}
                  aria-label={`${formatDateLabel(point.date)}: ${point.opened} abertas, ${point.completed} concluídas`}
                  aria-pressed={activeIndex === index}
                  onClick={() => setActiveIndex((current) => (current === index ? null : index))}
                />
              ))}
            </div>
          </div>

          <div className="mt-3 flex gap-4" aria-hidden="true">
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
              Concluídas
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
              Abertas
            </div>
          </div>

          <p id={summaryId} className="mt-4 border-t border-gray-100 pt-4 text-xs text-gray-500">
            {summary}
          </p>

          <AccessibleDataTable
            caption={`Dados de ${title}`}
            columns={[
              { key: 'date', header: 'Data' },
              { key: 'opened', header: 'Abertas' },
              { key: 'completed', header: 'Concluídas' },
            ]}
            rows={points}
            rowKey={(point) => point.date}
            cell={(point, key) =>
              key === 'date' ? formatDateLabel(point.date) : key === 'opened' ? point.opened : point.completed
            }
          />
        </>
      )}

      {activePoint ? (
        <p className="sr-only" role="status">
          {formatDateLabel(activePoint.date)}: {activePoint.opened} abertas, {activePoint.completed}{' '}
          concluídas
        </p>
      ) : null}
    </figure>
  );
}

function buildPath(
  points: ExecutiveTrendPoint[],
  pick: (point: ExecutiveTrendPoint) => number,
  toX: (index: number) => number,
  toY: (value: number) => number,
): Array<{ x: number; y: number }> {
  return points.map((point, index) => ({
    x: toX(index),
    y: toY(pick(point)),
  }));
}

function pathToPolyline(path: Array<{ x: number; y: number }>): string {
  return path.map((point) => `${point.x},${point.y}`).join(' ');
}

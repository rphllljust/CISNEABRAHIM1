import { useState } from 'react';
import { cn } from '../../../ui/utils/cn';
import { AccessibleDataTable, chartCardClassName } from '../../primitives';

type BarItem = {
  key: string;
  label: string;
  value: number;
};

type DashboardBarChartProps = {
  chartId: string;
  title: string;
  description: string;
  summary: string;
  items: BarItem[];
};

export function DashboardBarChart({
  chartId,
  title,
  description,
  summary,
  items,
}: DashboardBarChartProps) {
  const titleId = `${chartId}-title`;
  const descId = `${chartId}-desc`;
  const summaryId = `${chartId}-summary`;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const maxValue = Math.max(1, ...items.map((item) => item.value));
  const activeItem = items.find((item) => item.key === activeKey) ?? null;

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
        <p id={summaryId} className="sr-only">
          {summary}
        </p>
      </figcaption>

      {items.length === 0 ? (
        <p className="mt-4 text-xs text-gray-500">Sem dados no período.</p>
      ) : (
        <>
          <div className="mt-5 space-y-3.5" role="list">
            {items.map((item, index) => {
              const width = `${(item.value / maxValue) * 100}%`;
              return (
                <div key={item.key} className="flex items-center gap-3" role="listitem">
                  <span className="w-16 shrink-0 text-xs text-gray-600">{item.label}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                    <button
                      type="button"
                      className={cn(
                        'block h-full min-w-[2px] rounded-full border-0 p-0',
                        index === 0 ? 'bg-brand-500' : 'bg-gray-400',
                      )}
                      style={{ width }}
                      aria-label={`${item.label}: ${item.value}`}
                      aria-pressed={activeKey === item.key}
                      onClick={() =>
                        setActiveKey((current) => (current === item.key ? null : item.key))
                      }
                      onFocus={() => setActiveKey(item.key)}
                    />
                  </div>
                  <span className="w-5 text-right text-xs font-semibold text-gray-900 tabular-nums">
                    {item.value}
                  </span>
                </div>
              );
            })}
          </div>

          <AccessibleDataTable
            caption={`Dados de ${title}`}
            columns={[
              { key: 'label', header: 'Categoria' },
              { key: 'value', header: 'Quantidade' },
            ]}
            rows={items}
            rowKey={(item) => item.key}
            cell={(item, key) => (key === 'label' ? item.label : item.value)}
          />
        </>
      )}

      {activeItem ? (
        <p className="sr-only" role="status">
          {activeItem.label}: {activeItem.value}
        </p>
      ) : null}
    </figure>
  );
}

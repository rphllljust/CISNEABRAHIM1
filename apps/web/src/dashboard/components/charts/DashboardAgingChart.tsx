import { useState } from 'react';
import { formatMoney } from '../../utils/dashboard-formatters';
import { AccessibleDataTable, chartCardClassName } from '../../primitives';
import type { ExecutiveFinancialAgingBucket } from '../../types/dashboard.types';

type DashboardAgingChartProps = {
  chartId: string;
  title: string;
  description: string;
  summary: string;
  buckets: ExecutiveFinancialAgingBucket[];
};

export function DashboardAgingChart({
  chartId,
  title,
  description,
  summary,
  buckets,
}: DashboardAgingChartProps) {
  const titleId = `${chartId}-title`;
  const descId = `${chartId}-desc`;
  const summaryId = `${chartId}-summary`;
  const [activeBandId, setActiveBandId] = useState<string | null>(null);
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const activeBucket = buckets.find((bucket) => bucket.bandId === activeBandId) ?? null;

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

      {buckets.length === 0 ? (
        <p className="mt-4 text-xs text-gray-500">Faixas de aging não disponíveis.</p>
      ) : (
        <>
          <div className="mt-5 space-y-3.5" role="list">
            {buckets.map((bucket, index) => {
              const width = `${(bucket.count / maxCount) * 100}%`;
              return (
                <div key={bucket.bandId} className="flex items-center gap-3" role="listitem">
                  <span className="w-16 shrink-0 text-xs text-gray-600">{bucket.label}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                    <button
                      type="button"
                      className={`block h-full min-w-[2px] rounded-full border-0 p-0 ${
                        index === 0 ? 'bg-brand-500' : 'bg-gray-400'
                      }`}
                      style={{ width }}
                      aria-label={`${bucket.label}: ${bucket.count} documentos`}
                      aria-pressed={activeBandId === bucket.bandId}
                      onClick={() =>
                        setActiveBandId((current) =>
                          current === bucket.bandId ? null : bucket.bandId,
                        )
                      }
                    />
                  </div>
                  <span className="w-5 text-right text-xs font-semibold text-gray-900 tabular-nums">
                    {bucket.count}
                  </span>
                </div>
              );
            })}
          </div>

          <p id={summaryId} className="mt-4 border-t border-gray-100 pt-4 text-xs text-gray-500">
            {summary}
          </p>

          <AccessibleDataTable
            caption={`Dados de ${title}`}
            columns={[
              { key: 'label', header: 'Faixa' },
              { key: 'count', header: 'Quantidade' },
              { key: 'totalAmount', header: 'Valor' },
            ]}
            rows={buckets}
            rowKey={(bucket) => bucket.bandId}
            cell={(bucket, key) =>
              key === 'label' ? bucket.label : key === 'count' ? bucket.count : formatMoney(bucket.totalAmount)
            }
          />
        </>
      )}

      {activeBucket ? (
        <p className="sr-only" role="status">
          {activeBucket.label}: {activeBucket.count} documentos, {formatMoney(activeBucket.totalAmount)}
        </p>
      ) : null}
    </figure>
  );
}

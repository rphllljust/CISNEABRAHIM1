import { useId } from 'react';
import { formatPercent, formatHours } from '../utils/dashboard-formatters';
import type { ProductivitySummary } from '../types/dashboard.types';

type ProductivityPanelProps = {
  productivity: ProductivitySummary;
};

export function ProductivityPanel({ productivity }: ProductivityPanelProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <header className="mb-4">
        <h2 id={headingId} className="text-base font-semibold text-gray-900">
          Produtividade
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Desempenho operacional no período.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" role="list">
        <Metric
          label="OS concluídas"
          value={String(productivity.completed)}
          detail="Volume no período"
        />
        <Metric
          label="Taxa no prazo"
          value={formatPercent(productivity.onTimeRate)}
          detail={`${productivity.onTimeRate.numerator} de ${productivity.onTimeRate.denominator} elegíveis`}
        />
        <Metric
          label="Cycle time médio"
          value={formatHours(productivity.averageCycleTime.valueHours)}
          detail={`Amostra: ${productivity.averageCycleTime.sampleSize}`}
        />
        <Metric
          label="Retrabalho"
          value={formatPercent(productivity.reworkRate)}
          detail={
            productivity.reworkRate.concept
              ? `${productivity.reworkRate.numerator} de ${productivity.reworkRate.denominator} medições`
              : 'Amostra insuficiente'
          }
        />
        <Metric
          label="Utilização"
          value={formatPercent(productivity.utilization)}
          detail={
            productivity.utilization.concept
              ? `${productivity.utilization.numerator} de ${productivity.utilization.denominator} segundos`
              : 'Amostra insuficiente'
          }
        />
      </div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article
      className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5"
      role="listitem"
      aria-label={`${label}: ${value}`}
    >
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-gray-900 tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-gray-400">{detail}</p>
    </article>
  );
}

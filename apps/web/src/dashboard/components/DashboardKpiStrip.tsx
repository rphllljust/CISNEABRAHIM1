import { Kpi } from '../primitives';
import type { DashboardKpi } from '../utils/build-dashboard-kpis';

type DashboardKpiStripProps = {
  kpis: DashboardKpi[];
};

function isHighlightedKpi(kpi: DashboardKpi, index: number, total: number) {
  return kpi.id === 'on-time-rate' || (kpi.id !== 'active-service-orders' && index === total - 1 && total > 1);
}

export function DashboardKpiStrip({ kpis }: DashboardKpiStripProps) {
  if (kpis.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="kpi-heading">
      <header className="mb-4">
        <h2 id="kpi-heading" className="text-base font-semibold text-gray-900">
          Indicadores principais
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">Resumo dos resultados no período selecionado.</p>
      </header>

      <div
        className="mb-12 grid grid-cols-1 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-900/5 sm:grid-cols-2 sm:divide-x sm:divide-gray-200 lg:grid-cols-4"
        role="list"
      >
        {kpis.map((kpi, index) => (
          <div key={kpi.id} role="listitem">
            <Kpi kpi={kpi} highlighted={isHighlightedKpi(kpi, index, kpis.length)} />
          </div>
        ))}
      </div>
    </section>
  );
}

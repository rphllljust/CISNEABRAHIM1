import { Kpi } from '../primitives';
import type { DashboardKpi } from '../utils/build-dashboard-kpis';

type DashboardKpiStripProps = {
  kpis: DashboardKpi[];
};

/**
 * Destaque vem do SIGNIFICADO do KPI (variante semântica), nunca da posição visual.
 * Exceções (critical/warning) são elevadas; o restante permanece em segundo plano.
 */
function isHighlightedKpi(kpi: DashboardKpi): boolean {
  return kpi.variant === 'critical' || kpi.variant === 'warning' || kpi.variant === 'primary';
}

export function DashboardKpiStrip({ kpis }: DashboardKpiStripProps) {
  if (kpis.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="kpi-heading">
      <header className="mb-3">
        <h2 id="kpi-heading" className="text-base font-semibold text-gray-900">
          Indicadores principais
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">Resumo dos resultados no período selecionado.</p>
      </header>

      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        role="list"
      >
        {kpis.map((kpi) => (
          <div
            key={kpi.id}
            className="overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-gray-900/5"
            role="listitem"
          >
            <Kpi kpi={kpi} highlighted={isHighlightedKpi(kpi)} />
          </div>
        ))}
      </div>
    </section>
  );
}

import { Link } from 'react-router-dom';
import { AttentionBlock } from '../components/AttentionBlock';
import { DashboardAgingChart } from '../components/charts/DashboardAgingChart';
import { DashboardBarChart } from '../components/charts/DashboardBarChart';
import { DashboardLineChart } from '../components/charts/DashboardLineChart';
import { DashboardSlaChart } from '../components/charts/DashboardSlaChart';
import { DashboardKpiStrip } from '../components/DashboardKpiStrip';
import { DashboardPageHeader } from '../components/DashboardPageHeader';
import { OperationalDashboardSkeleton } from '../components/OperationalDashboardSkeleton';
import { ProductivityPanel } from '../components/ProductivityPanel';
import { useExecutiveDashboard } from '../hooks/useExecutiveDashboard';
import { buildDashboardKpis } from '../utils/build-dashboard-kpis';
import { semanticMetricAttrs, semanticSectionAttrs } from '../semantic-dashboard';
import '../dashboard.css';

function formatGeneratedAt(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatPeriodLabel(from: string, to: string): string {
  return `${from} — ${to}`;
}

function buildActiveFilterLabels(filters: {
  period: string;
  unitId?: string;
  from?: string;
  to?: string;
}): string[] {
  const labels: string[] = [];
  if (filters.unitId) {
    labels.push(`Unidade: ${filters.unitId}`);
  }
  if (filters.from) {
    labels.push(`De: ${filters.from}`);
  }
  if (filters.to) {
    labels.push(`Até: ${filters.to}`);
  }
  return labels;
}

export function OperationalDashboardPage() {
  const { state, reload, filters, setFilters, periodOptions, isRefreshing } = useExecutiveDashboard();

  const headerProps = {
    title: 'Visão geral',
    period: filters.period,
    periodOptions,
    onPeriodChange: (period: string) => setFilters({ period }),
    isRefreshing,
    onRefresh: () => void reload(),
  };

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="dashboard-page w-full max-w-7xl">
        <DashboardPageHeader
          {...headerProps}
          periodLabel={null}
          activeFilters={[]}
          generatedAt={null}
          generatedAtFormatted={null}
        />
        <OperationalDashboardSkeleton />
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="dashboard-page w-full max-w-7xl">
        <DashboardPageHeader
          {...headerProps}
          periodLabel={null}
          activeFilters={[]}
          generatedAt={null}
          generatedAtFormatted={null}
          isRefreshing={false}
        />
        <div className="dashboard-denied" role="alert">
          <p>Você não tem permissão para visualizar o painel operacional.</p>
          <Link className="dashboard-denied__link" to="/app/requests">
            Ir para solicitações
          </Link>
        </div>
      </main>
    );
  }

  const snapshot = state.phase === 'ready' ? state.snapshot : state.partial;
  const kpis = snapshot ? buildDashboardKpis(snapshot) : [];
  const activeFilters = buildActiveFilterLabels(filters);
  const periodLabel = snapshot ? formatPeriodLabel(snapshot.period.from, snapshot.period.to) : null;

  return (
    <main id="main-content" className="dashboard-page w-full max-w-7xl">
      <DashboardPageHeader
        {...headerProps}
        periodLabel={periodLabel}
        activeFilters={activeFilters}
        onClearFilters={
          activeFilters.length > 0 ? () => setFilters({ unitId: '', from: '', to: '' }) : undefined
        }
        generatedAt={snapshot?.generatedAt ?? null}
        generatedAtFormatted={snapshot ? formatGeneratedAt(snapshot.generatedAt) : null}
      />

      {state.phase === 'error' ? (
        <div className="dashboard-alert" role="alert">
          <p>{state.message}</p>
          <button type="button" className="dashboard-alert__retry" onClick={() => void reload()}>
            Tentar novamente
          </button>
        </div>
      ) : null}

      {snapshot ? (
        <>
          <div className="mb-8 grid gap-5 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(38rem,1.6fr)] xl:items-start">
            <AttentionBlock items={snapshot.attention} />
            <DashboardKpiStrip kpis={kpis} />
          </div>

          {snapshot.visibility.serviceOrders ? (
            <section aria-labelledby="operational-heading">
              <header className="mb-4">
                <h2 id="operational-heading" className="m-0 text-base font-semibold text-gray-900">
                  Visão operacional
                </h2>
                <p className="mt-0.5 text-sm text-gray-500">
                  Distribuição, evolução e cumprimento de prazos no período selecionado.
                </p>
              </header>
              <div className="dashboard-analytics grid grid-cols-1 gap-5 lg:grid-cols-3">
                <DashboardBarChart
                  chartId="service-orders-by-status"
                  title={snapshot.charts.serviceOrdersByStatus.title}
                  description={snapshot.charts.serviceOrdersByStatus.description}
                  summary={snapshot.charts.serviceOrdersByStatus.summary}
                  items={snapshot.charts.serviceOrdersByStatus.items.map((item) => ({
                    key: item.status,
                    label: item.label,
                    value: item.count,
                  }))}
                />
                <DashboardLineChart
                  chartId="throughput-trend"
                  title={snapshot.charts.throughputTrend.title}
                  description={snapshot.charts.throughputTrend.description}
                  summary={snapshot.charts.throughputTrend.summary}
                  points={snapshot.charts.throughputTrend.points}
                />
                <DashboardSlaChart
                  chartId="sla-chart"
                  title={snapshot.charts.sla.title}
                  description={snapshot.charts.sla.description}
                  summary={snapshot.charts.sla.summary}
                  points={snapshot.charts.sla.points}
                />
              </div>
            </section>
          ) : null}

          {snapshot.visibility.productivity && snapshot.productivity ? (
            <div
              {...semanticSectionAttrs([
                'productivity.completed_count',
                'productivity.on_time_rate',
                'productivity.avg_cycle_hours',
                'productivity.rework_rate',
              ])}
            >
              <ProductivityPanel productivity={snapshot.productivity} />
            </div>
          ) : null}

          {snapshot.visibility.financialAging && snapshot.charts.financialAging.available ? (
            <section
              {...semanticSectionAttrs(['receivables.overdue_count', 'receivables.overdue_amount'])}
              aria-labelledby="finance-heading"
            >
              <header className="mb-4">
                <h2 id="finance-heading" className="m-0 text-base font-semibold text-gray-900">
                  Visão financeira
                </h2>
                <p className="mt-0.5 text-sm text-gray-500">
                  Recebíveis vencidos por faixa de aging configurada.
                </p>
              </header>
              <div {...semanticMetricAttrs('receivables.overdue_count')}>
                <DashboardAgingChart
                  chartId="financial-aging"
                  title={snapshot.charts.financialAging.title}
                  description={snapshot.charts.financialAging.description}
                  summary={snapshot.charts.financialAging.summary}
                  buckets={snapshot.charts.financialAging.buckets}
                />
              </div>
            </section>
          ) : null}

          {snapshot.shortcuts.length > 0 ? (
            <section aria-labelledby="shortcuts-heading">
              <header className="mb-4">
                <h2 id="shortcuts-heading" className="m-0 text-base font-semibold text-gray-900">
                  Acesso rápido
                </h2>
              </header>
              <nav className="flex flex-wrap gap-2.5" aria-label="Atalhos operacionais">
                {snapshot.shortcuts.map((shortcut) => (
                  <Link
                    key={shortcut.id}
                    className="inline-flex min-h-9 items-center rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm no-underline transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                    to={shortcut.href}
                    aria-label={shortcut.ariaLabel}
                  >
                    {shortcut.label}
                  </Link>
                ))}
              </nav>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

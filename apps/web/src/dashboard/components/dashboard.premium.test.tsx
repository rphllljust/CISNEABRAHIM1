import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DashboardKpiStrip } from './DashboardKpiStrip';
import { DashboardPageHeader } from './DashboardPageHeader';
import { buildDashboardKpis } from '../utils/build-dashboard-kpis';
import { EXECUTIVE_DASHBOARD_SNAPSHOT } from '../../test/dashboard-fetch-mock';

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
] as const;

describe('DashboardPageHeader', () => {
  it('renders a compact command header with scope, period and refresh control', () => {
    render(
      <DashboardPageHeader
        title="Visão geral"
        unitLabel="Todas as unidades autorizadas"
        periodLabel="2026-08-23 — 2026-08-29"
        period="week"
        periodOptions={PERIOD_OPTIONS}
        onPeriodChange={() => undefined}
        activeFilters={[]}
        generatedAt="2026-08-29T12:00:00.000Z"
        generatedAtFormatted="29/08/2026, 08:00"
        isRefreshing={false}
        onRefresh={() => undefined}
        domain={null}
        onDomainChange={() => undefined}
        overdueOnly={false}
        onOverdueChange={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeInTheDocument();
    expect(screen.getByText('2026-08-23 — 2026-08-29')).toBeInTheDocument();
    expect(screen.getByText('Todas as unidades autorizadas')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Período' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
    expect(screen.queryByText(/período analisado/i)).not.toBeInTheDocument();
  });
});

describe('DashboardKpiStrip', () => {
  it('derives prioritised KPIs from the executive snapshot without fabricated values', () => {
    const kpis = buildDashboardKpis(EXECUTIVE_DASHBOARD_SNAPSHOT);
    render(
      <MemoryRouter>
        <DashboardKpiStrip kpis={kpis} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /saúde da empresa/i })).toBeInTheDocument();
    // Existe KPI de dinheiro na faixa e ele vem antes do volume de OS.
    const receivablesIndex = kpis.findIndex((kpi) => kpi.id === 'overdue-receivables');
    const activeIndex = kpis.findIndex((kpi) => kpi.id === 'active-service-orders');
    expect(receivablesIndex).toBeGreaterThanOrEqual(0);
    expect(receivablesIndex).toBeLessThan(activeIndex);
    // Nenhum KPI inventa valor: todo valor e nao-vazio e vem do snapshot.
    expect(kpis.every((kpi) => kpi.value.length > 0 && kpi.value !== '0')).toBe(true);
    expect(screen.getByLabelText(/OS ativas: 6 ordens no escopo/i)).toHaveAttribute(
      'href',
      '/app/service-orders?status=active',
    );
    expect(screen.getByLabelText(/OS concluídas no período: 10/i)).toHaveAttribute(
      'href',
      '/app/service-orders?status=COMPLETED&from=2026-08-23&to=2026-08-29&event=completed',
    );
    // KPI sem lista filtrada real nao promete drill.
    expect(screen.getByLabelText(/Taxa no prazo: 80,00%/i)).toBeInTheDocument();
    expect(screen.getAllByText('sem lista filtrada').length).toBe(1);
  });

  it('never exceeds 7 executive KPIs', () => {
    expect(buildDashboardKpis(EXECUTIVE_DASHBOARD_SNAPSHOT).length).toBeLessThanOrEqual(7);
  });

  it('returns null when no KPIs are available', () => {
    const { container } = render(<DashboardKpiStrip kpis={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('buildDashboardKpis', () => {
  it('does not include financial KPI when aging is unavailable', () => {
    const snapshot = {
      ...EXECUTIVE_DASHBOARD_SNAPSHOT,
      charts: {
        ...EXECUTIVE_DASHBOARD_SNAPSHOT.charts,
        financialAging: {
          ...EXECUTIVE_DASHBOARD_SNAPSHOT.charts.financialAging,
          available: false,
          buckets: [],
        },
      },
    };
    const kpis = buildDashboardKpis(snapshot);
    expect(kpis.some((kpi) => kpi.id === 'overdue-receivables')).toBe(false);
  });
});

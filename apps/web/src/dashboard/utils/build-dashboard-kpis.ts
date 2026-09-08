import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';
import { formatPercent } from './dashboard-formatters';
import { frontendDrillHrefForMetric } from '../drill-contract';
import { SERVICE_ORDER_STATUSES } from '../../service-orders/types/service-order.types';
import {
  SERVICE_ORDER_ACTIVE_STATUS,
  SERVICE_ORDER_LIST_EVENTS,
} from '../../service-orders/types/service-order-list.types';
import { buildServiceOrdersListHref } from '../../service-orders/utils/service-order-list-params';

export type DashboardKpiVariant = 'primary' | 'secondary' | 'critical' | 'warning' | 'success';

export type DashboardKpi = {
  id: string;
  label: string;
  value: string;
  unit: string | null;
  context: string;
  href: string | null;
  ariaLabel: string;
  variant: DashboardKpiVariant;
};

function sumStatusCounts(snapshot: ExecutiveDashboardSnapshot): number {
  return snapshot.charts.serviceOrdersByStatus.items.reduce((total, item) => total + item.count, 0);
}

function sumThroughput(snapshot: ExecutiveDashboardSnapshot): { opened: number; completed: number } {
  return snapshot.charts.throughputTrend.points.reduce(
    (totals, point) => ({
      opened: totals.opened + point.opened,
      completed: totals.completed + point.completed,
    }),
    { opened: 0, completed: 0 },
  );
}

function sumAgingCount(snapshot: ExecutiveDashboardSnapshot): number {
  return snapshot.charts.financialAging.buckets.reduce((total, bucket) => total + bucket.count, 0);
}

export function buildDashboardKpis(snapshot: ExecutiveDashboardSnapshot): DashboardKpi[] {
  const kpis: DashboardKpi[] = [];
  const periodContext = `${snapshot.period.from} — ${snapshot.period.to}`;

  if (snapshot.visibility.serviceOrders) {
    const activeCount = sumStatusCounts(snapshot);
    kpis.push({
      id: 'active-service-orders',
      label: 'OS ativas',
      value: String(activeCount),
      unit: activeCount === 1 ? 'ordem' : 'ordens',
      context: 'Distribuição atual no escopo autorizado',
      href: buildServiceOrdersListHref({ status: SERVICE_ORDER_ACTIVE_STATUS }),
      ariaLabel: `OS ativas: ${activeCount} ${activeCount === 1 ? 'ordem' : 'ordens'} no escopo`,
      variant: 'primary',
    });

    const throughput = sumThroughput(snapshot);
    if (throughput.opened > 0 || throughput.completed > 0) {
      kpis.push({
        id: 'throughput-opened',
        label: 'OS abertas no período',
        value: String(throughput.opened),
        unit: throughput.opened === 1 ? 'ordem' : 'ordens',
        context: periodContext,
        href: buildServiceOrdersListHref({
          from: snapshot.period.from,
          to: snapshot.period.to,
          event: SERVICE_ORDER_LIST_EVENTS.Opened,
        }),
        ariaLabel: `OS abertas no período: ${throughput.opened}`,
        variant: 'secondary',
      });
    }
  }

  if (snapshot.visibility.productivity && snapshot.productivity) {
    const { productivity } = snapshot;
    kpis.push({
      id: 'completed-service-orders',
      label: 'OS concluídas',
      value: String(productivity.completed),
      unit: productivity.completed === 1 ? 'ordem' : 'ordens',
      context: periodContext,
      href: buildServiceOrdersListHref({
        status: SERVICE_ORDER_STATUSES.Completed,
        from: snapshot.period.from,
        to: snapshot.period.to,
        event: SERVICE_ORDER_LIST_EVENTS.Completed,
      }),
      ariaLabel: `OS concluídas no período: ${productivity.completed}`,
      variant: 'success',
    });

    if (productivity.onTimeRate.available) {
      kpis.push({
        id: 'on-time-rate',
        label: 'Taxa no prazo',
        value: formatPercent(productivity.onTimeRate),
        unit: null,
        context: `${productivity.onTimeRate.numerator} de ${productivity.onTimeRate.denominator} elegíveis`,
        href: null,
        ariaLabel: `Taxa no prazo: ${formatPercent(productivity.onTimeRate)}`,
        variant: 'secondary',
      });
    }
  }

  if (snapshot.visibility.billing && snapshot.charts.financialAging.available) {
    const overdueCount = sumAgingCount(snapshot);
    const alreadyInAttention = snapshot.attention.some((item) => item.id === 'overdue-receivables');
    if (overdueCount > 0 && !alreadyInAttention) {
      kpis.push({
        id: 'overdue-receivables',
        label: 'Recebíveis vencidos',
        value: String(overdueCount),
        unit: overdueCount === 1 ? 'documento' : 'documentos',
        context: snapshot.charts.financialAging.summary,
        href: frontendDrillHrefForMetric('receivables.overdue_count') ?? '/app/billing?filter=overdue',
        ariaLabel: `Recebíveis vencidos: ${overdueCount} documentos`,
        variant: 'warning',
      });
    }
  }

  return kpis;
}

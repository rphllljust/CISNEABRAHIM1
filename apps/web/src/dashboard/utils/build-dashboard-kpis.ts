import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';
import { formatPercent } from './dashboard-formatters';
import { frontendDrillHrefForMetric } from '../drill-contract';
import {
  DASHBOARD_DRILL_DESTINATIONS,
  extractOverdueExposure,
} from './dashboard-semantics';
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
  /** Rotulo curto da acao prometida pelo KPI (drill real) ou `null` sem drill. */
  actionLabel: string | null;
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

function attentionCount(snapshot: ExecutiveDashboardSnapshot, id: string): number {
  return snapshot.attention.find((item) => item.id === id)?.count ?? 0;
}

function attentionHref(snapshot: ExecutiveDashboardSnapshot, id: string): string | null {
  return snapshot.attention.find((item) => item.id === id)?.href ?? null;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * FAIXA DE KPIs EXECUTIVOS — no maximo 7, e cada um SÓ existe se o valor real
 * estiver no snapshot. Metrica nao publicada nao vira card com zero.
 *
 * Ordem deliberada: primeiro o dinheiro e o atraso (onde a decisao mora), depois
 * o volume. Volume de OS nunca ocupa a primeira posicao sozinho.
 */
export function buildDashboardKpis(snapshot: ExecutiveDashboardSnapshot): DashboardKpi[] {
  const kpis: DashboardKpi[] = [];
  const periodContext = `${snapshot.period.from} — ${snapshot.period.to}`;
  const overdueExposure = extractOverdueExposure(
    snapshot.attention.find((item) => item.id === 'overdue-receivables'),
  );

  if (snapshot.visibility.billing && snapshot.charts.financialAging.available) {
    const overdueCount = attentionCount(snapshot, 'overdue-receivables');
    if (overdueCount > 0) {
      kpis.push({
        id: 'overdue-receivables',
        label: 'Recebíveis vencidos',
        value: String(overdueCount),
        unit: plural(overdueCount, 'título', 'títulos'),
        context: overdueExposure ? `${overdueExposure} em atraso` : snapshot.charts.financialAging.summary,
        href:
          frontendDrillHrefForMetric('receivables.overdue_count') ??
          DASHBOARD_DRILL_DESTINATIONS['receivables-overdue'],
        ariaLabel: `Recebíveis vencidos: ${overdueCount} ${plural(overdueCount, 'título', 'títulos')}`,
        variant: 'critical',
        actionLabel: 'Ver vencidos',
      });
    }
  }

  if (snapshot.visibility.serviceOrders) {
    const overdueCount = attentionCount(snapshot, 'overdue-service-orders');
    if (overdueCount > 0) {
      const maxDelay = snapshot.attention.find((item) => item.id === 'overdue-service-orders')?.maxDelayDays;
      kpis.push({
        id: 'overdue-service-orders',
        label: 'OS vencidas',
        value: String(overdueCount),
        unit: plural(overdueCount, 'ordem', 'ordens'),
        context:
          maxDelay !== null && maxDelay !== undefined
            ? `Maior atraso: ${maxDelay} ${maxDelay === 1 ? 'dia' : 'dias'}`
            : 'Prazo vencido',
        href: attentionHref(snapshot, 'overdue-service-orders') ?? frontendDrillHrefForMetric('service_orders.overdue_count'),
        ariaLabel: `OS vencidas: ${overdueCount} ${plural(overdueCount, 'ordem', 'ordens')}`,
        variant: 'critical',
        actionLabel: 'Ver vencidas',
      });
    }

    const approaching = attentionCount(snapshot, 'approaching-due-service-orders');
    if (approaching > 0) {
      kpis.push({
        id: 'approaching-due-service-orders',
        label: 'OS vencendo',
        value: String(approaching),
        unit: plural(approaching, 'ordem', 'ordens'),
        context: 'Prazo nos próximos dias',
        href:
          attentionHref(snapshot, 'approaching-due-service-orders') ??
          frontendDrillHrefForMetric('service_orders.approaching_due_count'),
        ariaLabel: `OS vencendo em breve: ${approaching} ${plural(approaching, 'ordem', 'ordens')}`,
        variant: 'warning',
        actionLabel: 'Ver a vencer',
      });
    }
  }

  if (snapshot.visibility.billing) {
    const awaiting = attentionCount(snapshot, 'pending-billing');
    if (awaiting > 0) {
      kpis.push({
        id: 'awaiting-billing',
        label: 'Aguardando faturamento',
        value: String(awaiting),
        unit: plural(awaiting, 'OS', 'OS'),
        context: 'Concluídas sem cobrança preparada',
        href: DASHBOARD_DRILL_DESTINATIONS['awaiting-billing'],
        ariaLabel: `OS aguardando faturamento: ${awaiting}`,
        variant: 'warning',
        actionLabel: 'Ver fila',
      });
    }
  }

  if (snapshot.visibility.serviceOrders) {
    const activeCount = sumStatusCounts(snapshot);
    if (activeCount > 0) {
      kpis.push({
        id: 'active-service-orders',
        label: 'OS ativas',
        value: String(activeCount),
        unit: plural(activeCount, 'ordem', 'ordens'),
        context: 'Distribuição atual no escopo autorizado',
        href: buildServiceOrdersListHref({ status: SERVICE_ORDER_ACTIVE_STATUS }),
        ariaLabel: `OS ativas: ${activeCount} ${plural(activeCount, 'ordem', 'ordens')} no escopo`,
        variant: 'primary',
        actionLabel: 'Ver ordens',
      });
    }
  }

  if (snapshot.visibility.productivity && snapshot.productivity) {
    const { productivity } = snapshot;
    if (productivity.completed > 0) {
      kpis.push({
        id: 'completed-service-orders',
        label: 'OS concluídas',
        value: String(productivity.completed),
        unit: plural(productivity.completed, 'ordem', 'ordens'),
        context: periodContext,
        href: buildServiceOrdersListHref({
          status: SERVICE_ORDER_STATUSES.Completed,
          from: snapshot.period.from,
          to: snapshot.period.to,
          event: SERVICE_ORDER_LIST_EVENTS.Completed,
        }),
        ariaLabel: `OS concluídas no período: ${productivity.completed}`,
        variant: 'success',
        actionLabel: 'Ver concluídas',
      });
    }

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
        actionLabel: null,
      });
    }
  }

  return kpis.slice(0, 7);
}

/**
 * VOLUME DO PERIODO — leitura secundaria (nao compete com a faixa de decisao).
 * So existe quando a serie do periodo traz movimento real.
 */
export function buildPeriodVolume(snapshot: ExecutiveDashboardSnapshot): {
  opened: number;
  completed: number;
  hrefOpened: string;
  hrefCompleted: string;
} | null {
  const throughput = sumThroughput(snapshot);
  if (throughput.opened === 0 && throughput.completed === 0) {
    return null;
  }
  return {
    ...throughput,
    hrefOpened: buildServiceOrdersListHref({
      from: snapshot.period.from,
      to: snapshot.period.to,
      event: SERVICE_ORDER_LIST_EVENTS.Opened,
    }),
    hrefCompleted: buildServiceOrdersListHref({
      status: SERVICE_ORDER_STATUSES.Completed,
      from: snapshot.period.from,
      to: snapshot.period.to,
      event: SERVICE_ORDER_LIST_EVENTS.Completed,
    }),
  };
}

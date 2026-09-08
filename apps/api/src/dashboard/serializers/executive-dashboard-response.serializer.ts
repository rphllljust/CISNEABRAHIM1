import { buildProductivitySummary } from '../../analytics/domain/productivity.engine';
import type { ProductivityRawAggregates } from '../../analytics/domain/productivity-summary';
import type { OperationalDashboardCounts } from '../repositories/operational-dashboard.repository';
import type {
  ExecutiveAttentionItem,
  ExecutiveChartRawData,
  ExecutiveDashboardSnapshot,
} from '../domain/executive-dashboard';
import type { DashboardVisibility } from '../domain/operational-dashboard';
import { buildOperationalDashboardSnapshot } from './operational-dashboard-response.serializer';
import {
  buildDrillHref,
  drillDestinationByAttentionId,
} from '../../platform/analytics/filter-drill-contract';

export function buildExecutiveDashboardSnapshot(input: {
  generatedAt: string;
  businessTimezone: string;
  period: { preset: string; from: string; to: string };
  visibility: DashboardVisibility & { productivity: boolean; financialAging: boolean };
  operationalCounts: OperationalDashboardCounts;
  chartData: ExecutiveChartRawData;
  productivityRaw: ProductivityRawAggregates | null;
}): ExecutiveDashboardSnapshot {
  const operational = buildOperationalDashboardSnapshot({
    generatedAt: input.generatedAt,
    visibility: input.visibility,
    counts: input.operationalCounts,
  });

  const attention = buildAttentionItems({
    operational,
    chartData: input.chartData,
    visibility: input.visibility,
  });

  const statusTotal = input.chartData.statusDistribution.reduce((sum, item) => sum + item.count, 0);
  const trendOpened = input.chartData.throughputTrend.reduce((sum, point) => sum + point.opened, 0);
  const trendCompleted = input.chartData.throughputTrend.reduce((sum, point) => sum + point.completed, 0);

  return {
    generatedAt: input.generatedAt,
    businessTimezone: input.businessTimezone,
    period: input.period,
    visibility: input.visibility,
    attention,
    charts: {
      serviceOrdersByStatus: {
        title: 'OS por status',
        description: 'Distribuição atual de ordens de serviço no escopo autorizado.',
        items: input.chartData.statusDistribution,
        summary:
          statusTotal > 0
            ? `${statusTotal} ordens de serviço ativas no escopo.`
            : 'Nenhuma ordem de serviço ativa no escopo.',
      },
      throughputTrend: {
        title: 'Evolução temporal',
        description: 'Série diária de OS abertas e concluídas no período selecionado.',
        points: input.chartData.throughputTrend,
        summary: `${trendOpened} abertas e ${trendCompleted} concluídas no período.`,
      },
      sla: {
        title: 'SLA de conclusão',
        description:
          'Conclusões dentro e fora do prazo por semana. Taxa usa denominador explícito (elegíveis com prazo).',
        points: input.chartData.slaPoints,
        summary: buildSlaSummary(input.chartData.slaPoints),
      },
      financialAging: {
        available: input.chartData.financialAgingAvailable && input.visibility.financialAging,
        title: 'Aging financeiro',
        description: input.chartData.financialAgingAvailable
          ? 'Recebíveis vencidos por faixa configurada.'
          : 'Faixas de aging não configuradas — exibindo totais sem classificação arbitrária.',
        buckets: input.visibility.financialAging ? input.chartData.financialAgingBuckets : [],
        summary: input.visibility.financialAging
          ? `${input.chartData.overdueReceivablesCount} recebíveis vencidos.`
          : 'Sem permissão financeira para exibir aging.',
      },
    },
    productivity:
      input.visibility.productivity && input.productivityRaw
        ? buildProductivitySummary(input.productivityRaw)
        : null,
    shortcuts: operational.shortcuts,
  };
}

function buildAttentionItems(input: {
  operational: ReturnType<typeof buildOperationalDashboardSnapshot>;
  chartData: ExecutiveChartRawData;
  visibility: DashboardVisibility;
}): ExecutiveAttentionItem[] {
  const items: ExecutiveAttentionItem[] = [];

  const overdue = input.operational.attention.find((item) => item.id === 'overdue-service-orders');
  if (overdue && overdue.count > 0) {
    items.push({
      id: 'overdue-service-orders',
      label: 'OS vencidas',
      count: overdue.count,
      severity: 'critical',
      href: buildDrillHref(drillDestinationByAttentionId('overdue-service-orders')!),
      ariaLabel: `OS vencidas: ${overdue.count} itens. Maior atraso ${input.chartData.overdueMaxDelayDays ?? 0} dias.`,
      maxDelayDays: input.chartData.overdueMaxDelayDays,
      detail:
        input.chartData.overdueMaxDelayDays !== null
          ? `Maior atraso: ${input.chartData.overdueMaxDelayDays} dia(s)`
          : null,
    });
  }

  if (input.chartData.approachingDueCount > 0 && input.visibility.serviceOrders) {
    items.push({
      id: 'approaching-due-service-orders',
      label: 'OS vencendo em breve',
      count: input.chartData.approachingDueCount,
      severity: 'warning',
      href: buildDrillHref(drillDestinationByAttentionId('approaching-due-service-orders')!),
      ariaLabel: `OS vencendo em breve: ${input.chartData.approachingDueCount} itens`,
      maxDelayDays: null,
      detail: 'Prazo nos próximos 7 dias',
    });
  }

  const measurements = input.operational.attention.find((item) => item.id === 'pending-measurements');
  if (measurements && measurements.count > 0) {
    items.push({
      id: measurements.id,
      label: 'Medições paradas',
      count: measurements.count,
      severity: 'warning',
      href: measurements.href,
      ariaLabel: measurements.ariaLabel,
      maxDelayDays: null,
      detail: 'Aguardando análise ou aprovação',
    });
  }

  if (input.visibility.billing && input.chartData.overdueReceivablesCount > 0) {
    items.push({
      id: 'overdue-receivables',
      label: 'Faturamentos vencidos',
      count: input.chartData.overdueReceivablesCount,
      severity: 'critical',
      href: buildDrillHref(drillDestinationByAttentionId('overdue-receivables')!),
      ariaLabel: `Faturamentos vencidos: ${input.chartData.overdueReceivablesCount} itens`,
      maxDelayDays: null,
      detail: `Exposição: R$ ${input.chartData.overdueReceivablesAmount}`,
    });
  }

  const divergences = input.operational.attention.find((item) => item.id === 'divergences');
  if (divergences && divergences.count > 0) {
    items.push({
      id: divergences.id,
      label: 'Divergências comerciais',
      count: divergences.count,
      severity: 'critical',
      href: divergences.href,
      ariaLabel: divergences.ariaLabel,
      maxDelayDays: null,
      detail: 'Medições rejeitadas ou faturamento anulado',
    });
  }

  return items;
}

function buildSlaSummary(points: ExecutiveChartRawData['slaPoints']): string {
  const eligible = points.reduce((sum, point) => sum + point.eligible, 0);
  const onTime = points.reduce((sum, point) => sum + point.onTime, 0);
  if (eligible === 0) {
    return 'Sem conclusões elegíveis com prazo no período.';
  }
  const rate = ((onTime / eligible) * 100).toFixed(1);
  return `${onTime} de ${eligible} conclusões elegíveis no prazo (${rate}%).`;
}

import { frontendDrillHrefForMetric } from './drill-contract';

/**
 * COMPOSITE DASHBOARDS — camada declarativa do painel executivo.
 *
 * Referencia o catalogo SMC-001 (espelho frontend, somente CONFIRMED) e o contrato
 * de drill FDC-001 (espelho). Nenhuma formula/regra empresarial aqui: o frontend
 * apenas declara o que ja e renderizado a partir do snapshot composto unico
 * (GET /dashboard/executive via useExecutiveDashboard - um unico request, sem N+1).
 *
 * Regras:
 *  - somente metricas CONFIRMED aparecem como card de metrica (BLOCKED/CANDIDATE nunca);
 *  - viz em enum fixo (Kpi/Bar/Line/Stack/Table/Attention);
 *  - drill somente via FDC-001; equality certificada so para service_orders.overdue_count;
 *    browse-only (receivables) nao promete igualdade numerica.
 */

export const SMC001_CONFIRMED_FRONT: ReadonlyArray<{ id: string; version: string }> = [
  { id: 'service_orders.overdue_count', version: '1.0.0' },
  { id: 'service_orders.approaching_due_count', version: '1.0.0' },
  { id: 'service_orders.awaiting_billing_count', version: '1.0.0' },
  { id: 'measurements.aging_count', version: '1.0.0' },
  { id: 'billing.awaiting_preparation_count', version: '1.0.0' },
  { id: 'billing.prepared_count', version: '1.0.0' },
  { id: 'billing.prepared_amount', version: '1.0.0' },
  { id: 'receivables.awaiting_payment_count', version: '1.0.0' },
  { id: 'receivables.awaiting_payment_amount', version: '1.0.0' },
  { id: 'receivables.overdue_count', version: '1.0.0' },
  { id: 'receivables.overdue_amount', version: '1.0.0' },
  { id: 'productivity.completed_count', version: '1.0.0' },
  { id: 'productivity.on_time_rate', version: '1.0.0' },
  { id: 'productivity.avg_cycle_hours', version: '1.0.0' },
  { id: 'productivity.rework_rate', version: '1.0.0' },
];

export type CompositeVisualization = 'Kpi' | 'Bar' | 'Line' | 'Stack' | 'Table' | 'Attention';

export type DrillPromise = 'certified-count' | 'browse' | null;

export type DashboardCardRef = {
  metricId: string;
  metricVersion: string;
  visualization: CompositeVisualization;
  /** Filtros compativeis com o contrato (apenas os ja suportados). */
  filters: string[];
  /** 'certified-count' = igualdade de contagem comprovada; 'browse' = sem promessa numerica. */
  drill: DrillPromise;
  href: string | null;
};

const CONFIRMED_BY_ID = new Map(SMC001_CONFIRMED_FRONT.map((metric) => [metric.id, metric.version]));

export function isConfirmedMetric(metricId: string, version = '1.0.0'): boolean {
  return CONFIRMED_BY_ID.get(metricId) === version;
}

/**
 * Cards de metrica do painel composto (metricas CONFIRMED de fato exibidas a partir
 * do snapshot executivo). Serie nao-KPI (ex.: distribuicao por status, tendencia,
 * SLA semanal) nao entra como metrica inventada - sao visualizacoes de dimensao.
 */
export const COMPOSITE_METRIC_CARDS: ReadonlyArray<DashboardCardRef> = [
  {
    metricId: 'service_orders.overdue_count',
    metricVersion: '1.0.0',
    visualization: 'Attention',
    filters: ['filter=overdue'],
    drill: 'certified-count',
    href: frontendDrillHrefForMetric('service_orders.overdue_count'),
  },
  {
    metricId: 'service_orders.approaching_due_count',
    metricVersion: '1.0.0',
    visualization: 'Attention',
    filters: ['filter=approaching-due'],
    drill: 'browse',
    href: frontendDrillHrefForMetric('service_orders.approaching_due_count'),
  },
  {
    metricId: 'receivables.overdue_count',
    metricVersion: '1.0.0',
    visualization: 'Bar',
    filters: [],
    drill: 'browse',
    href: frontendDrillHrefForMetric('receivables.overdue_count'),
  },
  {
    metricId: 'receivables.overdue_amount',
    metricVersion: '1.0.0',
    visualization: 'Table',
    filters: [],
    drill: null,
    href: null,
  },
  {
    metricId: 'productivity.completed_count',
    metricVersion: '1.0.0',
    visualization: 'Kpi',
    filters: [],
    drill: null,
    href: null,
  },
  {
    metricId: 'productivity.on_time_rate',
    metricVersion: '1.0.0',
    visualization: 'Kpi',
    filters: [],
    drill: null,
    href: null,
  },
  {
    metricId: 'productivity.avg_cycle_hours',
    metricVersion: '1.0.0',
    visualization: 'Kpi',
    filters: [],
    drill: null,
    href: null,
  },
  {
    metricId: 'productivity.rework_rate',
    metricVersion: '1.0.0',
    visualization: 'Kpi',
    filters: [],
    drill: null,
    href: null,
  },
];

export const CONFIRMED_METRICS_RENDERED = COMPOSITE_METRIC_CARDS.length;

/** Guard de render: metrica fora do catalogo CONFIRMED nunca vira card valido. */
export function assertRenderableCard(card: DashboardCardRef): void {
  if (!isConfirmedMetric(card.metricId, card.metricVersion)) {
    throw new Error(`COMPOSITE_DASHBOARD_BLOCKED_OR_UNKNOWN_METRIC ${card.metricId}@${card.metricVersion}`);
  }
  if (card.drill === 'certified-count' && card.metricId !== 'service_orders.overdue_count') {
    throw new Error(`COMPOSITE_DASHBOARD_UNPROVEN_DRILL_EQUALITY ${card.metricId}`);
  }
}

/**
 * FILTER + DRILL CONTRACT (BI CISNE) — FDC-001
 *
 * Contrato unico de drill-down entre BI, dashboard, reports e listas operacionais.
 * EVOLVE sobre contratos certificados existentes:
 *   - deadline/overdue      -> so.deadline_for(uuid) kernel (service-orders/domain/deadline-semantics.ts)
 *   - filtros de reports    -> REPORT-FILTER-001 (reports/domain/report-type.ts)
 *   - filtros derivados de lista de OS ('overdue'/'approaching-due') ja interpretados
 *     pela listagem com a MESMA semantica canonica.
 *
 * SEMANTICA UNICA: o mesmo filtro significa a mesma coisa em Analytics, Dashboard,
 * Report e Lista. 'overdue' NUNCA e literal de status: e filtro derivado resolvido
 * pelo kernel (deadline <= NOW, status nao-terminal). URLs nunca sao boundary de
 * seguranca: a lista de destino revalida capability/scope/unit/filtros.
 *
 * Metrica drillable -> route -> query contract. DRILL COUNT MISMATCHES = 0 vale para
 * metricas com equality comprovada (COUNT_EQUALITY_PROVEN); BROWSE_ONLY marca destino
 * de navegacao sem paridade de contagem garantida (documentado, nao prometido).
 */

export type DrillEqualityStatus =
  | 'COUNT_EQUALITY_PROVEN'
  | 'DERIVED_SAME_KERNEL_NOT_TESTED'
  | 'BROWSE_ONLY_NO_COUNT_EQUALITY';

export type DrillDestination = {
  /** Id de atencao/metrica logica no dashboard. */
  attentionId: string;
  /** Metrica canonica do Semantic Catalog (SMC-001) quando existir. */
  metricId: string;
  route: string;
  /** Filtro derivado interpretado pela lista de destino (semantica canonica). */
  filterParam: string;
  capability: string;
  /** Semantica canonica usada pelo filtro derivado (fonte unica, sem copiar SQL). */
  semantics: string;
  equality: DrillEqualityStatus;
};

export const DRILL_DESTINATIONS: readonly DrillDestination[] = [
  {
    attentionId: 'overdue-service-orders',
    metricId: 'service_orders.overdue_count',
    route: '/app/service-orders',
    filterParam: 'overdue',
    capability: 'service-orders:service-order:list',
    semantics: 'deadline-kernel: so.deadline_for <= NOW() e status nao-terminal',
    equality: 'COUNT_EQUALITY_PROVEN',
  },
  {
    attentionId: 'approaching-due-service-orders',
    metricId: 'service_orders.approaching_due_count',
    route: '/app/service-orders',
    filterParam: 'approaching-due',
    capability: 'service-orders:service-order:list',
    semantics: 'deadline-kernel: deadline > NOW() e <= NOW() + AGING_APPROACHING_DUE_DAYS, nao-terminal',
    equality: 'DERIVED_SAME_KERNEL_NOT_TESTED',
  },
  {
    attentionId: 'overdue-receivables',
    metricId: 'receivables.overdue_count',
    route: '/app/billing',
    filterParam: 'overdue',
    capability: 'billing:billing-record:read',
    semantics: 'FIN-SEM-001 (saldo residual vencido) - destino de navegacao',
    equality: 'BROWSE_ONLY_NO_COUNT_EQUALITY',
  },
];

export function drillDestinationByAttentionId(attentionId: string): DrillDestination | undefined {
  return DRILL_DESTINATIONS.find((destination) => destination.attentionId === attentionId);
}

export function drillDestinationByMetricId(metricId: string): DrillDestination | undefined {
  return DRILL_DESTINATIONS.find((destination) => destination.metricId === metricId);
}

/** Helper unico de construcao de URL de drill (substitui hrefs manuais). */
export function buildDrillHref(destination: DrillDestination): string {
  return `${destination.route}?filter=${destination.filterParam}`;
}

export function drillHrefForMetric(metricId: string): string | null {
  const destination = drillDestinationByMetricId(metricId);
  return destination ? buildDrillHref(destination) : null;
}

/** Metricas com paridade de contagem comprovada (BI agregado == populacao da lista filtrada). */
export const DRILLABLE_METRICS_WITH_PROVEN_EQUALITY: readonly string[] = DRILL_DESTINATIONS.filter(
  (destination) => destination.equality === 'COUNT_EQUALITY_PROVEN',
).map((destination) => destination.metricId);

/** Lembrete de seguranca: URL/filtro nunca e boundary; lista de destino revalida. */
export const DRILL_AUTHORIZATION_NOTE =
  'URL filters are never an authorization boundary: the destination list revalidates capability, scope, unit and filters server-side.';

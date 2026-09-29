/**
 * FILTER + DRILL CONTRACT (frontend) — espelho do FDC-001 (backend).
 *
 * O frontend NAO interpreta regra empresarial: apenas resolve o destino de drill
 * (rota + filtro derivado) a partir do registro unico. A autorizacao e revalidada
 * pela lista de destino (capability/scope/unit/filtros) no backend; URL nunca e
 * boundary de seguranca.
 *
 * As rotas de OS sao o resultado do builder canonico service-order-list-params com
 * o unico parametro derivado `filter` (SERVICE_ORDER_LIST_FILTERS.Overdue = 'overdue'
 * e ApproachingDue = 'approaching-due'); o backend interpreta esses valores com o
 * kernel de deadline (mesma semantica em BI, dashboard, report e lista).
 */

export type FrontendDrillDestination = {
  attentionId: string;
  metricId: string;
  /** Builder canônico; null quando o destino usa rota simples. */
  route: string;
};

function serviceOrdersListHref(filter: 'overdue' | 'approaching-due'): string {
  return `/app/service-orders?filter=${filter}`;
}

const FRONTEND_DRILL_DESTINATIONS: readonly FrontendDrillDestination[] = [
  {
    attentionId: 'overdue-service-orders',
    metricId: 'service_orders.overdue_count',
    route: serviceOrdersListHref('overdue'),
  },
  {
    attentionId: 'approaching-due-service-orders',
    metricId: 'service_orders.approaching_due_count',
    route: serviceOrdersListHref('approaching-due'),
  },
  /**
   * A listagem de destino interpreta `status=OVERDUE` literalmente (repositorio de
   * titulos traduz o status de dominio para os predicados reais de `lifecycle`,
   * saldo remanescente e vencimento). O valor enumerado e o MESMO alfabeto das
   * visoes de sistema da tela e passa pelo gate `isPersistableValue` do smart list.
   *
   * Ate esta wave o front mandava `/app/billing?filter=overdue`: a tela de
   * faturamento NAO interpreta `filter`, entao o operador chegava na fila de
   * trabalho sem recorte — um destino que prometia recorte e nao entregava.
   */
  {
    attentionId: 'overdue-receivables',
    metricId: 'receivables.overdue_count',
    route: '/app/finance/receivables?status=OVERDUE',
  },
];

export function frontendDrillHrefForMetric(metricId: string): string | null {
  return FRONTEND_DRILL_DESTINATIONS.find((destination) => destination.metricId === metricId)?.route ?? null;
}

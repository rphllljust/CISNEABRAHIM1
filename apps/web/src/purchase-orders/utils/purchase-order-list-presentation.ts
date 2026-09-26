import {
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderStatus,
} from '../types/purchase-order.types';

/**
 * Leitura de produto da maquina de estados do pedido de compra.
 *
 * Nao cria estado nem transicao: nomeia o passo que o backend JA permite a partir do
 * status atual. As transicoes espelham o que `PurchaseOrderDetailPage` ja executa
 * (`registerPurchaseOrder` / `cancelPurchaseOrder`); nada e recalculado no frontend.
 */
const NEXT_ACTION_BY_STATUS: Record<PurchaseOrderStatus, string> = {
  [PURCHASE_ORDER_STATUSES.Draft]: 'Revisar e registrar',
  [PURCHASE_ORDER_STATUSES.Registered]: 'Acompanhar consumo',
  [PURCHASE_ORDER_STATUSES.Cancelled]: 'Consultar histórico',
};

export function purchaseOrderNextAction(status: PurchaseOrderStatus): string {
  return NEXT_ACTION_BY_STATUS[status] ?? 'Abrir pedido';
}

/**
 * Excecao operacional derivada apenas de campos que o backend JA entrega na listagem
 * (`status`, `registeredAt`, `cancelledAt`). Quando o dado nao existe, devolve `null`
 * e a celula nao renderiza excecao — a UI nunca inventa pendencia.
 */
export function purchaseOrderNotice(order: {
  status: PurchaseOrderStatus;
  registeredAt: string | null;
  cancelledAt: string | null;
}): string | null {
  if (order.status === PURCHASE_ORDER_STATUSES.Cancelled) {
    return order.cancelledAt ? 'Cancelado' : 'Cancelado sem data registrada';
  }
  if (order.status === PURCHASE_ORDER_STATUSES.Draft && !order.registeredAt) {
    return 'Ainda não registrado';
  }
  return null;
}

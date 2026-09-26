/**
 * Semantica autoritativa de "referencia ainda vigente" de um pedido de compra.
 *
 * Fonte unica: quem precisa saber se uma solicitacao ou OS ainda conta como referencia ATIVA
 * usa estes predicados. Antes viviam soltos dentro de `hasBlockingReferences`; a cadeia
 * relacionada passou a precisar do MESMO criterio, e duplicar a string criaria duas verdades.
 */
export const ACTIVE_PURCHASE_ORDER_SERVICE_REQUEST_STATUSES = `status NOT IN ('CANCELLED', 'REJECTED')`;

export const ACTIVE_PURCHASE_ORDER_SERVICE_ORDER_STATUSES = `status <> 'CANCELLED'`;

/** Solicitacao de compra vinculada ao pedido que ainda conta como referencia ativa. */
export function activeServiceRequestPredicate(column = 'status'): string {
  return `${column} NOT IN ('CANCELLED', 'REJECTED')`;
}

/** Ordem de servico vinculada ao pedido que ainda conta como referencia ativa. */
export function activeServiceOrderPredicate(column = 'status'): string {
  return `${column} <> 'CANCELLED'`;
}

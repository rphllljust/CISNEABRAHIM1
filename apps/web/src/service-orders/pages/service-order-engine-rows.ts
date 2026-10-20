import type { ServiceOrderDetail } from '../types/service-order.types';
import type { ServiceOrderSummary } from '../api/service-orders-api';

/**
 * Linha de ordem de serviço no formato que a engine consome.
 *
 * A engine trabalha com `Record<string, unknown> & { id }` indexado por NOME DE CAMPO do
 * metadata store (`order_number`, `internal_code`, `row_version`, …), enquanto o DTO da API
 * usa camelCase. Cede o adaptador — o mesmo padrão já usado em fornecedores — para que a
 * diferença de nomenclatura fique em UM arquivo visível, e não espalhada dentro da engine.
 */
export type ServiceOrderEngineRow = Record<string, unknown> & { id: string };

function clientSnapshotText(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot) {
    return null;
  }
  const name = snapshot['legalName'] ?? snapshot['name'] ?? snapshot['tradeName'];
  return typeof name === 'string' && name.trim() !== '' ? name : null;
}

/**
 * Campos da LISTAGEM que antes ficavam vazios por engano.
 *
 * O endpoint de listagem devolve `ServiceOrderListResponse = ServiceOrderResponse & {...}`, e
 * `ServiceOrderResponse` JÁ traz `origin` e `createdAt` — confirmado no payload real de produção
 * (`origin: "PROPOSAL"`, `createdAt: "2026-10-19T16:01:34.417Z"`). A coluna "Origem" mostrava "—"
 * e "Criada em" mostrava "—" porque o tipo do cliente omitia os dois campos e o adaptador os
 * sobrescrevia com `null`, não porque o backend não os tivesse.
 *
 * `origin` é dado persistido (`so.service_orders.origin`), nunca rótulo derivado. `created_at`
 * agora recebe o `createdAt` REAL: antes era anulado para não rotular `updatedAt` como criação —
 * mas anular deixou a coluna vazia quando o dado sempre esteve disponível.
 */
export function serviceOrderEngineRows(items: ServiceOrderSummary[]): ServiceOrderEngineRow[] {
  return items.map((item) => ({
    id: item.id,
    order_number: item.orderNumber,
    /*
     * `internal_code` é o CÓDIGO INTERNO da OS (`SO-INT-2026-…`), publicado pela listagem.
     * Antes recebia `item.id` — o UUID — e a coluna "Código interno" mostrava
     * `163016a3-fef5-4cca-9a76-6170…` truncado num slot de 134px: identificador técnico
     * apresentado como código de negócio, transbordando e sem valor para o operador.
     */
    internal_code: item.internalCode,
    status: item.status,
    unit_id: item.unitId,
    origin: item.origin,
    description: item.description,
    priority: null,
    row_version: item.rowVersion,
    created_at: item.createdAt,
    deadline_at: item.deadlineAt,
    updated_at: item.updatedAt,
    contract_reference: null,
    client_snapshot: clientSnapshotText(item.clientSnapshot),
    client_id: item.clientId,
    assigned_workforce_name: item.assignedWorkforceMember?.displayName ?? null,
    assigned_workforce_code: item.assignedWorkforceMember?.memberCode ?? null,
  }));
}

/** Linha única — usada pelo detalhe, que devolve o registro completo. */
export function serviceOrderEngineRow(item: ServiceOrderDetail): ServiceOrderEngineRow {
  return {
    id: item.id,
    order_number: item.orderNumber,
    internal_code: item.internalCode,
    status: item.status,
    unit_id: item.unitId,
    origin: item.origin,
    description: item.description,
    priority: null,
    row_version: item.rowVersion,
    created_at: item.createdAt ?? null,
    contract_reference: item.contractReference ?? null,
    client_snapshot: clientSnapshotText(item.clientSnapshot),
    /*
     * VÍNCULOS DE ORIGEM — os identificadores que o DETALHE devolve e a cadeia de negócio
     * precisa para afirmar de onde esta OS veio.
     *
     * Só entram quando o payload os traz (`?? null`): um vínculo ausente não vira degrau, porque
     * a cadeia não inventa relação. Os rótulos humanos saem dos SNAPSHOTS que já vieram junto —
     * `proposalNumber`, `poNumber` — e nunca do UUID cru.
     */
    service_request_id: item.serviceRequestId ?? null,
    proposal_id: item.proposalId ?? null,
    proposal_number: proposalSnapshotText(item.proposalSnapshot, 'proposalNumber'),
    purchase_order_id: item.purchaseOrderId ?? null,
    purchase_order_number: purchaseOrderSnapshotText(item.purchaseOrderSnapshot),
    prepared_at: item.preparedAt ?? null,
    released_at: item.releasedAt ?? null,
    started_at: item.startedAt ?? null,
    completed_at: item.completedAt ?? null,
    cancelled_at: item.cancelledAt ?? null,
  };
}

/** Referência humana da proposta, quando o snapshot a trouxe. */
function proposalSnapshotText(
  snapshot: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = snapshot?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Referência humana do pedido de compra — `poNumber` com `rcNumber` como reserva. */
function purchaseOrderSnapshotText(
  snapshot: Record<string, unknown> | null | undefined,
): string | null {
  if (!snapshot) {
    return null;
  }
  for (const key of ['poNumber', 'rcNumber']) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return null;
}

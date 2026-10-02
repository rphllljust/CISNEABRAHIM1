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
 * Campos que a LISTAGEM não devolve.
 *
 * `ServiceOrderSummary` não carrega `origin` nem `contractReference`; a lista só recebe o que
 * o endpoint de listagem projeta. Preencher com `null` é a verdade — inventar rótulo a partir
 * de outro campo faria a coluna mentir.
 */
export function serviceOrderEngineRows(items: ServiceOrderSummary[]): ServiceOrderEngineRow[] {
  return items.map((item) => ({
    id: item.id,
    order_number: item.orderNumber,
    internal_code: item.id,
    status: item.status,
    unit_id: item.unitId,
    origin: null,
    description: item.description,
    priority: null,
    row_version: item.rowVersion,
    /*
     * `created_at` FICA NULO na listagem, e isso é deliberado.
     *
     * `ServiceOrderSummary` NÃO devolve `createdAt` — só `updatedAt` e `deadlineAt`. Rotular
     * `updatedAt` como `created_at` fazia a coluna "Criada em" exibir a data da última
     * alteração, e o aging (derivado dela) mentir sobre a idade do registro. Preencher com um
     * valor de outro campo é pior que deixar vazio: a coluna some e o aging cai para
     * `deadlineAt`, que é o eixo temporal REAL desta entidade.
     */
    created_at: null,
    deadline_at: item.deadlineAt,
    updated_at: item.updatedAt,
    contract_reference: null,
    client_snapshot: clientSnapshotText(item.clientSnapshot),
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

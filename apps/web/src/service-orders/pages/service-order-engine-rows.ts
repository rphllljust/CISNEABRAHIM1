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
    created_at: item.updatedAt,
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
  };
}

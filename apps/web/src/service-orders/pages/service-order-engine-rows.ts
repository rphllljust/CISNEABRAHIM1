import { listColumns } from '../../engine/DynamicExportCsv';
import type { MetaEntitySchema } from '../../engine/types';
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

export function serviceOrderEngineRows(items: ServiceOrderSummary[]): ServiceOrderEngineRow[] {
  return items.map((item) => ({
    id: item.id,
    order_number: item.orderNumber,
    internal_code: item.internalCode ?? null,
    status: item.status,
    unit_id: item.unitId,
    origin: item.origin ?? null,
    description: item.description,
    priority: null,
    row_version: item.rowVersion,
    created_at: item.createdAt ?? null,
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

/** Cliente é uma coluna de negócio, nunca o slot de responsável da engine. */
export function serviceOrderWorklistSchema(schema: MetaEntitySchema | null): MetaEntitySchema | null {
  if (!schema) return null;
  const client = schema.fields.find((field) => field.name === 'client_snapshot');
  if (!client || !schema.allowedPermLevels.includes(client.permLevel)) return schema;
  const columns = listColumns(schema).map((field) => field.name);
  if (!columns.includes(client.name)) columns.splice(1, 0, client.name);
  return {
    ...schema,
    fields: schema.fields.map((field) => field === client ? { ...field, inList: true } : field),
    views: schema.views.map((view) => {
      if (view.viewType === 'list') return { ...view, layout: { ...view.layout, columns } };
      if (view.viewType !== 'kanban') return view;
      const cardFields = view.layout.cardFields ?? [schema.labelField];
      return { ...view, layout: { ...view.layout, cardFields: [...new Set([...cardFields, client.name])] } };
    }),
  };
}

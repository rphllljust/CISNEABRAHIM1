import {
  toHistoryEventResponse as toSharedHistoryEventResponse,
  type HistoryEventResponse,
} from '../../infrastructure/http/contracts';
import type { ServiceOrderHistoryEventRow, ServiceOrderRow } from '../repositories/service-orders.repository.types';

export type ServiceOrderResponse = {
  id: string;
  internalCode: string;
  orderNumber: string;
  unitId: string;
  status: string;
  origin: string;
  clientId: string | null;
  clientSnapshot: Record<string, unknown> | null;
  serviceDefinitionId: string | null;
  serviceDefinitionVersionId: string | null;
  serviceSnapshot: Record<string, unknown>;
  description: string | null;
  location: Record<string, unknown>;
  priority: string | null;
  operationalNotes: string | null;
  serviceRequestId: string | null;
  proposalId: string | null;
  proposalSnapshot: Record<string, unknown> | null;
  purchaseOrderId: string | null;
  purchaseOrderSnapshot: Record<string, unknown> | null;
  rcNumber: string | null;
  contractReference: string | null;
  contractSnapshot: Record<string, unknown> | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  preparedAt: string | null;
  releasedAt: string | null;
  cancelledAt: string | null;
  cancelledByIdentityId: string | null;
  cancellationReason: string | null;
  reopenedAt: string | null;
  reopenedByIdentityId: string | null;
  reopenReason: string | null;
  createdByIdentityId: string;
  releasedByIdentityId: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
};

export type ServiceOrderHistoryEventResponse = HistoryEventResponse;

export type AssignedWorkforceMemberResponse = {
  id: string;
  memberCode: string;
  displayName: string;
};

/**
 * Item de listagem operacional: acrescenta a projecao de despacho
 * (responsavel atribuido e prazo derivado pelo kernel). O detalhe permanece
 * com o contrato anterior.
 */
export type ServiceOrderListResponse = ServiceOrderResponse & {
  assignedWorkforceMember: AssignedWorkforceMemberResponse | null;
  deadlineAt: string | null;
};

export type ServiceOrderDetailResponse = ServiceOrderResponse & {
  historyEvents: ServiceOrderHistoryEventResponse[];
};

export function toServiceOrderResponse(row: ServiceOrderRow): ServiceOrderResponse {
  return {
    id: row.id,
    internalCode: row.internal_code,
    orderNumber: row.order_number,
    unitId: row.unit_id,
    status: row.status,
    origin: row.origin,
    clientId: row.client_id,
    clientSnapshot: row.client_snapshot,
    serviceDefinitionId: row.service_definition_id,
    serviceDefinitionVersionId: row.service_definition_version_id,
    serviceSnapshot: row.service_snapshot,
    description: row.description,
    location: row.location,
    priority: row.priority,
    operationalNotes: row.operational_notes,
    serviceRequestId: row.service_request_id,
    proposalId: row.proposal_id,
    proposalSnapshot: row.proposal_snapshot,
    purchaseOrderId: row.purchase_order_id,
    purchaseOrderSnapshot: row.purchase_order_snapshot,
    rcNumber: row.rc_number,
    contractReference: row.contract_reference,
    contractSnapshot: row.contract_snapshot,
    rowVersion: row.row_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preparedAt: row.prepared_at,
    releasedAt: row.released_at,
    cancelledAt: row.cancelled_at,
    cancelledByIdentityId: row.cancelled_by_identity_id,
    cancellationReason: row.cancellation_reason,
    reopenedAt: row.reopened_at,
    reopenedByIdentityId: row.reopened_by_identity_id,
    reopenReason: row.reopen_reason,
    createdByIdentityId: row.created_by_identity_id,
    releasedByIdentityId: row.released_by_identity_id,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    completedAt: row.completed_at,
  };
}

export function toServiceOrderHistoryEventResponse(
  row: ServiceOrderHistoryEventRow,
): ServiceOrderHistoryEventResponse {
  return toSharedHistoryEventResponse(row);
}

function toAssignedWorkforceMemberResponse(
  row: ServiceOrderRow,
): AssignedWorkforceMemberResponse | null {
  const id = row.assigned_workforce_member_id;
  const memberCode = row.assigned_workforce_member_code;
  const displayName = row.assigned_workforce_member_name;
  if (!id || !memberCode || !displayName) {
    return null;
  }
  return { id, memberCode, displayName };
}

export function toServiceOrderListResponse(row: ServiceOrderRow): ServiceOrderListResponse {
  return {
    ...toServiceOrderResponse(row),
    assignedWorkforceMember: toAssignedWorkforceMemberResponse(row),
    deadlineAt: row.deadline_at ?? null,
  };
}

export function toServiceOrderDetailResponse(
  row: ServiceOrderRow,
  historyEvents: ServiceOrderHistoryEventRow[],
): ServiceOrderDetailResponse {
  return {
    ...toServiceOrderResponse(row),
    historyEvents: historyEvents.map(toServiceOrderHistoryEventResponse),
  };
}

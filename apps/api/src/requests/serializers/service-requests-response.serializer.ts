import {
  toDocumentLinkResponse as toSharedDocumentLinkResponse,
  type DocumentLinkResponse,
} from '../../infrastructure/http/contracts';
import {
  toHistoryEventResponse,
  type HistoryEventResponse,
} from '../../infrastructure/http/contracts';
import type {
  ServiceRequestDocumentLinkRow,
  ServiceRequestHistoryEventRow,
  ServiceRequestLinkedRow,
  ServiceRequestRow,
} from '../repositories/service-requests.repository.types';
import type { ServiceRequestNextStepCode } from '../domain/service-request-readiness';
import type { ServiceRequestTransition } from '../domain/service-request';

export type ServiceRequestDocumentLinkResponse = DocumentLinkResponse;

export type ServiceRequestResponse = {
  id: string;
  requestCode: string;
  unitId: string;
  status: string;
  originSource: string;
  externalContact: Record<string, unknown>;
  externalOriginReference: string | null;
  clientId: string | null;
  serviceDefinitionId: string | null;
  serviceDefinitionVersionId: string | null;
  description: string | null;
  location: Record<string, unknown>;
  desiredStartAt: string | null;
  desiredEndAt: string | null;
  priority: string | null;
  operationalNotes: string | null;
  proposalId: string | null;
  purchaseOrderId: string | null;
  submittedAt: string | null;
  reviewStartedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  convertedAt: string | null;
  convertedServiceOrderId: string | null;
  rowVersion: number;
  createdByIdentityId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Item da fila operacional.
 *
 * Acrescenta ao agregado apenas rotulos humanos JA AUTORIZADOS pelo modulo dono. `clientName` e
 * `serviceLabel` ficam nulos quando o ator nao pode ler o cliente ou o catalogo — nesse caso a UI
 * omite o dado em vez de cair para o UUID tecnico.
 */
export type ServiceRequestListItemResponse = ServiceRequestResponse & {
  clientName: string | null;
  serviceLabel: string | null;
};

export type ServiceRequestLinkedResponse = {
  kind: string;
  id: string;
  label: string;
  status: string | null;
  occurredAt: string;
};

export type ServiceRequestReadinessResponse = {
  nextStep: ServiceRequestNextStepCode;
  nextStepTransition: ServiceRequestTransition | null;
  availableTransitions: ServiceRequestTransition[];
  blockers: string[];
};

export type ServiceRequestRelatedResponse = {
  client: { id: string; name: string } | null;
  service: { id: string; label: string } | null;
};

export type ServiceRequestDetailResponse = {
  serviceRequest: ServiceRequestResponse;
  documentLinks: ServiceRequestDocumentLinkResponse[];
  historyEvents: HistoryEventResponse[];
  related: ServiceRequestRelatedResponse;
  linkedChain: ServiceRequestLinkedResponse[];
  readiness: ServiceRequestReadinessResponse;
};

export type ServiceRequestEnrichment = {
  clientName: string | null;
  serviceLabel: string | null;
};

function toDocumentLinkResponse(row: ServiceRequestDocumentLinkRow): ServiceRequestDocumentLinkResponse {
  return toSharedDocumentLinkResponse(row);
}

export function toServiceRequestResponse(row: ServiceRequestRow): ServiceRequestResponse {
  return {
    id: row.id,
    requestCode: row.request_code,
    unitId: row.unit_id,
    status: row.status,
    originSource: row.origin_source,
    externalContact: row.external_contact,
    externalOriginReference: row.external_origin_reference,
    clientId: row.client_id,
    serviceDefinitionId: row.service_definition_id,
    serviceDefinitionVersionId: row.service_definition_version_id,
    description: row.description,
    location: row.location,
    desiredStartAt: row.desired_start_at,
    desiredEndAt: row.desired_end_at,
    priority: row.priority,
    operationalNotes: row.operational_notes,
    proposalId: row.proposal_id,
    purchaseOrderId: row.purchase_order_id,
    submittedAt: row.submitted_at,
    reviewStartedAt: row.review_started_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    convertedAt: row.converted_at,
    convertedServiceOrderId: row.converted_service_order_id,
    rowVersion: row.row_version,
    createdByIdentityId: row.created_by_identity_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toServiceRequestListItemResponse(
  row: ServiceRequestRow,
  enrichment: ServiceRequestEnrichment,
): ServiceRequestListItemResponse {
  return {
    ...toServiceRequestResponse(row),
    clientName: enrichment.clientName,
    serviceLabel: enrichment.serviceLabel,
  };
}

export function toServiceRequestLinkedResponse(row: ServiceRequestLinkedRow): ServiceRequestLinkedResponse {
  return {
    kind: row.kind,
    id: row.id,
    label: row.label,
    status: row.status,
    occurredAt: row.occurred_at,
  };
}

export function toServiceRequestDetailResponse(
  row: ServiceRequestRow,
  documentLinks: ServiceRequestDocumentLinkRow[],
  historyEvents: ServiceRequestHistoryEventRow[] = [],
  extras: {
    enrichment?: ServiceRequestEnrichment;
    linkedChain?: ServiceRequestLinkedRow[];
    readiness?: ServiceRequestReadinessResponse;
  } = {},
): ServiceRequestDetailResponse {
  const enrichment = extras.enrichment ?? { clientName: null, serviceLabel: null };
  return {
    serviceRequest: toServiceRequestResponse(row),
    documentLinks: documentLinks.map(toDocumentLinkResponse),
    historyEvents: historyEvents.map((event) =>
      toHistoryEventResponse({
        id: event.id,
        event_type: event.event_type,
        payload: event.payload,
        actor_identity_id: event.actor_identity_id,
        occurred_at: event.occurred_at,
      }),
    ),
    related: {
      client:
        row.client_id && enrichment.clientName
          ? { id: row.client_id, name: enrichment.clientName }
          : null,
      service:
        row.service_definition_id && enrichment.serviceLabel
          ? { id: row.service_definition_id, label: enrichment.serviceLabel }
          : null,
    },
    linkedChain: (extras.linkedChain ?? []).map(toServiceRequestLinkedResponse),
    readiness:
      extras.readiness ?? {
        nextStep: 'CLOSED',
        nextStepTransition: null,
        availableTransitions: [],
        blockers: [],
      },
  };
}

export const SERVICE_REQUEST_STATUSES = {
  Draft: 'DRAFT',
  Submitted: 'SUBMITTED',
  UnderReview: 'UNDER_REVIEW',
  Approved: 'APPROVED',
  Rejected: 'REJECTED',
  Cancelled: 'CANCELLED',
  Converted: 'CONVERTED',
} as const;

export type ServiceRequestStatus =
  (typeof SERVICE_REQUEST_STATUSES)[keyof typeof SERVICE_REQUEST_STATUSES];

export const SERVICE_REQUEST_ORIGINS = {
  Whatsapp: 'WHATSAPP',
  Phone: 'PHONE',
  Email: 'EMAIL',
  PurchaseOrder: 'PURCHASE_ORDER',
  Contract: 'CONTRACT',
  ProposalAcceptance: 'PROPOSAL_ACCEPTANCE',
  DirectRequest: 'DIRECT_REQUEST',
  Other: 'OTHER',
} as const;

export type ServiceRequestOrigin =
  (typeof SERVICE_REQUEST_ORIGINS)[keyof typeof SERVICE_REQUEST_ORIGINS];

export const SERVICE_REQUEST_PRIORITIES = {
  Low: 'LOW',
  Normal: 'NORMAL',
  High: 'HIGH',
  Urgent: 'URGENT',
} as const;

export type ServiceRequestPriority =
  (typeof SERVICE_REQUEST_PRIORITIES)[keyof typeof SERVICE_REQUEST_PRIORITIES];

export const REQUEST_ERROR_CODES = {
  VALIDATION_FAILED: 'REQUESTS_VALIDATION_FAILED',
  DENIED: 'REQUESTS_DENIED',
  NOT_FOUND: 'REQUESTS_SERVICE_REQUEST_NOT_FOUND',
  INVALID_STATE: 'REQUESTS_SERVICE_REQUEST_INVALID_STATE',
  VERSION_CONFLICT: 'REQUESTS_SERVICE_REQUEST_VERSION_CONFLICT',
  CLIENT_NOT_FOUND: 'REQUESTS_CLIENT_NOT_FOUND',
  CLIENT_INACTIVE: 'REQUESTS_CLIENT_INACTIVE',
  UNIT_NOT_REGISTERED: 'REQUESTS_UNIT_NOT_REGISTERED',
  SERVICE_NOT_FOUND: 'REQUESTS_SERVICE_NOT_FOUND',
  DOCUMENT_NOT_FOUND: 'REQUESTS_DOCUMENT_NOT_FOUND',
  PROPOSAL_NOT_FOUND: 'REQUESTS_PROPOSAL_NOT_FOUND',
  PURCHASE_ORDER_NOT_FOUND: 'REQUESTS_PURCHASE_ORDER_NOT_FOUND',
  CONVERSION_NOT_READY: 'REQUESTS_CONVERSION_NOT_READY',
  CONVERSION_NOT_ALLOWED: 'REQUESTS_CONVERSION_NOT_ALLOWED',
  DUPLICATE_IDEMPOTENCY: 'REQUESTS_DUPLICATE_IDEMPOTENCY',
} as const;

export type RequestErrorCode = (typeof REQUEST_ERROR_CODES)[keyof typeof REQUEST_ERROR_CODES];

export type ServiceRequestExternalContact = {
  name?: string;
  email?: string;
  phone?: string;
};

export type ServiceRequestLocation = {
  label?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
};

export type ServiceRequest = {
  id: string;
  requestCode: string;
  unitId: string;
  status: ServiceRequestStatus;
  originSource: ServiceRequestOrigin;
  externalContact: ServiceRequestExternalContact;
  externalOriginReference: string | null;
  clientId: string | null;
  serviceDefinitionId: string | null;
  serviceDefinitionVersionId: string | null;
  description: string | null;
  location: ServiceRequestLocation;
  desiredStartAt: string | null;
  desiredEndAt: string | null;
  priority: ServiceRequestPriority | null;
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

export type ServiceRequestDocumentLink = {
  id: string;
  documentId: string;
  linkPurpose: string;
  createdAt: string;
};

export type ServiceRequestHistoryEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  actorIdentityId: string | null;
  occurredAt: string;
};

/** Passo do ciclo derivado do estado real (nenhuma regra nova: espelha a maquina de estados). */
export type ServiceRequestNextStepCode =
  | 'SUBMIT_REQUEST'
  | 'START_REVIEW'
  | 'DECIDE'
  | 'CONVERT_TO_SERVICE_ORDER'
  | 'OPEN_SERVICE_ORDER'
  | 'CLOSED';

export type ServiceRequestTransition =
  | 'submit'
  | 'startReview'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'convert';

export type ServiceRequestReadiness = {
  nextStep: ServiceRequestNextStepCode;
  nextStepTransition: ServiceRequestTransition | null;
  availableTransitions: ServiceRequestTransition[];
  blockers: string[];
};

export type ServiceRequestLinkedKind = 'PROPOSAL' | 'PURCHASE_ORDER' | 'SERVICE_ORDER';

export type ServiceRequestLinked = {
  kind: ServiceRequestLinkedKind;
  id: string;
  label: string;
  status: string | null;
  occurredAt: string;
};

export type ServiceRequestRelated = {
  client: { id: string; name: string } | null;
  service: { id: string; label: string } | null;
};

export type ServiceRequestDetail = {
  serviceRequest: ServiceRequest;
  documentLinks: ServiceRequestDocumentLink[];
  historyEvents: ServiceRequestHistoryEvent[];
  related: ServiceRequestRelated;
  linkedChain: ServiceRequestLinked[];
  readiness: ServiceRequestReadiness;
};

/**
 * Item da fila operacional. `clientName`/`serviceLabel` vem nulos quando o ator nao tem leitura do
 * modulo dono — a UI omite o dado em vez de exibir UUID tecnico.
 */
export type ServiceRequestListItem = ServiceRequest & {
  clientName: string | null;
  serviceLabel: string | null;
};

export type ServiceRequestListResponse = {
  items: ServiceRequestListItem[];
  limit: number;
  offset: number;
};

export const SERVICE_REQUEST_LIST_SORTS = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  priority: 'priority',
  desiredStartAt: 'desiredStartAt',
} as const;

export type ServiceRequestListSort =
  (typeof SERVICE_REQUEST_LIST_SORTS)[keyof typeof SERVICE_REQUEST_LIST_SORTS];

export type ServiceRequestListDirection = 'asc' | 'desc';

export type ServiceRequestListSummary = {
  total: number;
  pending: number;
  underReview: number;
  converted: number;
  cancelled: number;
};

export type CreateServiceRequestPayload = {
  unitId: string;
  originSource: ServiceRequestOrigin;
  externalContact?: ServiceRequestExternalContact;
  externalOriginReference?: string;
  clientId?: string;
  description?: string;
  location?: ServiceRequestLocation;
  desiredStartAt?: string;
  desiredEndAt?: string;
  operationalNotes?: string;
  serviceDefinitionId?: string;
  serviceDefinitionVersionId?: string;
  proposalId?: string;
  purchaseOrderId?: string;
  idempotencyKey?: string;
};

export type UpdateServiceRequestDraftPayload = {
  rowVersion: number;
  originSource?: ServiceRequestOrigin;
  externalContact?: ServiceRequestExternalContact;
  externalOriginReference?: string | null;
  clientId?: string | null;
  description?: string | null;
  location?: ServiceRequestLocation;
  desiredStartAt?: string | null;
  desiredEndAt?: string | null;
  operationalNotes?: string | null;
  serviceDefinitionId?: string | null;
  serviceDefinitionVersionId?: string | null;
  proposalId?: string | null;
  purchaseOrderId?: string | null;
};

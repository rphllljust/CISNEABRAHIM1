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

export type ServiceRequestDetail = {
  serviceRequest: ServiceRequest;
  documentLinks: ServiceRequestDocumentLink[];
  historyEvents: ServiceRequestHistoryEvent[];
};

export type ServiceRequestListResponse = {
  items: ServiceRequest[];
  limit: number;
  offset: number;
};

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

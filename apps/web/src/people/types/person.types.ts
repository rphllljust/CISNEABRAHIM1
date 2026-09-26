export const PERSON_STATUSES = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;

export type PersonStatus = (typeof PERSON_STATUSES)[keyof typeof PERSON_STATUSES];

export const PERSON_ERROR_CODES = {
  VALIDATION_FAILED: 'PERSON_VALIDATION_FAILED',
  NOT_FOUND: 'PERSON_NOT_FOUND',
  EXTERNAL_ID_CONFLICT: 'PERSON_EXTERNAL_ID_CONFLICT',
  VERSION_CONFLICT: 'PERSON_VERSION_CONFLICT',
  INVALID_STATE: 'PERSON_INVALID_STATE',
  LABOR_TYPE_NOT_FOUND: 'PERSON_LABOR_TYPE_NOT_FOUND',
  DENIED: 'PERSON_DENIED',
} as const;

export type PersonErrorCode = (typeof PERSON_ERROR_CODES)[keyof typeof PERSON_ERROR_CODES];

export type Person = {
  id: string;
  memberCode: string;
  legalName: string;
  preferredName: string | null;
  defaultLaborTypeCode: string | null;
  defaultLaborTypeName: string | null;
  externalErpId: string | null;
  status: PersonStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  serviceOrderAllocationSupported: boolean;
};

export type PersonHistoryEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  actorIdentityId: string | null;
  occurredAt: string;
};

export type PersonListResponse = {
  items: Person[];
  limit: number;
  offset: number;
};

export type CreatePersonPayload = {
  legalName: string;
  preferredName?: string;
  defaultLaborTypeCode?: string;
  externalErpId?: string;
};

export type UpdatePersonPayload = {
  version: number;
  legalName?: string;
  preferredName?: string | null;
  defaultLaborTypeCode?: string | null;
  externalErpId?: string | null;
};

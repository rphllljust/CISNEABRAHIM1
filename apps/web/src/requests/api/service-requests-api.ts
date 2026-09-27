import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  REQUEST_ERROR_CODES,
  type CreateServiceRequestPayload,
  type RequestErrorCode,
  type ServiceRequestDetail,
  type ServiceRequestListDirection,
  type ServiceRequestListResponse,
  type ServiceRequestListSort,
  type ServiceRequestListSummary,
  type ServiceRequestOrigin,
  type ServiceRequestPriority,
  type ServiceRequestStatus,
  type UpdateServiceRequestDraftPayload,
} from '../types/service-request.types';

export type ServiceRequestApiErrorKind =
  | 'denied'
  | 'not_found'
  | 'validation'
  | 'version_conflict'
  | 'invalid_state'
  | 'network'
  | 'unknown';

export class ServiceRequestsApiError extends Error {
  readonly status: number;
  readonly code?: RequestErrorCode;
  readonly kind: ServiceRequestApiErrorKind;

  constructor(status: number, code: RequestErrorCode | undefined, kind: ServiceRequestApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

type RequestErrorBody = {
  code?: RequestErrorCode;
  message?: string;
};

const PROBE_SERVICE_REQUEST_ID = '00000000-0000-4000-8000-000000000002';

function classifyError(status: number, code: RequestErrorCode | undefined): ServiceRequestApiErrorKind {
  if (code === REQUEST_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (code === REQUEST_ERROR_CODES.NOT_FOUND || status === 404) {
    return 'not_found';
  }
  if (code === REQUEST_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === REQUEST_ERROR_CODES.INVALID_STATE) {
    return 'invalid_state';
  }
  if (code === REQUEST_ERROR_CODES.VALIDATION_FAILED || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<ServiceRequestsApiError> {
  let code: RequestErrorCode | undefined;
  try {
    const body = (await response.json()) as RequestErrorBody;
    code = body.code;
  } catch {
    // ignore parse errors
  }
  return new ServiceRequestsApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new ServiceRequestsApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, init);
    if (!response.ok) {
      throw await parseError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ServiceRequestsApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ServiceRequestsApiError(0, undefined, 'network');
    }
    throw new ServiceRequestsApiError(0, undefined, 'unknown');
  }
}

export type ListServiceRequestsParams = {
  limit: number;
  offset: number;
  status?: ServiceRequestStatus;
  clientId?: string;
  unitId?: string;
  priority?: ServiceRequestPriority;
  originSource?: ServiceRequestOrigin;
  desiredFrom?: string;
  desiredTo?: string;
  search?: string;
  sort?: ServiceRequestListSort;
  direction?: ServiceRequestListDirection;
};

export type ServiceRequestSummaryParams = {
  clientId?: string;
  unitId?: string;
};

export function buildServiceRequestSummaryQuery(params: ServiceRequestSummaryParams): string {
  const search = new URLSearchParams();
  if (params.clientId) {
    search.set('clientId', params.clientId);
  }
  if (params.unitId) {
    search.set('unitId', params.unitId);
  }
  return search.toString();
}

export function buildListServiceRequestsQuery(params: ListServiceRequestsParams): string {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit));
  search.set('offset', String(params.offset));
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.clientId) {
    search.set('clientId', params.clientId);
  }
  if (params.unitId) {
    search.set('unitId', params.unitId);
  }
  if (params.priority) {
    search.set('priority', params.priority);
  }
  if (params.originSource) {
    search.set('originSource', params.originSource);
  }
  if (params.desiredFrom) {
    search.set('desiredFrom', params.desiredFrom);
  }
  if (params.desiredTo) {
    search.set('desiredTo', params.desiredTo);
  }
  const searchTerm = params.search?.trim();
  if (searchTerm) {
    search.set('q', searchTerm);
  }
  if (params.sort) {
    search.set('sort', params.sort);
  }
  if (params.direction) {
    search.set('direction', params.direction);
  }
  return search.toString();
}

export async function listServiceRequests(
  params: ListServiceRequestsParams,
  signal?: AbortSignal,
): Promise<ServiceRequestListResponse> {
  const query = buildListServiceRequestsQuery(params);
  return requestJson<ServiceRequestListResponse>(`/api/v1/requests/service-requests?${query}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getServiceRequestSummary(
  params: ServiceRequestSummaryParams = {},
  signal?: AbortSignal,
): Promise<ServiceRequestListSummary> {
  const query = buildServiceRequestSummaryQuery(params);
  const suffix = query ? `?${query}` : '';
  return requestJson<ServiceRequestListSummary>(`/api/v1/requests/service-requests/summary${suffix}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function registerOperationalUnit(refId: string): Promise<{ items: string[] }> {
  return requestJson<{ items: string[] }>('/api/v1/requests/service-requests/operational-units', {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refId }),
  });
}

export async function listOperationalUnits(signal?: AbortSignal): Promise<{ items: string[] }> {
  return requestJson<{ items: string[] }>('/api/v1/requests/service-requests/operational-units', {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getServiceRequest(
  serviceRequestId: string,
  signal?: AbortSignal,
): Promise<ServiceRequestDetail> {
  return requestJson<ServiceRequestDetail>(`/api/v1/requests/service-requests/${serviceRequestId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createServiceRequest(
  payload: CreateServiceRequestPayload,
  signal?: AbortSignal,
): Promise<ServiceRequestDetail> {
  return requestJson<ServiceRequestDetail>('/api/v1/requests/service-requests', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function updateServiceRequestDraft(
  serviceRequestId: string,
  payload: UpdateServiceRequestDraftPayload,
  signal?: AbortSignal,
): Promise<ServiceRequestDetail> {
  return requestJson<ServiceRequestDetail>(`/api/v1/requests/service-requests/${serviceRequestId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

async function transitionServiceRequest(
  serviceRequestId: string,
  action: 'submit' | 'review' | 'approve' | 'reject' | 'cancel' | 'convert',
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ServiceRequestDetail> {
  return requestJson<ServiceRequestDetail>(
    `/api/v1/requests/service-requests/${serviceRequestId}/${action}`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  );
}

export function submitServiceRequest(
  serviceRequestId: string,
  rowVersion: number,
  signal?: AbortSignal,
): Promise<ServiceRequestDetail> {
  return transitionServiceRequest(serviceRequestId, 'submit', { rowVersion }, signal);
}

export function startServiceRequestReview(
  serviceRequestId: string,
  rowVersion: number,
  signal?: AbortSignal,
): Promise<ServiceRequestDetail> {
  return transitionServiceRequest(serviceRequestId, 'review', { rowVersion }, signal);
}

export function approveServiceRequest(
  serviceRequestId: string,
  rowVersion: number,
  priority?: ServiceRequestPriority,
  signal?: AbortSignal,
): Promise<ServiceRequestDetail> {
  return transitionServiceRequest(
    serviceRequestId,
    'approve',
    { rowVersion, ...(priority ? { priority } : {}) },
    signal,
  );
}

export function rejectServiceRequest(
  serviceRequestId: string,
  rowVersion: number,
  rejectionReason: string,
  signal?: AbortSignal,
): Promise<ServiceRequestDetail> {
  return transitionServiceRequest(
    serviceRequestId,
    'reject',
    { rowVersion, rejectionReason },
    signal,
  );
}

export function cancelServiceRequest(
  serviceRequestId: string,
  rowVersion: number,
  cancellationReason: string,
  signal?: AbortSignal,
): Promise<ServiceRequestDetail> {
  return transitionServiceRequest(
    serviceRequestId,
    'cancel',
    { rowVersion, cancellationReason },
    signal,
  );
}

export function convertServiceRequest(
  serviceRequestId: string,
  rowVersion: number,
  signal?: AbortSignal,
): Promise<ServiceRequestDetail> {
  return transitionServiceRequest(serviceRequestId, 'convert', { rowVersion }, signal);
}

export type ServiceRequestCapabilities = {
  canList: boolean;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
};

async function probeMutation(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<boolean> {
  try {
    await requestJson(path, {
      method,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return true;
  } catch (error) {
    if (error instanceof ServiceRequestsApiError) {
      if (error.kind === 'denied') {
        return false;
      }
      if (
        error.kind === 'not_found' ||
        error.kind === 'validation' ||
        error.kind === 'invalid_state' ||
        error.kind === 'version_conflict'
      ) {
        return true;
      }
    }
    return false;
  }
}

export async function probeServiceRequestCapabilities(
  signal?: AbortSignal,
): Promise<ServiceRequestCapabilities> {
  let canList = false;
  try {
    await listServiceRequests({ limit: 1, offset: 0 }, signal);
    canList = true;
  } catch (error) {
    if (error instanceof ServiceRequestsApiError && error.kind === 'denied') {
      canList = false;
    }
  }

  const probeId = PROBE_SERVICE_REQUEST_ID;
  const [
    canCreate,
    canRead,
    canUpdate,
    canSubmit,
    canReview,
    canApprove,
    canReject,
    canCancel,
  ] = await Promise.all([
    probeMutation('/api/v1/requests/service-requests', 'POST', {}),
    (async () => {
      try {
        await getServiceRequest(probeId, signal);
        return true;
      } catch (error) {
        if (error instanceof ServiceRequestsApiError) {
          return error.kind !== 'denied';
        }
        return false;
      }
    })(),
    probeMutation(`/api/v1/requests/service-requests/${probeId}`, 'PATCH', { rowVersion: 1 }),
    probeMutation(`/api/v1/requests/service-requests/${probeId}/submit`, 'POST', { rowVersion: 1 }),
    probeMutation(`/api/v1/requests/service-requests/${probeId}/review`, 'POST', { rowVersion: 1 }),
    probeMutation(`/api/v1/requests/service-requests/${probeId}/approve`, 'POST', { rowVersion: 1 }),
    probeMutation(`/api/v1/requests/service-requests/${probeId}/reject`, 'POST', {
      rowVersion: 1,
      rejectionReason: 'probe',
    }),
    probeMutation(`/api/v1/requests/service-requests/${probeId}/cancel`, 'POST', {
      rowVersion: 1,
      cancellationReason: 'probe',
    }),
  ]);

  return {
    canList,
    canCreate,
    canRead,
    canUpdate,
    canSubmit,
    canReview,
    canApprove,
    canReject,
    canCancel,
  };
}

export async function probeServiceRequestListAccess(signal?: AbortSignal): Promise<boolean> {
  try {
    await listServiceRequests({ limit: 1, offset: 0 }, signal);
    return true;
  } catch (error) {
    if (error instanceof ServiceRequestsApiError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.kind === 'denied') {
        return false;
      }
    }
    return false;
  }
}

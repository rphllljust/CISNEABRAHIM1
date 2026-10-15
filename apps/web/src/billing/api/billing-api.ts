import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  BILLING_ERROR_CODES,
  type BillingCapabilities,
  type BillingRecordDetail,
  type BillingWorklistResponse,
  type BillingErrorCode,
  type PrepareBillingRecordPayload,
  type VoidBillingRecordPayload,
} from '../types/billing.types';
import { ServiceOrdersApiError, type ServiceOrdersApiErrorKind } from '../../service-orders/api/service-orders-api';

const PROBE_SERVICE_ORDER_ID = '00000000-0000-4000-8000-000000000010';
const PROBE_BILLING_RECORD_ID = '00000000-0000-4000-8000-000000000030';

function classifyError(status: number, code: BillingErrorCode | undefined): ServiceOrdersApiErrorKind {
  if (code === BILLING_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (
    code === BILLING_ERROR_CODES.NOT_FOUND ||
    code === BILLING_ERROR_CODES.SERVICE_ORDER_NOT_FOUND ||
    code === BILLING_ERROR_CODES.MEASUREMENT_NOT_FOUND ||
    status === 404
  ) {
    return 'not_found';
  }
  if (code === BILLING_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === BILLING_ERROR_CODES.INVALID_STATE) {
    return 'invalid_state';
  }
  if (
    code === BILLING_ERROR_CODES.VALIDATION_FAILED ||
    code === BILLING_ERROR_CODES.BILLING_AMOUNT_MISMATCH ||
    code === BILLING_ERROR_CODES.COMMERCIAL_TERMS_MISMATCH ||
    status === 400 ||
    status === 409
  ) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<ServiceOrdersApiError> {
  let code: BillingErrorCode | undefined;
  try {
    const body = (await response.json()) as { code?: BillingErrorCode };
    code = body.code;
  } catch {
    // ignore
  }
  return new ServiceOrdersApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new ServiceOrdersApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

function jsonHeaders(): HeadersInit {
  return {
    ...authHeaders(),
    'Content-Type': 'application/json',
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
    if (error instanceof ServiceOrdersApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ServiceOrdersApiError(0, undefined, 'network');
    }
    throw new ServiceOrdersApiError(0, undefined, 'unknown');
  }
}

function billingPath(serviceOrderId: string, suffix = ''): string {
  return `/api/v1/service-orders/${serviceOrderId}/billing-records${suffix}`;
}

export async function listBillingWorklist(
  query: { bucket?: string; search?: string; limit?: number; offset?: number },
  signal?: AbortSignal,
): Promise<BillingWorklistResponse> {
  const params = new URLSearchParams();
  if (query.bucket) params.set('bucket', query.bucket);
  if (query.search?.trim()) params.set('q', query.search.trim());
  params.set('limit', String(query.limit ?? 20));
  params.set('offset', String(query.offset ?? 0));
  return requestJson<BillingWorklistResponse>(`/api/v1/billing/worklist?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getBillingRecord(
  serviceOrderId: string,
  signal?: AbortSignal,
): Promise<BillingRecordDetail | null> {
  return requestJson<BillingRecordDetail | null>(billingPath(serviceOrderId), {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getBillingRecordById(
  serviceOrderId: string,
  billingRecordId: string,
  signal?: AbortSignal,
): Promise<BillingRecordDetail> {
  return requestJson<BillingRecordDetail>(billingPath(serviceOrderId, `/${billingRecordId}`), {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function prepareBillingRecord(
  serviceOrderId: string,
  payload: PrepareBillingRecordPayload,
  signal?: AbortSignal,
): Promise<BillingRecordDetail> {
  return requestJson<BillingRecordDetail>(billingPath(serviceOrderId), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
    signal,
  });
}

export async function voidBillingRecord(
  serviceOrderId: string,
  billingRecordId: string,
  payload: VoidBillingRecordPayload,
  signal?: AbortSignal,
): Promise<BillingRecordDetail> {
  return requestJson<BillingRecordDetail>(billingPath(serviceOrderId, `/${billingRecordId}/void`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
    signal,
  });
}

async function probeMutation(
  path: string,
  method: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await requestJson(path, {
      method,
      headers: jsonHeaders(),
      body: JSON.stringify(body),
      signal,
    });
    return true;
  } catch (error) {
    if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
      return false;
    }
    return true;
  }
}

export async function probeBillingCapabilities(signal?: AbortSignal): Promise<BillingCapabilities> {
  const base = billingPath(PROBE_SERVICE_ORDER_ID);
  const [canPrepare, canVoid] = await Promise.all([
    probeMutation(
      base,
      'POST',
      {
        measurementId: '00000000-0000-4000-8000-000000000020',
        paymentTerms: '30 DDL',
      },
      signal,
    ),
    probeMutation(
      `${base}/${PROBE_BILLING_RECORD_ID}/void`,
      'POST',
      { rowVersion: 1 },
      signal,
    ),
  ]);

  let canRead = true;
  try {
    await requestJson(base, { method: 'GET', headers: authHeaders(), signal });
  } catch (error) {
    if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
      canRead = false;
    }
  }

  return { canRead, canPrepare, canVoid, canIssueDocument: false, canReadDocument: false, canDownloadDocument: false };
}

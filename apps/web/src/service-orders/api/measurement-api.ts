import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  MEASUREMENTS_ERROR_CODES,
  type AuthorizeAdjustmentPayload,
  type MeasurementCapabilities,
  type MeasurementDetail,
  type RejectMeasurementPayload,
  type RowVersionCommand,
  type UpdateMeasurementItemPayload,
  type MeasurementsErrorCode,
} from '../types/measurement.types';
import { ServiceOrdersApiError, type ServiceOrdersApiErrorKind } from './service-orders-api';

const PROBE_SERVICE_ORDER_ID = '00000000-0000-4000-8000-000000000010';
const PROBE_MEASUREMENT_ID = '00000000-0000-4000-8000-000000000020';

function classifyError(status: number, code: MeasurementsErrorCode | undefined): ServiceOrdersApiErrorKind {
  if (code === MEASUREMENTS_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (
    code === MEASUREMENTS_ERROR_CODES.NOT_FOUND ||
    code === MEASUREMENTS_ERROR_CODES.SERVICE_ORDER_NOT_FOUND ||
    code === MEASUREMENTS_ERROR_CODES.ITEM_NOT_FOUND ||
    status === 404
  ) {
    return 'not_found';
  }
  if (code === MEASUREMENTS_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === MEASUREMENTS_ERROR_CODES.INVALID_STATE || code === MEASUREMENTS_ERROR_CODES.NOT_EDITABLE) {
    return 'invalid_state';
  }
  if (code === MEASUREMENTS_ERROR_CODES.VALIDATION_FAILED || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<ServiceOrdersApiError> {
  let code: MeasurementsErrorCode | undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: MeasurementsErrorCode; message?: string };
      code?: MeasurementsErrorCode;
    };
    code = body.error?.code ?? body.code;
  } catch {
    // ignore
  }
  return new ServiceOrdersApiError(response.status, code, classifyError(response.status, code));
}

function jsonHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new ServiceOrdersApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
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

function measurementPath(serviceOrderId: string, suffix = ''): string {
  return `/api/v1/service-orders/${serviceOrderId}/measurements${suffix}`;
}

export async function getMeasurement(
  serviceOrderId: string,
  signal?: AbortSignal,
): Promise<MeasurementDetail | null> {
  return requestJson<MeasurementDetail | null>(measurementPath(serviceOrderId), {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getMeasurementById(
  serviceOrderId: string,
  measurementId: string,
  signal?: AbortSignal,
): Promise<MeasurementDetail> {
  return requestJson<MeasurementDetail>(measurementPath(serviceOrderId, `/${measurementId}`), {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createMeasurement(serviceOrderId: string): Promise<MeasurementDetail> {
  return requestJson<MeasurementDetail>(measurementPath(serviceOrderId), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({}),
  });
}

export async function regenerateMeasurement(
  serviceOrderId: string,
  measurementId: string,
  body: RowVersionCommand,
): Promise<MeasurementDetail> {
  return requestJson<MeasurementDetail>(measurementPath(serviceOrderId, `/${measurementId}/regenerate`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function updateMeasurementItem(
  serviceOrderId: string,
  measurementId: string,
  itemId: string,
  body: UpdateMeasurementItemPayload,
): Promise<MeasurementDetail> {
  return requestJson<MeasurementDetail>(
    measurementPath(serviceOrderId, `/${measurementId}/items/${itemId}`),
    {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    },
  );
}

export async function authorizeMeasurementAdjustment(
  serviceOrderId: string,
  measurementId: string,
  body: AuthorizeAdjustmentPayload,
): Promise<MeasurementDetail> {
  return requestJson<MeasurementDetail>(measurementPath(serviceOrderId, `/${measurementId}/adjustments`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function submitMeasurement(
  serviceOrderId: string,
  measurementId: string,
  body: RowVersionCommand,
): Promise<MeasurementDetail> {
  return requestJson<MeasurementDetail>(measurementPath(serviceOrderId, `/${measurementId}/submit`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function startMeasurementReview(
  serviceOrderId: string,
  measurementId: string,
  body: RowVersionCommand,
): Promise<MeasurementDetail> {
  return requestJson<MeasurementDetail>(measurementPath(serviceOrderId, `/${measurementId}/start-review`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function approveMeasurement(
  serviceOrderId: string,
  measurementId: string,
  body: RowVersionCommand,
): Promise<MeasurementDetail> {
  return requestJson<MeasurementDetail>(measurementPath(serviceOrderId, `/${measurementId}/approve`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function rejectMeasurement(
  serviceOrderId: string,
  measurementId: string,
  body: RejectMeasurementPayload,
): Promise<MeasurementDetail> {
  return requestJson<MeasurementDetail>(measurementPath(serviceOrderId, `/${measurementId}/reject`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function resubmitMeasurement(
  serviceOrderId: string,
  measurementId: string,
  body: RowVersionCommand,
): Promise<MeasurementDetail> {
  return requestJson<MeasurementDetail>(measurementPath(serviceOrderId, `/${measurementId}/resubmit`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
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

export async function probeMeasurementCapabilities(
  signal?: AbortSignal,
): Promise<MeasurementCapabilities> {
  const base = `/api/v1/service-orders/${PROBE_SERVICE_ORDER_ID}/measurements`;
  const mid = PROBE_MEASUREMENT_ID;
  const [canCreate, canUpdate, canSubmit, canReview, canApprove, canReject] = await Promise.all([
    probeMutation(base, 'POST', {}, signal),
    probeMutation(`${base}/${mid}/regenerate`, 'POST', { rowVersion: 1 }, signal),
    probeMutation(`${base}/${mid}/submit`, 'POST', { rowVersion: 1 }, signal),
    probeMutation(`${base}/${mid}/start-review`, 'POST', { rowVersion: 1 }, signal),
    probeMutation(`${base}/${mid}/approve`, 'POST', { rowVersion: 1 }, signal),
    probeMutation(`${base}/${mid}/reject`, 'POST', { rowVersion: 1, rejectionReason: 'probe' }, signal),
  ]);

  let canRead = true;
  try {
    await requestJson(`${base}`, { method: 'GET', headers: authHeaders(), signal });
  } catch (error) {
    if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
      canRead = false;
    }
  }

  return { canRead, canCreate, canUpdate, canSubmit, canReview, canApprove, canReject };
}

import { fetchWithSession } from '../../auth/api/session-recovery';
import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  SERVICE_ORDERS_ERROR_CODES,
  type ServiceOrderDetail,
  type ServiceOrdersErrorCode,
} from '../types/service-order.types';
import type {
  ExecutionBundle,
  RecordEvidencePayload,
  RecordMeasuredValuePayload,
  RecordObservationPayload,
  RecordOccurrencePayload,
  RecordQuantityPayload,
  RowVersionCommand,
} from '../types/service-order-execution.types';
import { ServiceOrdersApiError, type ServiceOrdersApiErrorKind } from './service-orders-api';

export { ServiceOrdersApiError };

function classifyError(status: number, code: ServiceOrdersErrorCode | undefined): ServiceOrdersApiErrorKind {
  if (code === SERVICE_ORDERS_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (code === SERVICE_ORDERS_ERROR_CODES.NOT_FOUND || status === 404) {
    return 'not_found';
  }
  if (code === SERVICE_ORDERS_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === SERVICE_ORDERS_ERROR_CODES.INVALID_STATE) {
    return 'invalid_state';
  }
  if (code === SERVICE_ORDERS_ERROR_CODES.VALIDATION_FAILED || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<ServiceOrdersApiError> {
  let code: ServiceOrdersErrorCode | undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: ServiceOrdersErrorCode; message?: string };
      code?: ServiceOrdersErrorCode;
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

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  try {
    const response = await fetchWithSession(`${getApiBaseUrl()}${path}`, init);
    if (!response.ok) {
      throw await parseError(response);
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

function executionPath(serviceOrderId: string, suffix = ''): string {
  return `/api/v1/service-orders/${serviceOrderId}/execution${suffix}`;
}

export async function getExecutionBundle(
  serviceOrderId: string,
  signal?: AbortSignal,
): Promise<ExecutionBundle> {
  return requestJson<ExecutionBundle>(executionPath(serviceOrderId), {
    method: 'GET',
    headers: jsonHeaders(),
    signal,
  });
}

export async function startExecution(
  serviceOrderId: string,
  body: RowVersionCommand,
): Promise<ServiceOrderDetail> {
  return requestJson<ServiceOrderDetail>(executionPath(serviceOrderId, '/start'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function pauseExecution(
  serviceOrderId: string,
  body: RowVersionCommand,
): Promise<ServiceOrderDetail> {
  return requestJson<ServiceOrderDetail>(executionPath(serviceOrderId, '/pause'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function resumeExecution(
  serviceOrderId: string,
  body: RowVersionCommand,
): Promise<ServiceOrderDetail> {
  return requestJson<ServiceOrderDetail>(executionPath(serviceOrderId, '/resume'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function completeExecution(
  serviceOrderId: string,
  body: RowVersionCommand,
): Promise<ServiceOrderDetail> {
  return requestJson<ServiceOrderDetail>(executionPath(serviceOrderId, '/complete'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function recordQuantity(
  serviceOrderId: string,
  body: RecordQuantityPayload,
): Promise<{ entry: unknown; rowVersion: number | null }> {
  return requestJson(executionPath(serviceOrderId, '/entries/quantity'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function recordMileage(
  serviceOrderId: string,
  body: RecordMeasuredValuePayload,
): Promise<{ entry: unknown; rowVersion: number | null }> {
  return requestJson(executionPath(serviceOrderId, '/entries/mileage'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function recordHourMeter(
  serviceOrderId: string,
  body: RecordMeasuredValuePayload,
): Promise<{ entry: unknown; rowVersion: number | null }> {
  return requestJson(executionPath(serviceOrderId, '/entries/hour-meter'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function recordObservation(
  serviceOrderId: string,
  body: RecordObservationPayload,
): Promise<{ entry: unknown; rowVersion: number | null }> {
  return requestJson(executionPath(serviceOrderId, '/entries/observation'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function recordOccurrence(
  serviceOrderId: string,
  body: RecordOccurrencePayload,
): Promise<{ occurrence: unknown; rowVersion: number | null }> {
  return requestJson(executionPath(serviceOrderId, '/occurrences'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export async function recordEvidence(
  serviceOrderId: string,
  body: RecordEvidencePayload,
): Promise<{ evidence: unknown; rowVersion: number | null }> {
  return requestJson(executionPath(serviceOrderId, '/evidence'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

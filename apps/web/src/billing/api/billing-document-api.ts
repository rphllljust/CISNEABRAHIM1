import { fetchWithSession } from '../../auth/api/session-recovery';
import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  BILLING_ERROR_CODES,
  type BillingDocumentDetail,
  type IssueBillingDocumentPayload,
} from '../types/billing.types';
import { ServiceOrdersApiError, type ServiceOrdersApiErrorKind } from '../../service-orders/api/service-orders-api';

const PROBE_SERVICE_ORDER_ID = '00000000-0000-4000-8000-000000000010';
const PROBE_BILLING_RECORD_ID = '00000000-0000-4000-8000-000000000030';
const PROBE_BILLING_DOCUMENT_ID = '00000000-0000-4000-8000-000000000040';

function classifyError(status: number, code: string | undefined): ServiceOrdersApiErrorKind {
  if (code === BILLING_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (
    code === BILLING_ERROR_CODES.NOT_FOUND ||
    code === BILLING_ERROR_CODES.BILLING_DOCUMENT_NOT_FOUND ||
    status === 404
  ) {
    return 'not_found';
  }
  if (code === BILLING_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === BILLING_ERROR_CODES.INVALID_STATE || code === BILLING_ERROR_CODES.BILLING_DOCUMENT_INVALID_STATE) {
    return 'invalid_state';
  }
  if (
    code === BILLING_ERROR_CODES.VALIDATION_FAILED ||
    code === BILLING_ERROR_CODES.BILLING_DOCUMENT_ALREADY_EXISTS ||
    code === BILLING_ERROR_CODES.BILLING_DOCUMENT_IMMUTABLE ||
    status === 400 ||
    status === 409
  ) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<ServiceOrdersApiError> {
  let code: string | undefined;
  try {
    const body = (await response.json()) as { code?: string };
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
    const response = await fetchWithSession(`${getApiBaseUrl()}${path}`, init);
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

function documentsPath(serviceOrderId: string, billingRecordId: string, suffix = ''): string {
  return `/api/v1/service-orders/${serviceOrderId}/billing-records/${billingRecordId}/documents${suffix}`;
}

export async function listBillingDocuments(
  serviceOrderId: string,
  billingRecordId: string,
  signal?: AbortSignal,
): Promise<BillingDocumentDetail[]> {
  return requestJson<BillingDocumentDetail[]>(documentsPath(serviceOrderId, billingRecordId), {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getBillingDocument(
  serviceOrderId: string,
  billingRecordId: string,
  billingDocumentId: string,
  signal?: AbortSignal,
): Promise<BillingDocumentDetail> {
  return requestJson<BillingDocumentDetail>(
    documentsPath(serviceOrderId, billingRecordId, `/${billingDocumentId}`),
    {
      method: 'GET',
      headers: authHeaders(),
      signal,
    },
  );
}

export async function issueBillingDocument(
  serviceOrderId: string,
  billingRecordId: string,
  payload: IssueBillingDocumentPayload,
  signal?: AbortSignal,
): Promise<BillingDocumentDetail> {
  return requestJson<BillingDocumentDetail>(documentsPath(serviceOrderId, billingRecordId), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
    signal,
  });
}

export async function downloadBillingDocumentPdf(
  serviceOrderId: string,
  billingRecordId: string,
  billingDocumentId: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; sha256: string | null; filename: string }> {
  try {
    const response = await fetchWithSession(
      `${getApiBaseUrl()}${documentsPath(serviceOrderId, billingRecordId, `/${billingDocumentId}/pdf`)}`,
      {
        method: 'GET',
        headers: authHeaders(),
        signal,
      },
    );
    if (!response.ok) {
      throw await parseError(response);
    }
    const blob = await response.blob();
    const sha256 = response.headers.get('X-Content-Sha256');
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    return {
      blob,
      sha256,
      filename: filenameMatch?.[1] ?? `nota-fatura-${billingDocumentId}.pdf`,
    };
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

export async function probeBillingDocumentCapabilities(signal?: AbortSignal): Promise<{
  canIssueDocument: boolean;
  canReadDocument: boolean;
  canDownloadDocument: boolean;
}> {
  const base = documentsPath(PROBE_SERVICE_ORDER_ID, PROBE_BILLING_RECORD_ID);
  const [canIssueDocument, canDownloadDocument] = await Promise.all([
    probeMutation(base, 'POST', {}, signal),
    (async () => {
      try {
        const response = await fetchWithSession(
          `${getApiBaseUrl()}${documentsPath(PROBE_SERVICE_ORDER_ID, PROBE_BILLING_RECORD_ID, `/${PROBE_BILLING_DOCUMENT_ID}/pdf`)}`,
          { method: 'GET', headers: authHeaders(), signal },
        );
        if (response.status === 403) {
          return false;
        }
        return true;
      } catch {
        return true;
      }
    })(),
  ]);

  let canReadDocument = true;
  try {
    await requestJson(base, { method: 'GET', headers: authHeaders(), signal });
  } catch (error) {
    if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
      canReadDocument = false;
    }
  }

  return { canIssueDocument, canReadDocument, canDownloadDocument };
}

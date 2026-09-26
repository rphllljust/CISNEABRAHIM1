import { getApiBaseUrl, isNetworkError } from '../auth/api/auth-api';
import { tokenStore } from '../auth/storage/token-store';

export type BackofficeApiErrorKind =
  | 'denied'
  | 'not_found'
  | 'validation'
  | 'version_conflict'
  | 'closed_period'
  | 'processing'
  | 'network'
  | 'unknown';

export class BackofficeApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly kind: BackofficeApiErrorKind;

  constructor(status: number, code: string | undefined, kind: BackofficeApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

type ErrorBody = {
  code?: string;
  error?: {
    code?: string;
  };
};

const CLOSED_PERIOD_CODES = new Set([
  'ACCOUNTING_PERIOD_CLOSED',
  'ACCOUNTING_PERIOD_HAS_DRAFTS',
  'ACCOUNTING_PERIOD_CLOSE_BLOCKED',
  'ACCOUNTING_UNBALANCED_TRIAL_BALANCE',
]);

const VERSION_CONFLICT_CODES = new Set([
  'FINANCE_VERSION_CONFLICT',
  'ACCOUNTING_VERSION_CONFLICT',
  'FISCAL_VERSION_CONFLICT',
  'PROCUREMENT_VERSION_CONFLICT',
  'SUPPLIER_VERSION_CONFLICT',
  'COLLECTION_VERSION_CONFLICT',
]);

const DENIED_CODES = new Set([
  'FINANCE_DENIED',
  'ACCOUNTING_DENIED',
  'FISCAL_DENIED',
  'PROCUREMENT_DENIED',
  'SUPPLIER_DENIED',
  'INVENTORY_DENIED',
  'PAYROLL_DENIED',
]);

export function classifyBackofficeError(
  status: number,
  code: string | undefined,
): BackofficeApiErrorKind {
  if (code && DENIED_CODES.has(code) || status === 403 || status === 401) {
    return 'denied';
  }
  if (
    code === 'FINANCE_RECEIVABLE_OVERPAYMENT' ||
    code === 'FINANCE_PAYABLE_OVERPAYMENT' ||
    code === 'FINANCE_INVALID_SETTLEMENT_AMOUNT' ||
    code === 'FINANCE_INVALID_PAYMENT_AMOUNT'
  ) {
    return 'validation';
  }
  if (code && VERSION_CONFLICT_CODES.has(code) || status === 409) {
    return code && CLOSED_PERIOD_CODES.has(code) ? 'closed_period' : 'version_conflict';
  }
  if (code && CLOSED_PERIOD_CODES.has(code)) {
    return 'closed_period';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 202 || status === 423) {
    return 'processing';
  }
  if (status === 400 || status === 422) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<BackofficeApiError> {
  let code: string | undefined;
  try {
    const body = (await response.json()) as ErrorBody;
    code = body.error?.code ?? body.code;
  } catch {
    // ignore parse errors
  }
  return new BackofficeApiError(response.status, code, classifyBackofficeError(response.status, code));
}

export function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new BackofficeApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

export function jsonHeaders(): HeadersInit {
  return {
    ...authHeaders(),
    'Content-Type': 'application/json',
  };
}

export async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
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
    if (error instanceof BackofficeApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new BackofficeApiError(0, undefined, 'network');
    }
    throw new BackofficeApiError(0, undefined, 'unknown');
  }
}

export async function probeReadAccess(path: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await requestJson<unknown>(path, { method: 'GET', headers: authHeaders(), signal });
    return true;
  } catch (error) {
    if (error instanceof BackofficeApiError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.kind === 'denied') {
        return false;
      }
      if (error.kind === 'not_found') {
        return true;
      }
    }
    return false;
  }
}

export const BACKOFFICE_PROBE_ID = '00000000-0000-4000-8000-000000000099';

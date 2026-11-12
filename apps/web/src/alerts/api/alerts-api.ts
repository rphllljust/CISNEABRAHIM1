import { fetchWithSession } from '../../auth/api/session-recovery';
import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  ALERT_ERROR_CODES,
  AlertApiError,
  type AlertErrorCode,
  type AlertListFilters,
  type BusinessAlertListItem,
  type BusinessAlertSummary,
} from '../types/alerts.types';

export { AlertApiError } from '../types/alerts.types';

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new AlertApiError(401, undefined, 'denied');
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

function buildQuery(filters: AlertListFilters): string {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.type) {
    params.set('type', filters.type);
  }
  if (filters.severity) {
    params.set('severity', filters.severity);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function parseError(response: Response): Promise<AlertApiError> {
  let code: AlertErrorCode | undefined;
  try {
    const body = (await response.json()) as { code?: AlertErrorCode };
    code = body.code;
  } catch {
    // ignore
  }
  const kind =
    code === ALERT_ERROR_CODES.ACCESS_DENIED || response.status === 403 ? 'denied' : 'unknown';
  return new AlertApiError(response.status, code, kind);
}

export async function getAlerts(
  filters: AlertListFilters,
  signal?: AbortSignal,
): Promise<BusinessAlertListItem[]> {
  try {
    const response = await fetchWithSession(`${getApiBaseUrl()}/api/v1/alerts${buildQuery(filters)}`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as BusinessAlertListItem[];
  } catch (error) {
    if (error instanceof AlertApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new AlertApiError(0, undefined, 'network');
    }
    throw error;
  }
}

export async function getAlertSummary(signal?: AbortSignal): Promise<BusinessAlertSummary> {
  try {
    const response = await fetchWithSession(`${getApiBaseUrl()}/api/v1/alerts/summary`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as BusinessAlertSummary;
  } catch (error) {
    if (error instanceof AlertApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new AlertApiError(0, undefined, 'network');
    }
    throw error;
  }
}

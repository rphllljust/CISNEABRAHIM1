import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  DASHBOARD_ERROR_CODES,
  DashboardApiError,
  type DashboardErrorCode,
  type ExecutiveDashboardFilters,
  type ExecutiveDashboardSnapshot,
} from '../types/dashboard.types';

export { DashboardApiError } from '../types/dashboard.types';

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new DashboardApiError(401, undefined, 'denied');
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

function classifyError(status: number, code?: DashboardErrorCode): DashboardApiError['kind'] {
  if (code === DASHBOARD_ERROR_CODES.ACCESS_DENIED || status === 403) {
    return 'denied';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<DashboardApiError> {
  let code: DashboardErrorCode | undefined;
  try {
    const body = (await response.json()) as { code?: DashboardErrorCode };
    code = body.code;
  } catch {
    // ignore
  }
  return new DashboardApiError(response.status, code, classifyError(response.status, code));
}

function buildExecutiveQuery(filters: ExecutiveDashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.period) {
    params.set('period', filters.period);
  }
  if (filters.unitId) {
    params.set('unitId', filters.unitId);
  }
  if (filters.from) {
    params.set('from', filters.from);
  }
  if (filters.to) {
    params.set('to', filters.to);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function getExecutiveDashboard(
  filters: ExecutiveDashboardFilters,
  signal?: AbortSignal,
): Promise<ExecutiveDashboardSnapshot> {
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/dashboard/executive${buildExecutiveQuery(filters)}`,
      {
        method: 'GET',
        headers: authHeaders(),
        signal,
      },
    );
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as ExecutiveDashboardSnapshot;
  } catch (error) {
    if (error instanceof DashboardApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new DashboardApiError(0, undefined, 'network');
    }
    throw error;
  }
}


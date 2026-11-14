import { fetchWithSession } from '../../auth/api/session-recovery';
import { getApiBaseUrl } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';

export type SupersetDashboardKey =
  | 'service-orders'
  | 'fleet-assets'
  | 'contracts-measurements'
  | 'finance-treasury'
  | 'operational-costs'
  | 'transport-rentals'
  | 'team-productivity'
  | 'executive';

export type EmbeddedBiCatalog = {
  items: Array<{ key: SupersetDashboardKey; label: string }>;
};

export type EmbeddedBiTicket = {
  token: string;
  dashboardId: string;
  supersetDomain: string;
};

export class EmbeddedBiError extends Error {
  constructor(readonly status: number) {
    super(status === 403 ? 'denied' : status === 401 ? 'session_expired' : 'unavailable');
    this.name = 'EmbeddedBiError';
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) throw new EmbeddedBiError(401);
  let response: Response;
  try {
    response = await fetchWithSession(getApiBaseUrl() + path, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + accessToken,
        ...init.headers,
      },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new EmbeddedBiError(0);
  }
  if (!response.ok) throw new EmbeddedBiError(response.status);
  try {
    return await response.json() as T;
  } catch {
    throw new EmbeddedBiError(502);
  }
}

export function getEmbeddedBiCatalog(unitId: string, signal?: AbortSignal) {
  return request<EmbeddedBiCatalog>(
    '/api/v1/analytics/embedded/catalog?unitId=' + encodeURIComponent(unitId),
    { method: 'GET', signal },
  );
}

export function issueEmbeddedBiTicket(
  unitId: string,
  dashboardKey: SupersetDashboardKey,
  signal?: AbortSignal,
) {
  return request<EmbeddedBiTicket>('/api/v1/analytics/embedded/guest-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unitId, dashboardKey }),
    signal,
  });
}

import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';

export type EnterpriseOperationalUnit = {
  id: string;
  code: string;
  name: string;
  version: number;
  canManage?: boolean;
};

export type UnitGovernanceDirectory = {
  items: Array<EnterpriseOperationalUnit & { canManage: boolean }>;
  canCreate: boolean;
  unconfigured?: string[];
};

export class UnitGovernanceError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function authHeaders(): HeadersInit {
  const token = tokenStore.getAccessToken();
  if (!token) throw new UnitGovernanceError(401, 'UNIT_DENIED');
  return { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, init);
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { code?: string; error?: { code?: string } };
      throw new UnitGovernanceError(response.status, error.error?.code ?? error.code ?? 'UNIT_REQUEST_FAILED');
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof UnitGovernanceError) throw error;
    if (isNetworkError(error)) throw new UnitGovernanceError(0, 'NETWORK');
    throw new UnitGovernanceError(0, 'UNKNOWN');
  }
}

export function listGovernedUnits(signal?: AbortSignal): Promise<UnitGovernanceDirectory> {
  return request('/api/v1/organization/operational-units', {
    method: 'GET', headers: authHeaders(), signal,
  });
}

export function createGovernedUnit(input: {
  code: string; name: string; idempotencyKey: string; refId?: string;
}): Promise<EnterpriseOperationalUnit> {
  return request('/api/v1/organization/operational-units', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
}

export function updateGovernedUnit(id: string, input: {
  code: string; name: string; expectedVersion: number; idempotencyKey: string;
}): Promise<EnterpriseOperationalUnit> {
  return request(`/api/v1/organization/operational-units/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify(input),
  });
}

/** Read-only append-only master history; no UUID is required in the operator surface. */
export type UnitGovernanceHistory = {
  unit: EnterpriseOperationalUnit;
  events: Array<{
    version: number;
    action: 'CREATED' | 'UPDATED';
    actorIdentityId: string;
    occurredAt: string;
  }>;
};

export function readGovernedUnitHistory(id: string, signal?: AbortSignal): Promise<UnitGovernanceHistory> {
  return request(`/api/v1/organization/operational-units/${encodeURIComponent(id)}/history`, {
    method: 'GET', headers: authHeaders(), signal,
  });
}

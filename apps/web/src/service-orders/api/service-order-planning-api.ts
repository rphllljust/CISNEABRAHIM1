import { fetchWithSession } from '../../auth/api/session-recovery';
import { ServiceOrdersApiError } from './service-orders-api';
import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import type {
  AllocateResourcePayload,
  PlanResourcePayload,
  PlannedResource,
  ResourceAllocation,
  ResourceAllocationDetail,
} from '../types/resource-planning.types';
import {
  SERVICE_ORDERS_ERROR_CODES,
  type ServiceOrdersErrorCode,
} from '../types/service-order.types';

export { ServiceOrdersApiError };

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new ServiceOrdersApiError(401, undefined, 'denied');
  }
  try {
    const response = await fetchWithSession(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
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
      const kind =
        code === SERVICE_ORDERS_ERROR_CODES.ALLOCATION_CONFLICT
          ? 'allocation_conflict'
          : code === SERVICE_ORDERS_ERROR_CODES.DENIED || response.status === 403
            ? 'denied'
            : code === SERVICE_ORDERS_ERROR_CODES.NOT_FOUND || response.status === 404
              ? 'not_found'
              : code === SERVICE_ORDERS_ERROR_CODES.VERSION_CONFLICT
                ? 'version_conflict'
                : 'unknown';
      throw new ServiceOrdersApiError(response.status, code, kind);
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

function jsonHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

export async function listPlannedResources(
  serviceOrderId: string,
  signal?: AbortSignal,
): Promise<PlannedResource[]> {
  return requestJson<PlannedResource[]>(`/api/v1/service-orders/${serviceOrderId}/planned-resources`, {
    method: 'GET',
    signal,
  });
}

export async function planResource(
  serviceOrderId: string,
  payload: PlanResourcePayload,
  signal?: AbortSignal,
): Promise<PlannedResource> {
  return requestJson<PlannedResource>(`/api/v1/service-orders/${serviceOrderId}/planned-resources`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
    signal,
  });
}

export async function updatePlannedResource(
  serviceOrderId: string,
  plannedResourceId: string,
  payload: { rowVersion: number; plannedQuantity?: string },
  signal?: AbortSignal,
): Promise<PlannedResource> {
  return requestJson<PlannedResource>(
    `/api/v1/service-orders/${serviceOrderId}/planned-resources/${plannedResourceId}`,
    {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export async function removePlannedResource(
  serviceOrderId: string,
  plannedResourceId: string,
  rowVersion: number,
  signal?: AbortSignal,
): Promise<PlannedResource> {
  return requestJson<PlannedResource>(
    `/api/v1/service-orders/${serviceOrderId}/planned-resources/${plannedResourceId}/remove`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ rowVersion }),
      signal,
    },
  );
}

export async function listAllocations(
  serviceOrderId: string,
  signal?: AbortSignal,
): Promise<ResourceAllocation[]> {
  return requestJson<ResourceAllocation[]>(`/api/v1/service-orders/${serviceOrderId}/allocations`, {
    method: 'GET',
    signal,
  });
}

export async function allocateResource(
  serviceOrderId: string,
  payload: AllocateResourcePayload,
  signal?: AbortSignal,
): Promise<ResourceAllocationDetail> {
  return requestJson<ResourceAllocationDetail>(`/api/v1/service-orders/${serviceOrderId}/allocations`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
    signal,
  });
}

export async function removeAllocation(
  serviceOrderId: string,
  allocationId: string,
  rowVersion: number,
  signal?: AbortSignal,
): Promise<ResourceAllocationDetail> {
  return requestJson<ResourceAllocationDetail>(
    `/api/v1/service-orders/${serviceOrderId}/allocations/${allocationId}/remove`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ rowVersion }),
      signal,
    },
  );
}

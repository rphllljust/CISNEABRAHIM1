import { getApiBaseUrl, isNetworkError } from '../auth/api/auth-api';
import { tokenStore } from '../auth/storage/token-store';
import type { MetaEntitySchema, MetaEntitySummary, MetaField, MetaView, MetaWorkflow } from './types';

/**
 * Cliente da API de metadados.
 *
 * Sem estado e sem cache: o cache vive no `MetadataProvider`, que é quem conhece o ciclo de
 * vida da tela. Manter cache aqui faria duas camadas discordarem sobre o que está fresco.
 */

export class MetaApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`META_API_ERROR_${status}`);
    this.status = status;
  }
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new MetaApiError(401);
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw new MetaApiError(response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof MetaApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new MetaApiError(0);
    }
    throw new MetaApiError(0);
  }
}

export function fetchEntityList(signal?: AbortSignal): Promise<MetaEntitySummary[]> {
  return requestJson<MetaEntitySummary[]>('/api/v1/meta', signal);
}

export function fetchEntitySchema(entity: string, signal?: AbortSignal): Promise<MetaEntitySchema> {
  return requestJson<MetaEntitySchema>(`/api/v1/meta/${entity}`, signal);
}

export function fetchEntityFields(entity: string, signal?: AbortSignal): Promise<MetaField[]> {
  return requestJson<MetaField[]>(`/api/v1/meta/${entity}/fields`, signal);
}

export function fetchEntityView(
  entity: string,
  viewType: string,
  signal?: AbortSignal,
): Promise<MetaView | null> {
  return requestJson<MetaView | null>(`/api/v1/meta/${entity}/views/${viewType}`, signal);
}

export function fetchEntityWorkflow(
  entity: string,
  signal?: AbortSignal,
): Promise<MetaWorkflow | null> {
  return requestJson<MetaWorkflow | null>(`/api/v1/meta/${entity}/workflow`, signal);
}

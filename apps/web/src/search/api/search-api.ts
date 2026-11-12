import { fetchWithSession } from '../../auth/api/session-recovery';
import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  SEARCH_ERROR_CODES,
  type SearchErrorCode,
  type SearchFilters,
  type SearchResponse,
} from '../types/search.types';

export type SearchApiErrorKind = 'denied' | 'invalid' | 'network' | 'unknown';

export class SearchApiError extends Error {
  readonly status: number;
  readonly code?: SearchErrorCode;
  readonly kind: SearchApiErrorKind;

  constructor(status: number, code: SearchErrorCode | undefined, kind: SearchApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new SearchApiError(401, undefined, 'denied');
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

function buildQuery(filters: SearchFilters): string {
  const params = new URLSearchParams();
  params.set('q', filters.q);
  if (filters.types?.length) {
    params.set('types', filters.types.join(','));
  }
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.clientId) {
    params.set('clientId', filters.clientId);
  }
  if (filters.serviceDefinitionId) {
    params.set('serviceDefinitionId', filters.serviceDefinitionId);
  }
  if (filters.from) {
    params.set('from', filters.from);
  }
  if (filters.to) {
    params.set('to', filters.to);
  }
  if (filters.limit) {
    params.set('limit', String(filters.limit));
  }
  if (filters.offset) {
    params.set('offset', String(filters.offset));
  }
  return `?${params.toString()}`;
}

async function parseError(response: Response): Promise<SearchApiError> {
  let code: SearchErrorCode | undefined;
  try {
    const body = (await response.json()) as { code?: SearchErrorCode };
    code = body.code;
  } catch {
    code = undefined;
  }

  if (code === SEARCH_ERROR_CODES.ACCESS_DENIED || response.status === 403) {
    return new SearchApiError(response.status, code, 'denied');
  }
  if (code === SEARCH_ERROR_CODES.INVALID_QUERY || response.status === 400) {
    return new SearchApiError(response.status, code, 'invalid');
  }
  return new SearchApiError(response.status, code, 'unknown');
}

export async function searchEntities(filters: SearchFilters, signal?: AbortSignal): Promise<SearchResponse> {
  try {
    const response = await fetchWithSession(`${getApiBaseUrl()}/api/v1/search${buildQuery(filters)}`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as SearchResponse;
  } catch (error) {
    if (error instanceof SearchApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new SearchApiError(0, undefined, 'network');
    }
    throw new SearchApiError(500, undefined, 'unknown');
  }
}

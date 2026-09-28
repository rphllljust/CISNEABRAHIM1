import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  CATALOG_ERROR_CODES,
  type CatalogErrorCode,
  type CatalogLineageStatus,
  type CreateServiceDefinitionPayload,
  type DeactivateDefinitionPayload,
  type LineageMutationPayload,
  type ServiceDefinition,
  type ServiceDefinitionListResponse,
  type ServiceDefinitionVersion,
  type UpdateDraftPayload,
  type VersionMutationPayload,
} from '../types/service-catalog.types';

export type CatalogApiErrorKind =
  | 'denied'
  | 'not_found'
  | 'validation'
  | 'version_conflict'
  | 'code_conflict'
  | 'invalid_state'
  | 'publish_invalid'
  | 'network'
  | 'unknown';

export class CatalogApiError extends Error {
  readonly status: number;
  readonly code?: CatalogErrorCode;
  readonly kind: CatalogApiErrorKind;

  constructor(status: number, code: CatalogErrorCode | undefined, kind: CatalogApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

type CatalogErrorBody = {
  error?: {
    code?: CatalogErrorCode;
    message?: string;
  };
};

const PROBE_DEFINITION_ID = '00000000-0000-4000-8000-000000000002';

function classifyError(status: number, code: CatalogErrorCode | undefined): CatalogApiErrorKind {
  if (code === CATALOG_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (code === CATALOG_ERROR_CODES.NOT_FOUND || status === 404) {
    return 'not_found';
  }
  if (code === CATALOG_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === CATALOG_ERROR_CODES.CODE_CONFLICT) {
    return 'code_conflict';
  }
  if (code === CATALOG_ERROR_CODES.INVALID_STATE) {
    return 'invalid_state';
  }
  if (code === CATALOG_ERROR_CODES.PUBLISH_INVALID) {
    return 'publish_invalid';
  }
  if (code === CATALOG_ERROR_CODES.VALIDATION_FAILED || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<CatalogApiError> {
  let code: CatalogErrorCode | undefined;
  try {
    const body = (await response.json()) as CatalogErrorBody;
    code = body.error?.code;
  } catch {
    // ignore
  }
  return new CatalogApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new CatalogApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
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
    if (error instanceof CatalogApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new CatalogApiError(0, undefined, 'network');
    }
    throw new CatalogApiError(0, undefined, 'unknown');
  }
}

export type ListServiceDefinitionsParams = {
  limit: number;
  offset: number;
  status?: CatalogLineageStatus;
  /** Busca no SERVIDOR por nome do servico ou code operacional. */
  search?: string;
};

export function buildListServiceDefinitionsQuery(params: ListServiceDefinitionsParams): string {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit));
  search.set('offset', String(params.offset));
  if (params.status) {
    search.set('status', params.status);
  }
  const term = params.search?.trim();
  if (term) {
    search.set('q', term);
  }
  return search.toString();
}

export async function listServiceDefinitions(
  params: ListServiceDefinitionsParams,
  signal?: AbortSignal,
): Promise<ServiceDefinitionListResponse> {
  const query = buildListServiceDefinitionsQuery(params);
  return requestJson<ServiceDefinitionListResponse>(`/api/v1/catalog/service-definitions?${query}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getServiceDefinition(
  definitionId: string,
  signal?: AbortSignal,
): Promise<ServiceDefinition> {
  return requestJson<ServiceDefinition>(`/api/v1/catalog/service-definitions/${definitionId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createServiceDefinition(
  payload: CreateServiceDefinitionPayload,
  signal?: AbortSignal,
): Promise<ServiceDefinitionVersion> {
  return requestJson<ServiceDefinitionVersion>('/api/v1/catalog/service-definitions', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function listServiceDefinitionVersions(
  definitionId: string,
  signal?: AbortSignal,
): Promise<ServiceDefinitionVersion[]> {
  return requestJson<ServiceDefinitionVersion[]>(
    `/api/v1/catalog/service-definitions/${definitionId}/versions`,
    {
      method: 'GET',
      headers: authHeaders(),
      signal,
    },
  );
}

export async function getServiceDefinitionVersion(
  definitionId: string,
  versionNumber: number,
  signal?: AbortSignal,
): Promise<ServiceDefinitionVersion> {
  return requestJson<ServiceDefinitionVersion>(
    `/api/v1/catalog/service-definitions/${definitionId}/versions/${versionNumber}`,
    {
      method: 'GET',
      headers: authHeaders(),
      signal,
    },
  );
}

export async function createServiceDefinitionVersion(
  definitionId: string,
  payload: VersionMutationPayload,
  signal?: AbortSignal,
): Promise<ServiceDefinitionVersion> {
  return requestJson<ServiceDefinitionVersion>(
    `/api/v1/catalog/service-definitions/${definitionId}/versions`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export async function updateServiceDefinitionDraft(
  definitionId: string,
  versionNumber: number,
  payload: UpdateDraftPayload,
  signal?: AbortSignal,
): Promise<ServiceDefinitionVersion> {
  return requestJson<ServiceDefinitionVersion>(
    `/api/v1/catalog/service-definitions/${definitionId}/versions/${versionNumber}`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export async function publishServiceDefinitionVersion(
  definitionId: string,
  versionNumber: number,
  payload: LineageMutationPayload,
  signal?: AbortSignal,
): Promise<ServiceDefinitionVersion> {
  return requestJson<ServiceDefinitionVersion>(
    `/api/v1/catalog/service-definitions/${definitionId}/versions/${versionNumber}/publish`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export async function deactivateServiceDefinition(
  definitionId: string,
  payload: DeactivateDefinitionPayload,
  signal?: AbortSignal,
): Promise<ServiceDefinition> {
  return requestJson<ServiceDefinition>(
    `/api/v1/catalog/service-definitions/${definitionId}/deactivate`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export async function activateServiceDefinition(
  definitionId: string,
  payload: LineageMutationPayload,
  signal?: AbortSignal,
): Promise<ServiceDefinition> {
  return requestJson<ServiceDefinition>(
    `/api/v1/catalog/service-definitions/${definitionId}/activate`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export type CatalogCapabilities = {
  canList: boolean;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canPublish: boolean;
  canDeactivate: boolean;
  canActivate: boolean;
};

async function probeMutation(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<boolean> {
  try {
    await requestJson(path, {
      method,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return true;
  } catch (error) {
    if (error instanceof CatalogApiError) {
      if (error.kind === 'denied') {
        return false;
      }
      if (
        error.kind === 'not_found' ||
        error.kind === 'validation' ||
        error.kind === 'invalid_state' ||
        error.kind === 'version_conflict' ||
        error.kind === 'publish_invalid'
      ) {
        return true;
      }
    }
    return false;
  }
}

export async function probeCatalogCapabilities(signal?: AbortSignal): Promise<CatalogCapabilities> {
  let canList = false;
  try {
    await listServiceDefinitions({ limit: 1, offset: 0 }, signal);
    canList = true;
  } catch (error) {
    if (error instanceof CatalogApiError && error.kind === 'denied') {
      canList = false;
    }
  }

  const [canCreate, canRead, canUpdate, canPublish, canDeactivate, canActivate] = await Promise.all([
    probeMutation('/api/v1/catalog/service-definitions', 'POST', {}),
    (async () => {
      try {
        await getServiceDefinition(PROBE_DEFINITION_ID, signal);
        return true;
      } catch (error) {
        if (error instanceof CatalogApiError) {
          return error.kind !== 'denied';
        }
        return false;
      }
    })(),
    probeMutation(
      `/api/v1/catalog/service-definitions/${PROBE_DEFINITION_ID}/versions/1`,
      'PATCH',
      { lineageVersion: 1 },
    ),
    probeMutation(
      `/api/v1/catalog/service-definitions/${PROBE_DEFINITION_ID}/versions/1/publish`,
      'POST',
      { lineageVersion: 1 },
    ),
    probeMutation(`/api/v1/catalog/service-definitions/${PROBE_DEFINITION_ID}/deactivate`, 'POST', {
      lineageVersion: 1,
      reason: 'probe',
    }),
    probeMutation(`/api/v1/catalog/service-definitions/${PROBE_DEFINITION_ID}/activate`, 'POST', {
      lineageVersion: 1,
    }),
  ]);

  return { canList, canCreate, canRead, canUpdate, canPublish, canDeactivate, canActivate };
}

export async function probeCatalogListAccess(signal?: AbortSignal): Promise<boolean> {
  try {
    await listServiceDefinitions({ limit: 1, offset: 0 }, signal);
    return true;
  } catch (error) {
    if (error instanceof CatalogApiError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.kind === 'denied') {
        return false;
      }
    }
    return false;
  }
}

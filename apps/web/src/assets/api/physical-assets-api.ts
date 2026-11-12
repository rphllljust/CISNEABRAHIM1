import { fetchWithSession } from '../../auth/api/session-recovery';
import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  ASSET_ERROR_CODES,
  type AssetErrorCode,
  VEHICLE_CLASSIFICATION,
  type AssetAllocationStatus,
  type AssetLifecycleStatus,
  type AssetOperationalAvailability,
  type CreatePhysicalAssetPayload,
  type PhysicalAsset,
  type PhysicalAssetListResponse,
  type PhysicalAssetListSummary,
  type PhysicalResourceTypeOption,
  type UpdatePhysicalAssetPayload,
} from '../types/physical-asset.types';

export type AssetApiErrorKind =
  | 'denied'
  | 'not_found'
  | 'validation'
  | 'version_conflict'
  | 'code_conflict'
  | 'plate_conflict'
  | 'invalid_state'
  | 'network'
  | 'unknown';

export class AssetsApiError extends Error {
  readonly status: number;
  readonly code?: AssetErrorCode;
  readonly kind: AssetApiErrorKind;

  constructor(status: number, code: AssetErrorCode | undefined, kind: AssetApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

type AssetErrorBody = {
  error?: {
    code?: AssetErrorCode;
    message?: string;
  };
};

const PROBE_ASSET_ID = '00000000-0000-4000-8000-000000000003';

function classifyError(status: number, code: AssetErrorCode | undefined): AssetApiErrorKind {
  if (code === ASSET_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (code === ASSET_ERROR_CODES.NOT_FOUND || status === 404) {
    return 'not_found';
  }
  if (code === ASSET_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === ASSET_ERROR_CODES.CODE_CONFLICT) {
    return 'code_conflict';
  }
  if (code === ASSET_ERROR_CODES.PLATE_CONFLICT) {
    return 'plate_conflict';
  }
  if (code === ASSET_ERROR_CODES.INVALID_STATE) {
    return 'invalid_state';
  }
  if (code === ASSET_ERROR_CODES.VALIDATION_FAILED || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<AssetsApiError> {
  let code: AssetErrorCode | undefined;
  try {
    const body = (await response.json()) as AssetErrorBody;
    code = body.error?.code;
  } catch {
    // ignore
  }
  return new AssetsApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new AssetsApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
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
    if (error instanceof AssetsApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new AssetsApiError(0, undefined, 'network');
    }
    throw new AssetsApiError(0, undefined, 'unknown');
  }
}

export type ListPhysicalAssetsParams = {
  limit: number;
  offset: number;
  lifecycleStatus?: AssetLifecycleStatus;
  allocationStatus?: AssetAllocationStatus;
  availability?: AssetOperationalAvailability;
  resourceTypeId?: string;
  classification?: typeof VEHICLE_CLASSIFICATION;
  q?: string;
};

export function buildListPhysicalAssetsQuery(params: ListPhysicalAssetsParams): string {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit));
  search.set('offset', String(params.offset));
  if (params.lifecycleStatus) {
    search.set('lifecycleStatus', params.lifecycleStatus);
  }
  if (params.allocationStatus) {
    search.set('allocationStatus', params.allocationStatus);
  }
  if (params.availability) {
    search.set('availability', params.availability);
  }
  if (params.resourceTypeId) {
    search.set('resourceTypeId', params.resourceTypeId);
  }
  if (params.classification) {
    search.set('classification', params.classification);
  }
  if (params.q?.trim()) {
    search.set('q', params.q.trim());
  }
  return search.toString();
}

export async function listPhysicalAssets(
  params: ListPhysicalAssetsParams,
  signal?: AbortSignal,
): Promise<PhysicalAssetListResponse> {
  const query = buildListPhysicalAssetsQuery(params);
  return requestJson<PhysicalAssetListResponse>(`/api/v1/resources/physical-assets?${query}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export type PhysicalAssetSummaryParams = {
  resourceTypeId?: string;
  classification?: typeof VEHICLE_CLASSIFICATION;
};

export function buildPhysicalAssetSummaryQuery(params: PhysicalAssetSummaryParams): string {
  const search = new URLSearchParams();
  if (params.resourceTypeId) {
    search.set('resourceTypeId', params.resourceTypeId);
  }
  if (params.classification) {
    search.set('classification', params.classification);
  }
  return search.toString();
}

export async function getPhysicalAssetSummary(
  params: PhysicalAssetSummaryParams = {},
  signal?: AbortSignal,
): Promise<PhysicalAssetListSummary> {
  const query = buildPhysicalAssetSummaryQuery(params);
  const suffix = query.length > 0 ? `?${query}` : '';
  return requestJson<PhysicalAssetListSummary>(`/api/v1/resources/physical-assets/summary${suffix}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getPhysicalAsset(
  assetId: string,
  signal?: AbortSignal,
): Promise<PhysicalAsset> {
  return requestJson<PhysicalAsset>(`/api/v1/resources/physical-assets/${assetId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createPhysicalAsset(
  payload: CreatePhysicalAssetPayload,
  signal?: AbortSignal,
): Promise<PhysicalAsset> {
  return requestJson<PhysicalAsset>('/api/v1/resources/physical-assets', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function updatePhysicalAsset(
  assetId: string,
  payload: UpdatePhysicalAssetPayload,
  signal?: AbortSignal,
): Promise<PhysicalAsset> {
  return requestJson<PhysicalAsset>(`/api/v1/resources/physical-assets/${assetId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function deactivatePhysicalAsset(
  assetId: string,
  version: number,
  signal?: AbortSignal,
): Promise<PhysicalAsset> {
  return requestJson<PhysicalAsset>(`/api/v1/resources/physical-assets/${assetId}/deactivate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
    signal,
  });
}

export async function activatePhysicalAsset(
  assetId: string,
  version: number,
  signal?: AbortSignal,
): Promise<PhysicalAsset> {
  return requestJson<PhysicalAsset>(`/api/v1/resources/physical-assets/${assetId}/activate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
    signal,
  });
}

export async function listPhysicalResourceTypes(
  signal?: AbortSignal,
): Promise<PhysicalResourceTypeOption[]> {
  const body = await requestJson<{ items: PhysicalResourceTypeOption[] }>(
    '/api/v1/resources/physical-resource-types?limit=100&offset=0&status=ACTIVE',
    {
      method: 'GET',
      headers: authHeaders(),
      signal,
    },
  );
  return body.items;
}

export type AssetCapabilities = {
  canList: boolean;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
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
    if (error instanceof AssetsApiError) {
      if (error.kind === 'denied') {
        return false;
      }
      if (error.kind === 'not_found' || error.kind === 'validation') {
        return true;
      }
    }
    return false;
  }
}

export async function probeAssetCapabilities(signal?: AbortSignal): Promise<AssetCapabilities> {
  let canList = false;
  try {
    await listPhysicalAssets({ limit: 1, offset: 0 }, signal);
    canList = true;
  } catch (error) {
    if (error instanceof AssetsApiError && error.kind === 'denied') {
      canList = false;
    }
  }

  const [canCreate, canRead, canUpdate, canDeactivate, canActivate] = await Promise.all([
    probeMutation('/api/v1/resources/physical-assets', 'POST', {}),
    (async () => {
      try {
        await getPhysicalAsset(PROBE_ASSET_ID, signal);
        return true;
      } catch (error) {
        if (error instanceof AssetsApiError) {
          return error.kind !== 'denied';
        }
        return false;
      }
    })(),
    probeMutation(`/api/v1/resources/physical-assets/${PROBE_ASSET_ID}`, 'PATCH', { version: 1 }),
    probeMutation(`/api/v1/resources/physical-assets/${PROBE_ASSET_ID}/deactivate`, 'POST', {
      version: 1,
    }),
    probeMutation(`/api/v1/resources/physical-assets/${PROBE_ASSET_ID}/activate`, 'POST', {
      version: 1,
    }),
  ]);

  return { canList, canCreate, canRead, canUpdate, canDeactivate, canActivate };
}

export async function probeAssetListAccess(signal?: AbortSignal): Promise<boolean> {
  try {
    await listPhysicalAssets({ limit: 1, offset: 0 }, signal);
    return true;
  } catch (error) {
    if (error instanceof AssetsApiError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.kind === 'denied') {
        return false;
      }
    }
    throw error;
  }
}

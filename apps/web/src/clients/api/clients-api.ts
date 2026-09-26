import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  CLIENT_ERROR_CODES,
  type Client,
  type ClientErrorCode,
  type ClientListDirection,
  type ClientListResponse,
  type ClientListSort,
  type ClientStatus,
  type CreateClientPayload,
  type PurchaseOrderRequirement,
  type UpdateClientPayload,
} from '../types/client.types';

export type ClientApiErrorKind =
  | 'denied'
  | 'not_found'
  | 'validation'
  | 'version_conflict'
  | 'tax_id_conflict'
  | 'invalid_state'
  | 'network'
  | 'unknown';

export class ClientsApiError extends Error {
  readonly status: number;
  readonly code?: ClientErrorCode;
  readonly kind: ClientApiErrorKind;

  constructor(status: number, code: ClientErrorCode | undefined, kind: ClientApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

type ClientErrorBody = {
  error?: {
    code?: ClientErrorCode;
    message?: string;
  };
};

const PROBE_CLIENT_ID = '00000000-0000-4000-8000-000000000001';

function classifyError(status: number, code: ClientErrorCode | undefined): ClientApiErrorKind {
  if (code === CLIENT_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (code === CLIENT_ERROR_CODES.NOT_FOUND || status === 404) {
    return 'not_found';
  }
  if (code === CLIENT_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === CLIENT_ERROR_CODES.TAX_ID_CONFLICT) {
    return 'tax_id_conflict';
  }
  if (code === CLIENT_ERROR_CODES.INVALID_STATE) {
    return 'invalid_state';
  }
  if (code === CLIENT_ERROR_CODES.VALIDATION_FAILED || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<ClientsApiError> {
  let code: ClientErrorCode | undefined;
  try {
    const body = (await response.json()) as ClientErrorBody;
    code = body.error?.code;
  } catch {
    // ignore parse errors
  }
  return new ClientsApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new ClientsApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
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
    if (error instanceof ClientsApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ClientsApiError(0, undefined, 'network');
    }
    throw new ClientsApiError(0, undefined, 'unknown');
  }
}

export type ListClientsParams = {
  limit: number;
  offset: number;
  q?: string;
  status?: ClientStatus;
  purchaseOrderRequirement?: PurchaseOrderRequirement;
  sort?: ClientListSort;
  direction?: ClientListDirection;
};

/**
 * Monta a query da listagem. Parâmetros vazios/indefinidos não são enviados: a ausência de `q` é o
 * que permite ao backend distinguir "sem busca" de "busca vazia", e o backend rejeita valores
 * inválidos em vez de ignorá-los.
 */
export function buildListClientsQuery(params: ListClientsParams): string {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit));
  search.set('offset', String(params.offset));
  if (params.q?.trim()) {
    search.set('q', params.q.trim());
  }
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.purchaseOrderRequirement) {
    search.set('purchaseOrderRequirement', params.purchaseOrderRequirement);
  }
  if (params.sort) {
    search.set('sort', params.sort);
  }
  if (params.direction) {
    search.set('direction', params.direction);
  }
  return search.toString();
}

export async function listClients(
  params: ListClientsParams,
  signal?: AbortSignal,
): Promise<ClientListResponse> {
  const query = buildListClientsQuery(params);
  return requestJson<ClientListResponse>(`/api/v1/clients?${query}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getClient(clientId: string, signal?: AbortSignal): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createClient(
  payload: CreateClientPayload,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>('/api/v1/clients', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function updateClient(
  clientId: string,
  payload: UpdateClientPayload,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function deactivateClient(
  clientId: string,
  version: number,
  reason: string,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/deactivate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, reason }),
    signal,
  });
}

export async function activateClient(
  clientId: string,
  version: number,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/activate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
    signal,
  });
}

export type ClientCapabilities = {
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
    if (error instanceof ClientsApiError) {
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

export async function probeClientCapabilities(signal?: AbortSignal): Promise<ClientCapabilities> {
  let canList = false;
  try {
    await listClients({ limit: 1, offset: 0 }, signal);
    canList = true;
  } catch (error) {
    if (error instanceof ClientsApiError && error.kind === 'denied') {
      canList = false;
    }
  }

  const [canCreate, canRead, canUpdate, canDeactivate, canActivate] = await Promise.all([
    probeMutation('/api/v1/clients', 'POST', {}),
    (async () => {
      try {
        await getClient(PROBE_CLIENT_ID, signal);
        return true;
      } catch (error) {
        if (error instanceof ClientsApiError) {
          return error.kind !== 'denied';
        }
        return false;
      }
    })(),
    probeMutation(`/api/v1/clients/${PROBE_CLIENT_ID}`, 'PATCH', { version: 1 }),
    probeMutation(`/api/v1/clients/${PROBE_CLIENT_ID}/deactivate`, 'POST', {
      version: 1,
      reason: 'probe',
    }),
    probeMutation(`/api/v1/clients/${PROBE_CLIENT_ID}/activate`, 'POST', { version: 1 }),
  ]);

  return { canList, canCreate, canRead, canUpdate, canDeactivate, canActivate };
}

export async function probeClientListAccess(signal?: AbortSignal): Promise<boolean> {
  try {
    await listClients({ limit: 1, offset: 0 }, signal);
    return true;
  } catch (error) {
    if (error instanceof ClientsApiError) {
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

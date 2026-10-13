import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  CONTRACT_ERROR_CODES,
  type ActivateContractPayload,
  type CloseContractPayload,
  type ContractDetail,
  type ContractErrorCode,
  type ContractListResponse,
  type CreateContractPayload,
  type LinkContractDocumentPayload,
  type ListContractsParams,
  type UpdateContractDraftPayload,
} from '../types';

export type ContractsApiErrorKind =
  | 'denied'
  | 'not_found'
  | 'validation'
  | 'version_conflict'
  | 'invalid_state'
  | 'network'
  | 'unknown';

export class ContractsApiError extends Error {
  readonly status: number;
  readonly code?: ContractErrorCode;
  readonly kind: ContractsApiErrorKind;

  constructor(status: number, code: ContractErrorCode | undefined, kind: ContractsApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

type RequestErrorBody = {
  error?: { code?: ContractErrorCode; message?: string };
  code?: ContractErrorCode;
  message?: string;
};

/** Id de contrato inexistente usado apenas nos probes de capacidade (404 no backend). */
const PROBE_CONTRACT_ID = '00000000-0000-4000-8000-000000000005';

function classifyError(status: number, code: ContractErrorCode | undefined): ContractsApiErrorKind {
  if (code === CONTRACT_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (
    code === CONTRACT_ERROR_CODES.NOT_FOUND ||
    code === CONTRACT_ERROR_CODES.CLIENT_NOT_FOUND ||
    code === CONTRACT_ERROR_CODES.SERVICE_NOT_FOUND ||
    code === CONTRACT_ERROR_CODES.DOCUMENT_NOT_FOUND ||
    status === 404
  ) {
    return 'not_found';
  }
  if (code === CONTRACT_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === CONTRACT_ERROR_CODES.INVALID_STATE) {
    return 'invalid_state';
  }
  if (code === CONTRACT_ERROR_CODES.VALIDATION_FAILED || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<ContractsApiError> {
  let code: ContractErrorCode | undefined;
  try {
    const body = (await response.json()) as RequestErrorBody;
    code = body.error?.code ?? body.code;
  } catch {
    // corpo de erro ilegível: mantém código indefinido
  }
  return new ContractsApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new ContractsApiError(401, undefined, 'denied');
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
    if (error instanceof ContractsApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ContractsApiError(0, undefined, 'network');
    }
    throw new ContractsApiError(0, undefined, 'unknown');
  }
}

export function buildListContractsQuery(params: ListContractsParams): string {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit));
  search.set('offset', String(params.offset));
  if (params.clientId) {
    search.set('clientId', params.clientId);
  }
  if (params.unitId) {
    search.set('unitId', params.unitId);
  }
  if (params.status) {
    search.set('status', params.status);
  }
  const term = params.search?.trim();
  if (term) {
    search.set('q', term);
  }
  if (params.effectiveFrom) {
    search.set('effectiveFrom', params.effectiveFrom);
  }
  if (params.effectiveTo) {
    search.set('effectiveTo', params.effectiveTo);
  }
  // O filtro avançado entra na MESMA query: paginação, ordenação e recorte composto compõem um
  // único predicado no servidor.
  if (params.advanced && params.advanced.groups.length > 0) {
    search.set('filters', JSON.stringify(params.advanced));
  }
  return search.toString();
}

export async function listContracts(
  params: ListContractsParams,
  signal?: AbortSignal,
): Promise<ContractListResponse> {
  const query = buildListContractsQuery(params);
  return requestJson<ContractListResponse>(`/api/v1/commercial/contracts?${query}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getContract(
  contractId: string,
  signal?: AbortSignal,
): Promise<ContractDetail> {
  return requestJson<ContractDetail>(`/api/v1/commercial/contracts/${contractId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createContract(
  payload: CreateContractPayload,
  signal?: AbortSignal,
): Promise<ContractDetail> {
  return requestJson<ContractDetail>('/api/v1/commercial/contracts', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function updateContractDraft(
  contractId: string,
  payload: UpdateContractDraftPayload,
  signal?: AbortSignal,
): Promise<ContractDetail> {
  return requestJson<ContractDetail>(`/api/v1/commercial/contracts/${contractId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function activateContract(
  contractId: string,
  payload: ActivateContractPayload,
  signal?: AbortSignal,
): Promise<ContractDetail> {
  return requestJson<ContractDetail>(`/api/v1/commercial/contracts/${contractId}/activate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function closeContract(
  contractId: string,
  payload: CloseContractPayload,
  signal?: AbortSignal,
): Promise<ContractDetail> {
  return requestJson<ContractDetail>(`/api/v1/commercial/contracts/${contractId}/close`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

/** O endpoint de expiração do backend não recebe corpo (nem rowVersion nem motivo). */
export async function expireContract(
  contractId: string,
  signal?: AbortSignal,
): Promise<ContractDetail> {
  return requestJson<ContractDetail>(`/api/v1/commercial/contracts/${contractId}/expire`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    signal,
  });
}

export async function linkContractDocument(
  contractId: string,
  payload: LinkContractDocumentPayload,
  signal?: AbortSignal,
): Promise<ContractDetail> {
  return requestJson<ContractDetail>(`/api/v1/commercial/contracts/${contractId}/documents`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export type ContractCapabilities = {
  canList: boolean;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canActivate: boolean;
  canClose: boolean;
  canExpire: boolean;
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
    if (error instanceof ContractsApiError) {
      if (error.kind === 'denied') {
        return false;
      }
      if (
        error.kind === 'not_found' ||
        error.kind === 'validation' ||
        error.kind === 'invalid_state' ||
        error.kind === 'version_conflict'
      ) {
        return true;
      }
    }
    return false;
  }
}

export async function probeContractCapabilities(
  signal?: AbortSignal,
): Promise<ContractCapabilities> {
  let canList = false;
  try {
    await listContracts({ limit: 1, offset: 0 }, signal);
    canList = true;
  } catch (error) {
    if (error instanceof ContractsApiError && error.kind === 'denied') {
      canList = false;
    }
  }

  const probeId = PROBE_CONTRACT_ID;
  const [canCreate, canRead, canUpdate, canActivate, canClose, canExpire] = await Promise.all([
    probeMutation('/api/v1/commercial/contracts', 'POST', {}),
    (async () => {
      try {
        await getContract(probeId, signal);
        return true;
      } catch (error) {
        if (error instanceof ContractsApiError) {
          return error.kind !== 'denied';
        }
        return false;
      }
    })(),
    probeMutation(`/api/v1/commercial/contracts/${probeId}`, 'PATCH', { rowVersion: 1 }),
    probeMutation(`/api/v1/commercial/contracts/${probeId}/activate`, 'POST', { rowVersion: 1 }),
    probeMutation(`/api/v1/commercial/contracts/${probeId}/close`, 'POST', { rowVersion: 1 }),
    probeMutation(`/api/v1/commercial/contracts/${probeId}/expire`, 'POST', {}),
  ]);

  return { canList, canCreate, canRead, canUpdate, canActivate, canClose, canExpire };
}

export async function probeContractListAccess(signal?: AbortSignal): Promise<boolean> {
  try {
    await listContracts({ limit: 1, offset: 0 }, signal);
    return true;
  } catch (error) {
    if (error instanceof ContractsApiError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.kind === 'denied') {
        return false;
      }
      // Falha de rede / 5xx: propaga para que o gate exiba erro com nova tentativa.
      throw error;
    }
    return false;
  }
}

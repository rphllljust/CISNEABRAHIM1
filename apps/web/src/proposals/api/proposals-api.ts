import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  PROPOSAL_ERROR_CODES,
  type AcceptProposalPayload,
  type CancelProposalPayload,
  type CreateProposalPayload,
  type LinkProposalDocumentPayload,
  type ProposalDetail,
  type ProposalErrorCode,
  type ProposalListResponse,
  type ProposalListDirection,
  type ProposalListSort,
  type ProposalVersion,
  type RejectProposalPayload,
  type UpdateProposalDraftPayload,
} from '../types/proposal.types';

export type ProposalsApiErrorKind =
  | 'denied'
  | 'not_found'
  | 'validation'
  | 'version_conflict'
  | 'invalid_state'
  | 'network'
  | 'unknown';

export class ProposalsApiError extends Error {
  readonly status: number;
  readonly code?: ProposalErrorCode;
  readonly kind: ProposalsApiErrorKind;

  constructor(status: number, code: ProposalErrorCode | undefined, kind: ProposalsApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

type RequestErrorBody = {
  error?: { code?: ProposalErrorCode; message?: string };
  code?: ProposalErrorCode;
  message?: string;
};

const PROBE_PROPOSAL_ID = '00000000-0000-4000-8000-000000000003';

function classifyError(status: number, code: ProposalErrorCode | undefined): ProposalsApiErrorKind {
  if (code === PROPOSAL_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (
    code === PROPOSAL_ERROR_CODES.NOT_FOUND ||
    code === PROPOSAL_ERROR_CODES.VERSION_NOT_FOUND ||
    status === 404
  ) {
    return 'not_found';
  }
  if (code === PROPOSAL_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === PROPOSAL_ERROR_CODES.INVALID_STATE) {
    return 'invalid_state';
  }
  if (code === PROPOSAL_ERROR_CODES.VALIDATION_FAILED || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<ProposalsApiError> {
  let code: ProposalErrorCode | undefined;
  try {
    const body = (await response.json()) as RequestErrorBody;
    code = body.error?.code ?? body.code;
  } catch {
    // ignore parse errors
  }
  return new ProposalsApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new ProposalsApiError(401, undefined, 'denied');
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
    if (error instanceof ProposalsApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ProposalsApiError(0, undefined, 'network');
    }
    throw new ProposalsApiError(0, undefined, 'unknown');
  }
}

export type ListProposalsParams = {
  limit: number;
  offset: number;
  clientId?: string;
  unitId?: string;
  status?: string;
  currencyCode?: string;
  validFrom?: string;
  validTo?: string;
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  sort?: ProposalListSort;
  direction?: ProposalListDirection;
};

export function buildListProposalsQuery(params: ListProposalsParams): string {
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
  if (params.currencyCode) {
    search.set('currencyCode', params.currencyCode);
  }
  if (params.validFrom) {
    search.set('validFrom', params.validFrom);
  }
  if (params.validTo) {
    search.set('validTo', params.validTo);
  }
  if (params.createdFrom) {
    search.set('createdFrom', params.createdFrom);
  }
  if (params.createdTo) {
    search.set('createdTo', params.createdTo);
  }
  const term = params.search?.trim();
  if (term) {
    search.set('q', term);
  }
  if (params.sort) {
    search.set('sort', params.sort);
  }
  if (params.direction) {
    search.set('direction', params.direction);
  }
  return search.toString();
}

export async function listProposals(
  params: ListProposalsParams,
  signal?: AbortSignal,
): Promise<ProposalListResponse> {
  const query = buildListProposalsQuery(params);
  return requestJson<ProposalListResponse>(`/api/v1/commercial/proposals?${query}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getProposal(proposalId: string, signal?: AbortSignal): Promise<ProposalDetail> {
  return requestJson<ProposalDetail>(`/api/v1/commercial/proposals/${proposalId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listProposalVersions(
  proposalId: string,
  signal?: AbortSignal,
): Promise<ProposalVersion[]> {
  return requestJson<ProposalVersion[]>(`/api/v1/commercial/proposals/${proposalId}/versions`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createProposal(
  payload: CreateProposalPayload,
  signal?: AbortSignal,
): Promise<ProposalDetail> {
  return requestJson<ProposalDetail>('/api/v1/commercial/proposals', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function updateProposalDraft(
  proposalId: string,
  versionNumber: number,
  payload: UpdateProposalDraftPayload,
  signal?: AbortSignal,
): Promise<ProposalDetail> {
  return requestJson<ProposalDetail>(
    `/api/v1/commercial/proposals/${proposalId}/versions/${versionNumber}`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export async function createProposalRevision(
  proposalId: string,
  signal?: AbortSignal,
): Promise<ProposalDetail> {
  return requestJson<ProposalDetail>(`/api/v1/commercial/proposals/${proposalId}/versions`, {
    method: 'POST',
    headers: authHeaders(),
    signal,
  });
}

export async function issueProposalVersion(
  proposalId: string,
  versionNumber: number,
  rowVersion: number,
  signal?: AbortSignal,
): Promise<ProposalVersion> {
  return requestJson<ProposalVersion>(
    `/api/v1/commercial/proposals/${proposalId}/versions/${versionNumber}/issue`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowVersion }),
      signal,
    },
  );
}

export async function acceptProposalVersion(
  proposalId: string,
  versionNumber: number,
  payload: AcceptProposalPayload,
  signal?: AbortSignal,
): Promise<ProposalVersion> {
  return requestJson<ProposalVersion>(
    `/api/v1/commercial/proposals/${proposalId}/versions/${versionNumber}/accept`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export async function rejectProposalVersion(
  proposalId: string,
  versionNumber: number,
  payload: RejectProposalPayload,
  signal?: AbortSignal,
): Promise<ProposalVersion> {
  return requestJson<ProposalVersion>(
    `/api/v1/commercial/proposals/${proposalId}/versions/${versionNumber}/reject`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export async function expireProposalVersion(
  proposalId: string,
  versionNumber: number,
  rowVersion: number,
  signal?: AbortSignal,
): Promise<ProposalVersion> {
  return requestJson<ProposalVersion>(
    `/api/v1/commercial/proposals/${proposalId}/versions/${versionNumber}/expire`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowVersion }),
      signal,
    },
  );
}

export async function cancelProposalVersion(
  proposalId: string,
  versionNumber: number,
  payload: CancelProposalPayload,
  signal?: AbortSignal,
): Promise<ProposalVersion> {
  return requestJson<ProposalVersion>(
    `/api/v1/commercial/proposals/${proposalId}/versions/${versionNumber}/cancel`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export async function linkProposalDocument(
  proposalId: string,
  versionNumber: number,
  payload: LinkProposalDocumentPayload,
  signal?: AbortSignal,
): Promise<ProposalDetail> {
  return requestJson<ProposalDetail>(
    `/api/v1/commercial/proposals/${proposalId}/versions/${versionNumber}/documents`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export type ProposalCapabilities = {
  canList: boolean;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canIssue: boolean;
  canAccept: boolean;
  canReject: boolean;
  canExpire: boolean;
  canCancel: boolean;
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
    if (error instanceof ProposalsApiError) {
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

export async function probeProposalCapabilities(
  signal?: AbortSignal,
): Promise<ProposalCapabilities> {
  let canList = false;
  try {
    await listProposals({ limit: 1, offset: 0 }, signal);
    canList = true;
  } catch (error) {
    if (error instanceof ProposalsApiError && error.kind === 'denied') {
      canList = false;
    }
  }

  const probeId = PROBE_PROPOSAL_ID;
  const versionNumber = 1;
  const [
    canCreate,
    canRead,
    canUpdate,
    canIssue,
    canAccept,
    canReject,
    canExpire,
    canCancel,
  ] = await Promise.all([
    probeMutation('/api/v1/commercial/proposals', 'POST', {}),
    (async () => {
      try {
        await getProposal(probeId, signal);
        return true;
      } catch (error) {
        if (error instanceof ProposalsApiError) {
          return error.kind !== 'denied';
        }
        return false;
      }
    })(),
    probeMutation(`/api/v1/commercial/proposals/${probeId}/versions/${versionNumber}`, 'PATCH', {
      rowVersion: 1,
    }),
    probeMutation(
      `/api/v1/commercial/proposals/${probeId}/versions/${versionNumber}/issue`,
      'POST',
      { rowVersion: 1 },
    ),
    probeMutation(
      `/api/v1/commercial/proposals/${probeId}/versions/${versionNumber}/accept`,
      'POST',
      { rowVersion: 1, acceptanceOriginCode: 'INTERNAL_APPROVAL' },
    ),
    probeMutation(
      `/api/v1/commercial/proposals/${probeId}/versions/${versionNumber}/reject`,
      'POST',
      { rowVersion: 1 },
    ),
    probeMutation(
      `/api/v1/commercial/proposals/${probeId}/versions/${versionNumber}/expire`,
      'POST',
      { rowVersion: 1 },
    ),
    probeMutation(
      `/api/v1/commercial/proposals/${probeId}/versions/${versionNumber}/cancel`,
      'POST',
      { rowVersion: 1 },
    ),
  ]);

  return {
    canList,
    canCreate,
    canRead,
    canUpdate,
    canIssue,
    canAccept,
    canReject,
    canExpire,
    canCancel,
  };
}

export async function probeProposalListAccess(signal?: AbortSignal): Promise<boolean> {
  try {
    await listProposals({ limit: 1, offset: 0 }, signal);
    return true;
  } catch (error) {
    if (error instanceof ProposalsApiError) {
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

import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  PERSON_ERROR_CODES,
  type CreatePersonPayload,
  type Person,
  type PersonErrorCode,
  type PersonHistoryEvent,
  type PersonAllocationListResponse,
  type PersonAllocationCursorPage,
  type PersonListResponse,
  type PersonStatus,
  type UpdatePersonPayload,
} from '../types/person.types';

export type PeopleApiErrorKind =
  | 'denied'
  | 'not_found'
  | 'validation'
  | 'version_conflict'
  | 'external_id_conflict'
  | 'invalid_state'
  | 'network'
  | 'unknown';

export class PeopleApiError extends Error {
  readonly status: number;
  readonly code?: PersonErrorCode;
  readonly kind: PeopleApiErrorKind;

  constructor(status: number, code: PersonErrorCode | undefined, kind: PeopleApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

type PersonErrorBody = {
  error?: {
    code?: PersonErrorCode;
    message?: string;
  };
};

const PROBE_PERSON_ID = '00000000-0000-4000-8000-000000000002';

function classifyError(status: number, code: PersonErrorCode | undefined): PeopleApiErrorKind {
  if (code === PERSON_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (code === PERSON_ERROR_CODES.NOT_FOUND || status === 404) {
    return 'not_found';
  }
  if (code === PERSON_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === PERSON_ERROR_CODES.EXTERNAL_ID_CONFLICT) {
    return 'external_id_conflict';
  }
  if (code === PERSON_ERROR_CODES.INVALID_STATE) {
    return 'invalid_state';
  }
  if (code === PERSON_ERROR_CODES.VALIDATION_FAILED || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<PeopleApiError> {
  let code: PersonErrorCode | undefined;
  try {
    const body = (await response.json()) as PersonErrorBody;
    code = body.error?.code;
  } catch {
    // ignore parse errors
  }
  return new PeopleApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new PeopleApiError(401, undefined, 'denied');
  }
  return { Authorization: `Bearer ${accessToken}` };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, init);
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof PeopleApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new PeopleApiError(0, undefined, 'network');
    }
    throw new PeopleApiError(500, undefined, 'unknown');
  }
}

export async function listPeople(
  params: {
    limit: number;
    offset: number;
    status?: PersonStatus;
    q?: string;
    defaultLaborTypeCode?: string;
  },
  signal?: AbortSignal,
): Promise<PersonListResponse> {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.q) {
    search.set('q', params.q);
  }
  if (params.defaultLaborTypeCode) {
    search.set('defaultLaborTypeCode', params.defaultLaborTypeCode);
  }
  return requestJson<PersonListResponse>(`/api/v1/people?${search.toString()}`, {
    headers: authHeaders(),
    signal,
  });
}

export async function getPerson(personId: string, signal?: AbortSignal): Promise<Person> {
  return requestJson<Person>(`/api/v1/people/${personId}`, {
    headers: authHeaders(),
    signal,
  });
}

export async function listPersonAllocations(
  personId: string,
  params: { limit: number; offset: number },
  signal?: AbortSignal,
): Promise<PersonAllocationListResponse> {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  return requestJson<PersonAllocationListResponse>(
    `/api/v1/people/${personId}/allocations?${search.toString()}`,
    { headers: authHeaders(), signal },
  );
}

/** Cursor is an opaque, actor-bound continuation token, not a raw DB offset. */
export async function listPersonAllocationsCursor(
  personId: string,
  params: { limit: number; cursor: string | null },
  signal?: AbortSignal,
): Promise<PersonAllocationCursorPage> {
  const search = new URLSearchParams({
    paging: 'cursor',
    limit: String(params.limit),
  });
  if (params.cursor) search.set('cursor', params.cursor);
  return requestJson<PersonAllocationCursorPage>(
    `/api/v1/people/${personId}/allocations?${search.toString()}`,
    { headers: authHeaders(), signal },
  );
}

export async function createPerson(payload: CreatePersonPayload): Promise<Person> {
  return requestJson<Person>('/api/v1/people', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updatePerson(personId: string, payload: UpdatePersonPayload): Promise<Person> {
  return requestJson<Person>(`/api/v1/people/${personId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deactivatePerson(
  personId: string,
  version: number,
  reason: string,
): Promise<Person> {
  return requestJson<Person>(`/api/v1/people/${personId}/deactivate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, reason }),
  });
}

export async function activatePerson(personId: string, version: number): Promise<Person> {
  return requestJson<Person>(`/api/v1/people/${personId}/activate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  });
}

export async function listPersonHistory(
  personId: string,
  signal?: AbortSignal,
): Promise<{ items: PersonHistoryEvent[] }> {
  return requestJson<{ items: PersonHistoryEvent[] }>(`/api/v1/people/${personId}/history`, {
    headers: authHeaders(),
    signal,
  });
}

export type PersonCapabilities = {
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
    if (error instanceof PeopleApiError) {
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

export async function probePersonCapabilities(signal?: AbortSignal): Promise<PersonCapabilities> {
  let canList = false;
  try {
    await listPeople({ limit: 1, offset: 0 }, signal);
    canList = true;
  } catch (error) {
    if (error instanceof PeopleApiError && error.kind === 'denied') {
      canList = false;
    }
  }

  const [canCreate, canRead, canUpdate, canDeactivate, canActivate] = await Promise.all([
    probeMutation('/api/v1/people', 'POST', {}),
    (async () => {
      try {
        await getPerson(PROBE_PERSON_ID, signal);
        return true;
      } catch (error) {
        if (error instanceof PeopleApiError) {
          return error.kind !== 'denied';
        }
        return false;
      }
    })(),
    probeMutation(`/api/v1/people/${PROBE_PERSON_ID}`, 'PATCH', { version: 1 }),
    probeMutation(`/api/v1/people/${PROBE_PERSON_ID}/deactivate`, 'POST', {
      version: 1,
      reason: 'probe',
    }),
    probeMutation(`/api/v1/people/${PROBE_PERSON_ID}/activate`, 'POST', { version: 1 }),
  ]);

  return { canList, canCreate, canRead, canUpdate, canDeactivate, canActivate };
}

export async function probePersonListAccess(signal?: AbortSignal): Promise<boolean> {
  try {
    await listPeople({ limit: 1, offset: 0 }, signal);
    return true;
  } catch (error) {
    if (error instanceof PeopleApiError) {
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

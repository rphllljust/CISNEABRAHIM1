import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import { CLIENT_ADVANCED_FILTER_PARAM } from '../utils/client-list-params';
import type { AdvancedFilterPayload } from '../../engine';
import {
  CLIENT_ERROR_CODES,
  type Client,
  type ClientAuditTrail,
  type ClientContact,
  type ClientDataQuality,
  type ClientDuplicateCheck,
  type ClientErrorCode,
  type ClientHierarchy,
  type ClientListDirection,
  type ClientListResponse,
  type ClientListSort,
  type ClientStatus,
  type ContactRole,
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
  /**
   * Filtro avançado já convertido para o contrato do servidor.
   *
   * Viaja como JSON na chave `filters`. O backend valida allow-list de campo, operador por tipo,
   * valores de enum e limites de grupo — um filtro inválido responde 400 em vez de ser ignorado.
   */
  advanced?: AdvancedFilterPayload | null;
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
  // O filtro avançado entra na MESMA query: paginação, ordenação e recorte composto compõem um
  // único predicado no servidor, de modo que `total`/`totalPages` correspondam ao recorte real.
  if (params.advanced && params.advanced.groups.length > 0) {
    search.set(CLIENT_ADVANCED_FILTER_PARAM, JSON.stringify(params.advanced));
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

/* ══════════════════════════════════════════════════════════════════════════════════════════
   CUSTOMER 360 — leituras e comandos semânticos (migration 0097)
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * CONSULTA PRÉVIA DE DUPLICIDADE.
 *
 * Roda ANTES de criar e NUNCA funde nada: devolve os candidatos com a força da evidência separada
 * (`certain` = coincidência provada por documento ou referência externa; suspeita = apenas nome).
 * A decisão de seguir com o cadastro é do operador.
 */
export async function checkClientDuplicates(
  probe: {
    legalName?: string;
    tradeName?: string;
    taxId?: string;
    externalErpId?: string;
    excludeClientId?: string;
  },
  signal?: AbortSignal,
): Promise<ClientDuplicateCheck> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(probe)) {
    // Parâmetro vazio NÃO é enviado: o servidor distingue "sem sinal" de "sinal vazio", e mandar
    // string vazia faria a triagem comparar contra nada.
    if (typeof value === 'string' && value.trim().length > 0) {
      search.set(key, value.trim());
    }
  }
  const query = search.toString();
  return requestJson<ClientDuplicateCheck>(
    `/api/v1/clients/duplicate-check${query ? `?${query}` : ''}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

/** QUALIDADE DOS DADOS — apontamentos reais derivados do cadastro persistido. */
export async function getClientDataQuality(
  clientId: string,
  signal?: AbortSignal,
): Promise<ClientDataQuality> {
  return requestJson<ClientDataQuality>(`/api/v1/clients/${clientId}/data-quality`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

/** HIERARQUIA EMPRESARIAL declarada — grupo econômico, matriz e filiais. */
export async function getClientHierarchy(
  clientId: string,
  signal?: AbortSignal,
): Promise<ClientHierarchy> {
  return requestJson<ClientHierarchy>(`/api/v1/clients/${clientId}/hierarchy`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

/**
 * TRILHA DE AUDITORIA do cadastro.
 *
 * Capability própria no servidor (`client:audit:read`): a chamada pode responder 403 mesmo para
 * quem lê o Cliente, e a UI trata isso como seção indisponível — não como erro da página.
 */
export async function getClientAuditTrail(
  clientId: string,
  params: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<ClientAuditTrail> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) {
    search.set('limit', String(params.limit));
  }
  if (params.offset !== undefined) {
    search.set('offset', String(params.offset));
  }
  const query = search.toString();
  return requestJson<ClientAuditTrail>(
    `/api/v1/clients/${clientId}/audit-trail${query ? `?${query}` : ''}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

/* ── comandos de contato ─────────────────────────────────────────────────────────────────── */

export type AddClientContactPayload = {
  version: number;
  name: string;
  purpose: ClientContact['purpose'];
  role?: ContactRole | null;
  email?: string;
  phone?: string;
};

export async function addClientContact(
  clientId: string,
  payload: AddClientContactPayload,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/contacts`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function setClientPrimaryContact(
  clientId: string,
  contactId: string,
  version: number,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/contacts/${contactId}/primary`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
    signal,
  });
}

/** `role: null` REMOVE a atribuição de papel — distinto de omitir, que não altera nada. */
export async function setClientContactRole(
  clientId: string,
  contactId: string,
  role: ContactRole | null,
  version: number,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/contacts/${contactId}/role`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, role }),
    signal,
  });
}

export async function deactivateClientContact(
  clientId: string,
  contactId: string,
  version: number,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/contacts/${contactId}/deactivate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
    signal,
  });
}

export async function reactivateClientContact(
  clientId: string,
  contactId: string,
  version: number,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/contacts/${contactId}/reactivate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
    signal,
  });
}

/** Remoção definitiva do contato. A inativação é o caminho normal; esta é a exceção deliberada. */
export async function removeClientContact(
  clientId: string,
  contactId: string,
  version: number,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/contacts/${contactId}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
    signal,
  });
}

/* ── comandos de unidade ─────────────────────────────────────────────────────────────────── */

export type AddClientUnitPayload = {
  version: number;
  name: string;
  isHeadquarters?: boolean;
  city?: string;
  state?: string;
};

export async function addClientUnit(
  clientId: string,
  payload: AddClientUnitPayload,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/units`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function setClientUnitHeadquarters(
  clientId: string,
  unitId: string,
  version: number,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/units/${unitId}/headquarters`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
    signal,
  });
}

export async function removeClientUnit(
  clientId: string,
  unitId: string,
  version: number,
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/units/${unitId}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
    signal,
  });
}

/* ── hierarquia empresarial ──────────────────────────────────────────────────────────────── */

/**
 * DECLARA O VÍNCULO DE HIERARQUIA.
 *
 * `parentClientId: null` remove o pai; `undefined` (chave ausente) não altera. O mesmo vale para
 * `groupName`. O servidor valida CICLO antes de gravar e responde `CLIENT_HIERARCHY_CYCLE`.
 */
export async function setClientHierarchy(
  clientId: string,
  payload: {
    version: number;
    parentClientId?: string | null;
    groupName?: string | null;
  },
  signal?: AbortSignal,
): Promise<Client> {
  return requestJson<Client>(`/api/v1/clients/${clientId}/hierarchy`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
  /** Capacidades do Customer 360 (migration 0097), cada uma com comando próprio no servidor. */
  canManageContacts: boolean;
  canManageUnits: boolean;
  canManageHierarchy: boolean;
  canReadAudit: boolean;
};

/**
 * DERIVAÇÃO DAS CAPACIDADES DO CUSTOMER 360.
 *
 * As capacidades novas (contato, unidade, hierarquia, auditoria) NÃO ganharam endpoint de sondagem
 * próprio — inventar um seria criar superfície de API só para a UI. A derivação usa o par que o
 * servidor de fato exige EM CONJUNTO para cada comando de escrita: `ClientRead` (sem ele nem o
 * detalhe nem a `version` chegam) + `ClientUpdate` (a capability de escrita do cadastro).
 *
 * `canReadAudit` é OTIMISTA e VERIFICADO NA PRÁTICA: a seção de auditoria desaparece sozinha
 * quando o servidor responde 403 na primeira leitura da trilha. Uma suposição otimista que se
 * corrige é melhor que esconder a seção por precaução — e em nenhum dos casos a UI decide
 * autorização: o servidor continua recusando o que não é permitido.
 */
function deriveCustomer360Capabilities(base: {
  canRead: boolean;
  canUpdate: boolean;
}): Pick<
  ClientCapabilities,
  'canManageContacts' | 'canManageUnits' | 'canManageHierarchy' | 'canReadAudit'
> {
  return {
    canManageContacts: base.canRead && base.canUpdate,
    canManageUnits: base.canRead && base.canUpdate,
    canManageHierarchy: base.canRead && base.canUpdate,
    canReadAudit: base.canRead,
  };
}

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

  return {
    canList,
    canCreate,
    canRead,
    canUpdate,
    canDeactivate,
    canActivate,
    ...deriveCustomer360Capabilities({ canRead, canUpdate }),
  };
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

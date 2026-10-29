import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import type {
  AccessRole,
  ApprovalMatrixInfo,
  ApprovalMatrixRule,
  ApprovalRoleAssignment,
  CapabilityEntry,
  GrantInfo,
  IdentityInfo,
  ResourceEntry,
  RoleAssignment,
  ScopeEntry,
  SodConflict,
} from '../types';

/**
 * Cliente tipado para `/api/v1/authz/access-admin`.
 *
 * Segue o mesmo padrão de `authz-api.ts`: base resolvida via `getApiBaseUrl()`,
 * token de acesso em `Authorization: Bearer`, e uma classe de erro com
 * `status` + `code` para o wrapper de rota distinguir 401 (sessão expirada)
 * de 403 (negado).
 */
export class AccessAdminApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string, message?: string) {
    super(message ?? 'access_admin_error');
    this.status = status;
    this.code = code;
  }
}

type AccessAdminErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
  code?: string;
};

const BASE = '/api/v1/authz/access-admin';
const GRANTS_BASE = '/api/v1/authz/grants';
const APPROVAL_MATRICES_BASE = '/api/v1/authz/approval-matrices';

export type AccessAdminCatalog = {
  capabilities: CapabilityEntry[];
  scopes: ScopeEntry[];
  resources: ResourceEntry[];
};

export type CreateRoleInput = {
  code: string;
  label: string;
  description?: string;
  capabilities: string[];
};

export type UpdateRoleInput = {
  label?: string;
  description?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  capabilities?: string[];
  expectedVersion: number;
};

export type AssignRoleInput = {
  roleCode: string;
  identityId: string;
  scopeType: string;
  scopeAnchor?: string;
};

async function parseError(response: Response): Promise<AccessAdminApiError> {
  let code: string | undefined;
  try {
    const body = (await response.json()) as AccessAdminErrorBody;
    code = body.error?.code ?? body.code;
  } catch {
    // ignore parse errors
  }
  return new AccessAdminApiError(response.status, code);
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new AccessAdminApiError(401, 'AUTH_UNAUTHORIZED', 'session_expired');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

function jsonHeaders(): HeadersInit {
  return { ...authHeaders(), 'Content-Type': 'application/json' };
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
    if (error instanceof AccessAdminApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new AccessAdminApiError(0, undefined, 'network_error');
    }
    throw new AccessAdminApiError(0, undefined, 'unknown_error');
  }
}

/**
 * Sonda o acesso ao módulo. Retorna `true` quando o catálogo pode ser lido,
 * `false` quando negado, e relança o erro em 401 para o wrapper de rota
 * expirar a sessão.
 */
export async function probeAccessAdminAccess(signal?: AbortSignal): Promise<boolean> {
  try {
    await getCatalog(signal);
    return true;
  } catch (error) {
    if (error instanceof AccessAdminApiError && error.status === 401) {
      throw error;
    }
    return false;
  }
}

export async function getCatalog(signal?: AbortSignal): Promise<AccessAdminCatalog> {
  return requestJson<AccessAdminCatalog>(`${BASE}/catalog`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listRoles(signal?: AbortSignal): Promise<AccessRole[]> {
  return requestJson<AccessRole[]>(`${BASE}/roles`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getRole(code: string, signal?: AbortSignal): Promise<AccessRole> {
  return requestJson<AccessRole>(`${BASE}/roles/${encodeURIComponent(code)}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createRole(input: CreateRoleInput): Promise<AccessRole> {
  return requestJson<AccessRole>(`${BASE}/roles`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}

export async function updateRole(code: string, input: UpdateRoleInput): Promise<AccessRole> {
  return requestJson<AccessRole>(`${BASE}/roles/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}

export async function listAssignments(identityId?: string, signal?: AbortSignal): Promise<RoleAssignment[]> {
  const query = identityId ? `?identityId=${encodeURIComponent(identityId)}` : '';
  return requestJson<RoleAssignment[]>(`${BASE}/assignments${query}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function assignRole(input: AssignRoleInput): Promise<RoleAssignment> {
  return requestJson<RoleAssignment>(`${BASE}/assignments`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}

export async function revokeAssignment(id: string): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>(`${BASE}/assignments/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({}),
  });
}

export async function listSodConflicts(signal?: AbortSignal): Promise<SodConflict[]> {
  return requestJson<SodConflict[]>(`${BASE}/sod-conflicts`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export type ListGrantsInput = {
  identityId?: string;
  includeRevoked?: boolean;
};

/**
 * Concessões diretas decididas pelo PDP. `includeRevoked` exige `true` explícito
 * no servidor (o padrão exclui concessões revogadas).
 */
export async function listGrants(
  input: ListGrantsInput = {},
  signal?: AbortSignal,
): Promise<GrantInfo[]> {
  const params = new URLSearchParams();
  if (input.identityId) {
    params.set('identityId', input.identityId);
  }
  if (input.includeRevoked) {
    params.set('includeRevoked', 'true');
  }
  const query = params.toString();
  return requestJson<GrantInfo[]>(`${BASE}/grants${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export type ListIdentitiesInput = {
  query?: string;
  status?: string;
  limit?: number;
};

/** Catálogo de identidades (usuários). O servidor limita e normaliza os filtros. */
export async function listIdentities(
  input: ListIdentitiesInput = {},
  signal?: AbortSignal,
): Promise<IdentityInfo[]> {
  const params = new URLSearchParams();
  if (input.query) {
    params.set('query', input.query);
  }
  if (input.status) {
    params.set('status', input.status);
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  const query = params.toString();
  return requestJson<IdentityInfo[]>(`${BASE}/identities${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

/** Visão geral das matrizes de aprovação (RBAC financeiro). */
export async function listApprovalMatrices(signal?: AbortSignal): Promise<ApprovalMatrixInfo[]> {
  return requestJson<ApprovalMatrixInfo[]>(`${BASE}/approval-matrices`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

/** Regras de uma versão (PUBLISHED ou DRAFT) de uma matriz de aprovação. */
export async function listApprovalMatrixRules(
  matrixId: string,
  versionStatus: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED',
  signal?: AbortSignal,
): Promise<ApprovalMatrixRule[]> {
  return requestJson<ApprovalMatrixRule[]>(
    `${BASE}/approval-matrices/${encodeURIComponent(matrixId)}/rules?versionStatus=${versionStatus}`,
    {
      method: 'GET',
      headers: authHeaders(),
      signal,
    },
  );
}

/** Atribuições de roles de aprovação financeira (opcionalmente por identidade). */
export async function listApprovalRoleAssignments(
  identityId?: string,
  signal?: AbortSignal,
): Promise<ApprovalRoleAssignment[]> {
  const query = identityId ? `?identityId=${encodeURIComponent(identityId)}` : '';
  return requestJson<ApprovalRoleAssignment[]>(`${BASE}/approval-role-assignments${query}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export type CreateGrantInput = {
  identityId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  scopeType: string;
  validUntil?: string;
};

/**
 * Cria uma concessão direta (`POST /authz/grants`). O servidor valida ação,
 * recurso, escopo, self-escalation e a âncora — o cliente apenas envia os códigos.
 */
export async function createGrant(input: CreateGrantInput): Promise<GrantInfo> {
  return requestJson<GrantInfo>(GRANTS_BASE, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}

/** Revoga uma concessão ativa (`POST /authz/grants/:grantId/revoke`). */
export async function revokeGrant(grantId: string): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>(
    `${GRANTS_BASE}/${encodeURIComponent(grantId)}/revoke`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    },
  );
}

export type AssignApprovalRoleInput = {
  identityId: string;
  roleCode: string;
  scopeType: string;
  scopeAnchor?: string;
};

/**
 * Atribui uma role de aprovação financeira (`POST /authz/approval-matrices/role-assignments`).
 * Atribuição duplicada retorna o registro existente (200) — o servidor decide.
 */
export async function assignApprovalRole(
  input: AssignApprovalRoleInput,
): Promise<{ id: string; identityId: string; roleCode: string }> {
  return requestJson<{ id: string; identityId: string; roleCode: string }>(
    `${APPROVAL_MATRICES_BASE}/role-assignments`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(input),
    },
  );
}

/**
 * Organizational UNIT master — distinct from fiscal establishments and from
 * authorization scope_refs. Commands are versioned, idempotent and audited by
 * the existing backend bounded context.
 */
export type OperationalUnitMaster = {
  id: string;
  code: string;
  name: string;
  version: number;
  canManage?: boolean;
};

export type OperationalUnitDirectory = {
  items: OperationalUnitMaster[];
  unconfigured: string[];
  canCreate: boolean;
};

export type OperationalUnitHistory = {
  unit: OperationalUnitMaster;
  events: Array<{
    version: number;
    action: 'CREATED' | 'UPDATED';
    actorIdentityId: string;
    occurredAt: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
};

const UNIT_MASTER_BASE = '/api/v1/organization/operational-units';

export function listOrganizationalUnits(signal?: AbortSignal): Promise<OperationalUnitDirectory> {
  return requestJson<OperationalUnitDirectory>(UNIT_MASTER_BASE, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export function getOrganizationalUnitHistory(id: string, signal?: AbortSignal): Promise<OperationalUnitHistory> {
  return requestJson<OperationalUnitHistory>(
    `${UNIT_MASTER_BASE}/${encodeURIComponent(id)}/history`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

export function createOrganizationalUnit(input: {
  refId?: string;
  code: string;
  name: string;
  idempotencyKey: string;
}): Promise<OperationalUnitMaster> {
  return requestJson<OperationalUnitMaster>(UNIT_MASTER_BASE, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}

export function updateOrganizationalUnit(id: string, input: {
  code?: string;
  name?: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<OperationalUnitMaster> {
  return requestJson<OperationalUnitMaster>(
    `${UNIT_MASTER_BASE}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(input),
    },
  );
}

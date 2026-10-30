/**
 * Contrato de tipos do módulo "Access Administration" (frontend).
 *
 * Estes tipos espelham exatamente o contrato da API
 * `/api/v1/authz/access-admin`. O frontend NÃO decide autoridade:
 * ele apenas envia os códigos escolhidos e exibe o que o servidor retorna.
 */

export type CapabilityKind = 'action' | 'sod' | 'access-admin';

export type CapabilityEntry = {
  code: string;
  kind: CapabilityKind;
  class?: 'ACCESS_ADMIN' | 'FINANCIAL_APPROVAL';
};

export type ScopeEntry = {
  code: string;
  anchored: boolean;
};

export type AccessRole = {
  id: string;
  code: string;
  label: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
};

export type RoleAssignment = {
  id: string;
  identityId: string;
  identityLogin: string | null;
  roleCode: string;
  roleLabel: string;
  scopeType: string;
  scopeAnchor: string | null;
  version: number;
  assignedAt: string;
  revokedAt: string | null;
};

export type SodConflict = {
  identityId: string;
  identityLogin: string | null;
  roleCodes: string[];
  rule: string;
  capabilityA: string;
  capabilityB: string;
  status: 'ACTIVE';
};

export const AccessAdminErrorCodes = {
  DENIED: 'AUTHZ_DENIED',
  NOT_FOUND: 'ACCESS_ADMIN_NOT_FOUND',
  CONFLICT: 'ACCESS_ADMIN_CONFLICT',
  VERSION_CONFLICT: 'ACCESS_ADMIN_VERSION_CONFLICT',
  SELF_ESCALATION: 'ACCESS_ADMIN_SELF_ESCALATION',
  ESCALATION: 'ACCESS_ADMIN_ESCALATION',
  SOD_CONFLICT: 'ACCESS_ADMIN_SOD_CONFLICT',
  VALIDATION_FAILED: 'AUTHZ_VALIDATION_FAILED',
} as const;

/**
 * Recurso do catálogo servidor (GET /catalog → resources).
 * Cada código é um resourceType aceito pelo servidor; o cliente nunca cria códigos.
 */
export type ResourceEntry = {
  code: string;
};

/**
 * Concessão direta decidida pelo PDP (`/authz/access-admin/grants`).
 * `resourceId` é a âncora do escopo (null para escopos não ancorados, ex.: GLOBAL).
 */
export type GrantInfo = {
  id: string;
  identityId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  scopeType: string;
  version: number;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
};

/**
 * Identidade (usuário) do catálogo de identidades do servidor
 * (`/authz/access-admin/identities`).
 */
export type IdentityInfo = {
  id: string;
  login: string | null;
  status: string;
  disabledAt: string | null;
  createdAt: string;
};

/**
 * Visão geral de matriz de aprovação (RBAC financeiro)
 * (`/authz/access-admin/approval-matrices`).
 */
export type ApprovalMatrixInfo = {
  id: string;
  code: string;
  currencyCode: string;
  publishedVersion: number | null;
  draftVersion: number;
  publishedVersions: number;
  draftVersions: number;
};

/**
 * Regra de matriz de aprovação de uma versão PUBLISHED ou DRAFT
 * (`/authz/access-admin/approval-matrices/:matrixId/rules`).
 */
export type ApprovalMatrixRule = {
  id: string;
  operation: string;
  roleCode: string;
  capability: string;
  scopeType: string;
  scopeAnchor: string | null;
  amountLimit: string;
  lineNumber: number;
};

/**
 * Atribuição de role de aprovação financeira
 * (`/authz/access-admin/approval-role-assignments`).
 */
export type ApprovalRoleAssignment = {
  id: string;
  identityId: string;
  identityLogin: string | null;
  roleCode: string;
  scopeType: string;
  scopeAnchor: string | null;
  version: number;
  createdAt: string;
};

/** Server-owned SoD-007 exception: an approval does not create a role or grant. */
export type SodException = {
  id: string;
  ruleId: 'SOD-007';
  subjectIdentityId: string;
  scopeType: string;
  scopeAnchor: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REVOKED';
  requestedByIdentityId: string;
  requestedAt: string;
  approvedByIdentityId: string | null;
  approvedAt: string | null;
  revokedByIdentityId: string | null;
  revokedAt: string | null;
};

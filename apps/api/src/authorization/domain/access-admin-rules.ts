import { AUTHZ_ACTIONS } from '../types/authz-actions';
import {
  AUTHZ_SCOPES,
  ANCHORED_SCOPE_TYPES,
  isAuthzScopeType,
  type AuthzScopeType,
} from '../types/authz-scopes';
import { SOD_CAPABILITIES } from './segregation-of-duties';

/**
 * ACCESS ADMINISTRATION — regras puras de configuracao de acesso.
 *
 * Interpretacao de engenharia (nao regra empresarial confirmada):
 * o frontend nunca decide autoridade; toda mutacao passa pelo backend,
 * e' auditada e nao pode materializar conflito critico de seguranca.
 * Os pares SOD-007 / SOD-012 estao CANDIDATE na documentacao
 * (docs/09-authorization/segregation-of-duties-matrix.md) — o guard abaixo
 * aplica SOD-007 como protecao de engenharia da propria camada de acesso;
 * SOD-012 permanece ADVISORY enquanto DDP-015 estiver aberto.
 */

export const ACCESS_ADMIN_ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
export const ACCESS_ADMIN_ROLE_LABEL_MAX = 120;
export const ACCESS_ADMIN_ROLE_DESCRIPTION_MAX = 500;
export const ACCESS_ADMIN_MAX_CAPABILITIES_PER_ROLE = 200;

export const ACCESS_ADMIN_CLASS = 'ACCESS_ADMIN';
export const FINANCIAL_APPROVAL_CLASS = 'FINANCIAL_APPROVAL';

export type AccessAdminCapabilityKind = 'action' | 'sod' | 'access-admin';
export type AccessAdminCapabilityClass =
  | typeof ACCESS_ADMIN_CLASS
  | typeof FINANCIAL_APPROVAL_CLASS;

export type AccessAdminCapabilityCatalogEntry = {
  code: string;
  kind: AccessAdminCapabilityKind;
  class?: AccessAdminCapabilityClass;
};

/**
 * Capacidades de administracao de acesso (SOD-007 lado A). Nunca confundir
 * com papeis empresariais: sao acoes tecnicas de meta-administracao.
 */
export const ACCESS_ADMIN_CAPABILITIES: ReadonlySet<string> = new Set([
  AUTHZ_ACTIONS.GrantCreate,
  AUTHZ_ACTIONS.GrantRevoke,
  AUTHZ_ACTIONS.GrantList,
  AUTHZ_ACTIONS.AccessAdminRead,
  AUTHZ_ACTIONS.AccessAdminManage,
]);

/**
 * Capacidades de aprovacao financeira (SOD-007 lado B): capabilities de duty
 * do catalogo SOD (approvals) — a mesma identidade nao pode acumular o lado A
 * (administrar acesso) com o lado B (praticar/aprovar ato financeiro) no mesmo
 * escopo efetivo.
 */
export const FINANCIAL_APPROVAL_CAPABILITIES: ReadonlySet<string> = new Set([
  SOD_CAPABILITIES.PurchaseApprove,
  SOD_CAPABILITIES.ExpenseApprove,
  SOD_CAPABILITIES.PaymentApprove,
  SOD_CAPABILITIES.ReconciliationConfirm,
  SOD_CAPABILITIES.AdjustmentApprove,
  SOD_CAPABILITIES.ReopenApprove,
  SOD_CAPABILITIES.TaxFinalize,
  SOD_CAPABILITIES.PayrollClose,
  SOD_CAPABILITIES.BudgetApprove,
  SOD_CAPABILITIES.TreasuryTransfer,
  SOD_CAPABILITIES.TreasuryReverse,
]);

export type AccessAdminSodRuleId = 'SOD-007';

export type AccessAdminSodRule = {
  id: AccessAdminSodRuleId;
  classA: typeof ACCESS_ADMIN_CLASS;
  classB: typeof FINANCIAL_APPROVAL_CLASS;
  status: 'ENGINEERING_GUARD' | 'ADVISORY';
  sources: string[];
};

/**
 * Somente SOD-007 e' guard de configuracao (ENGINEERING_GUARD).
 * SOD-012 (admin tecnico x autorizador empresarial) permanece ADVISORY —
 * DDP-015 aberto.
 */
export const ACCESS_ADMIN_SOD_RULES: Readonly<AccessAdminSodRule[]> = [
  {
    id: 'SOD-007',
    classA: ACCESS_ADMIN_CLASS,
    classB: FINANCIAL_APPROVAL_CLASS,
    status: 'ENGINEERING_GUARD',
    sources: ['SOD-007', 'SEC-REQ-020', 'DDP-015'],
  },
];

export class AccessAdminRuleError extends Error {
  constructor(
    readonly code:
      | 'INVALID_ROLE_CODE'
      | 'INVALID_LABEL'
      | 'INVALID_DESCRIPTION'
      | 'UNKNOWN_CAPABILITY'
      | 'DUPLICATE_CAPABILITY'
      | 'EMPTY_CAPABILITIES'
      | 'CAPABILITY_LIMIT'
      | 'INVALID_SCOPE'
      | 'SCOPE_NOT_ASSIGNABLE'
      | 'VERSION_CONFLICT'
      | 'SOD_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'AccessAdminRuleError';
  }
}

export type CapabilityWithScope = {
  capability: string;
  scopeType: AuthzScopeType;
  scopeAnchor: string | null;
};

export type SodConflictFinding = {
  ruleId: AccessAdminSodRuleId;
  capabilityA: string;
  capabilityB: string;
};

export function assertAccessRoleCode(code: string): void {
  if (!ACCESS_ADMIN_ROLE_CODE_PATTERN.test(code)) {
    throw new AccessAdminRuleError(
      'INVALID_ROLE_CODE',
      'Role code must match ^[A-Z][A-Z0-9_]{2,63}$ and never a person name.',
    );
  }
}

export function assertAccessRoleLabel(label: string): void {
  const trimmed = label?.trim() ?? '';
  if (trimmed.length < 1 || trimmed.length > ACCESS_ADMIN_ROLE_LABEL_MAX) {
    throw new AccessAdminRuleError(
      'INVALID_LABEL',
      `Role label must be 1..${ACCESS_ADMIN_ROLE_LABEL_MAX} characters.`,
    );
  }
}

export function assertAccessRoleDescription(description: unknown): void {
  if (description === undefined) {
    return;
  }
  if (typeof description !== 'string' || description.length > ACCESS_ADMIN_ROLE_DESCRIPTION_MAX) {
    throw new AccessAdminRuleError(
      'INVALID_DESCRIPTION',
      `Role description must be a string up to ${ACCESS_ADMIN_ROLE_DESCRIPTION_MAX} characters.`,
    );
  }
}

export function capabilityClassOf(code: string): AccessAdminCapabilityClass | undefined {
  if (ACCESS_ADMIN_CAPABILITIES.has(code)) {
    return ACCESS_ADMIN_CLASS;
  }
  if (FINANCIAL_APPROVAL_CAPABILITIES.has(code)) {
    return FINANCIAL_APPROVAL_CLASS;
  }
  return undefined;
}

export function capabilityKindOf(code: string): AccessAdminCapabilityKind | undefined {
  const actionValues = new Set<string>(Object.values(AUTHZ_ACTIONS));
  const sodValues = new Set<string>(Object.values(SOD_CAPABILITIES));
  if (actionValues.has(code)) {
    return code.startsWith('authz:') ? 'access-admin' : 'action';
  }
  if (sodValues.has(code)) {
    return 'sod';
  }
  return undefined;
}

export function buildCapabilityCatalog(): AccessAdminCapabilityCatalogEntry[] {
  const byCode = new Map<string, AccessAdminCapabilityCatalogEntry>();
  for (const code of Object.values(AUTHZ_ACTIONS)) {
    byCode.set(code, { code, kind: code.startsWith('authz:') ? 'access-admin' : 'action' });
  }
  for (const code of Object.values(SOD_CAPABILITIES)) {
    byCode.set(code, { code, kind: 'sod' });
  }
  const entries: AccessAdminCapabilityCatalogEntry[] = [];
  for (const code of [...byCode.keys()].sort()) {
    const entry = byCode.get(code);
    if (!entry) {
      continue;
    }
    const capabilityClass = capabilityClassOf(code);
    entries.push(capabilityClass ? { ...entry, class: capabilityClass } : entry);
  }
  return entries;
}

export function isKnownCapability(code: string): boolean {
  return capabilityKindOf(code) !== undefined;
}

export function assertRoleCapabilities(capabilities: string[]): void {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw new AccessAdminRuleError('EMPTY_CAPABILITIES', 'Role must declare at least one capability.');
  }
  if (capabilities.length > ACCESS_ADMIN_MAX_CAPABILITIES_PER_ROLE) {
    throw new AccessAdminRuleError(
      'CAPABILITY_LIMIT',
      `Role cannot exceed ${ACCESS_ADMIN_MAX_CAPABILITIES_PER_ROLE} capabilities.`,
    );
  }
  const seen = new Set<string>();
  for (const capability of capabilities) {
    if (typeof capability !== 'string' || capability.length === 0) {
      throw new AccessAdminRuleError('UNKNOWN_CAPABILITY', 'Invalid capability value.');
    }
    if (seen.has(capability)) {
      throw new AccessAdminRuleError('DUPLICATE_CAPABILITY', `Duplicate capability ${capability}.`);
    }
    seen.add(capability);
    if (!isKnownCapability(capability)) {
      throw new AccessAdminRuleError(
        'UNKNOWN_CAPABILITY',
        `Capability ${capability} is not in the server catalog.`,
      );
    }
  }
}

export const ASSIGNABLE_SCOPE_TYPES: ReadonlySet<AuthzScopeType> = new Set<AuthzScopeType>([
  AUTHZ_SCOPES.Global,
  AUTHZ_SCOPES.Unit,
  AUTHZ_SCOPES.Client,
  AUTHZ_SCOPES.Contract,
  AUTHZ_SCOPES.Document,
  AUTHZ_SCOPES.Financial,
]);

export function assertAssignableScope(scopeType: string): AuthzScopeType {
  if (!isAuthzScopeType(scopeType)) {
    throw new AccessAdminRuleError('INVALID_SCOPE', 'Unknown scope type.');
  }
  if (!ASSIGNABLE_SCOPE_TYPES.has(scopeType)) {
    throw new AccessAdminRuleError(
      'SCOPE_NOT_ASSIGNABLE',
      'Scope type is not assignable to an access role.',
    );
  }
  return scopeType;
}

export function isAnchoredScope(scopeType: AuthzScopeType): boolean {
  return ANCHORED_SCOPE_TYPES.has(scopeType);
}

export function assertExpectedVersion(expectedVersion: number | undefined): void {
  if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new AccessAdminRuleError('VERSION_CONFLICT', 'expectedVersion is required (integer >= 1).');
  }
}

/**
 * Um escopo cobre outro quando (a) e GLOBAL (cobre qualquer escopo) ou
 * (b) mesmo tipo e mesma ancora. Sem hierarquia entre ancoras diferentes.
 */
export function scopeCovers(
  scopeA: { scopeType: AuthzScopeType; scopeAnchor: string | null },
  scopeB: { scopeType: AuthzScopeType; scopeAnchor: string | null },
): boolean {
  if (scopeA.scopeType === AUTHZ_SCOPES.Global) {
    return true;
  }
  if (scopeB.scopeType === AUTHZ_SCOPES.Global) {
    return false;
  }
  return scopeA.scopeType === scopeB.scopeType && scopeA.scopeAnchor === scopeB.scopeAnchor;
}

export function findSodConflicts(capabilities: CapabilityWithScope[]): SodConflictFinding[] {
  const findings: SodConflictFinding[] = [];
  for (const rule of ACCESS_ADMIN_SOD_RULES) {
    if (rule.status !== 'ENGINEERING_GUARD') {
      continue;
    }
    const a = capabilities.filter(
      (item) => capabilityClassOf(item.capability) === rule.classA,
    );
    const b = capabilities.filter(
      (item) => capabilityClassOf(item.capability) === rule.classB,
    );
    for (const left of a) {
      for (const right of b) {
        if (scopeCovers(left, right) || scopeCovers(right, left)) {
          findings.push({
            ruleId: rule.id,
            capabilityA: left.capability,
            capabilityB: right.capability,
          });
          return findings;
        }
      }
    }
  }
  return findings;
}

export function assertNoSodConflict(capabilities: CapabilityWithScope[]): void {
  const findings = findSodConflicts(capabilities);
  if (findings.length > 0) {
    const finding = findings[0]!;
    throw new AccessAdminRuleError(
      'SOD_CONFLICT',
      `Configuration would violate ${finding.ruleId} (${finding.capabilityA} x ${finding.capabilityB}).`,
    );
  }
}

export function normalizeRoleCode(input: string): string {
  const code = input?.trim() ?? '';
  assertAccessRoleCode(code);
  return code;
}

/** Lista de capacidades da classe de administracao de acesso (para UI/report). */
export function listAccessAdminSodRules(): AccessAdminSodRule[] {
  return [...ACCESS_ADMIN_SOD_RULES];
}

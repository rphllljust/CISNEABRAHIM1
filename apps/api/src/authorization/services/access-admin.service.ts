import { HttpStatus, Injectable } from '@nestjs/common';
import { AUTHZ_ACTIONS, type AuthzAction } from '../types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../types/authz-resources';
import { AUTHZ_SCOPES, type AuthzScopeType } from '../types/authz-scopes';
import { AUTHZ_ERROR_CODES } from '../errors/authz-error-codes';
import { AuthzHttpException } from '../errors/authz-http.exception';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { PolicyDecisionPointService } from './policy-decision-point.service';
import { AccessAdminRepository } from '../repositories/access-admin.repository';
import { AuthorizationRepository } from '../repositories/authorization.repository';
import { ApprovalMatrixRepository } from '../repositories/approval-matrix.repository';
import { ScopeContextRepository } from '../repositories/scope-context.repository';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import type { IdentityAuthzContext } from '../types/authz-decision';
import {
  AccessAdminRuleError,
  buildCapabilityCatalog,
  assertAccessRoleCode,
  assertAccessRoleDescription,
  assertAccessRoleLabel,
  assertAssignableScope,
  assertExpectedVersion,
  assertNoSodConflict,
  assertRoleCapabilities,
  findSodConflicts,
  isAnchoredScope,
  type CapabilityWithScope,
} from '../domain/access-admin-rules';
import type {
  CreateAccessRoleCommand,
  UpdateAccessRoleCommand,
  AssignAccessRoleCommand,
} from '../dto/access-admin.dto';
import {
  toAccessAssignmentResponse,
  toAccessRoleResponse,
  type AccessAdminSodConflictResponseV1,
  type AccessRoleResponseV1,
} from '../serializers/access-admin-response.serializer';
import { toGrantResponse } from '../serializers/grant-response.serializer';
import type { AccessAssignmentRow, AccessRoleRow } from '../repositories/access-admin.repository';
import type { GrantRow } from '../repositories/authorization.repository';

const ALLOWED_SCOPE_KEYS = new Set<string>([
  ...Object.values(AUTHZ_SCOPES),
]);

@Injectable()
export class AccessAdminService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly repository: AccessAdminRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly approvalMatrixRepository: ApprovalMatrixRepository,
    private readonly scopeContextRepository: ScopeContextRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  private async assertAllowed(actor: IdentityAuthzContext, action: AuthzAction): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(actor, {
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
    });
    if (decision.result === 'DENY') {
      throw new AuthzHttpException(
        HttpStatus.FORBIDDEN,
        AUTHZ_ERROR_CODES.DENIED,
        'Access denied.',
      );
    }
  }

  async catalog(actor: IdentityAuthzContext) {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminRead);
    const scopes = [...ALLOWED_SCOPE_KEYS].map((code) => ({
      code,
      anchored: isAnchoredScope(code as AuthzScopeType),
    }));
    const resources = [...Object.values(AUTHZ_RESOURCE_TYPES)].map((code) => ({ code })).sort(
      (left, right) => left.code.localeCompare(right.code),
    );
    return { capabilities: buildCapabilityCatalog(), scopes, resources };
  }

  async listGrants(
    actor: IdentityAuthzContext,
    identityId?: string,
    includeRevoked = false,
  ) {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminRead);
    const grants = await this.authorizationRepository.listGrants(
      identityId?.trim() ? identityId.trim() : undefined,
      includeRevoked,
    );
    return grants.map((grant: GrantRow) => toGrantResponse(grant));
  }

  async listIdentities(
    actor: IdentityAuthzContext,
    filters: { query?: string; status?: string; limit?: number },
  ) {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminRead);
    const status = filters.status as 'active' | 'disabled' | 'locked' | undefined;
    return this.authorizationRepository.listIdentities({
      query: filters.query,
      status,
      limit: filters.limit,
    });
  }

  async approvalMatrices(actor: IdentityAuthzContext) {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminRead);
    return this.approvalMatrixRepository.listMatricesOverview();
  }

  async approvalMatrixRules(
    actor: IdentityAuthzContext,
    matrixId: string,
    status: 'PUBLISHED' | 'DRAFT',
  ) {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminRead);
    return this.approvalMatrixRepository.listMatrixVersionRules(matrixId, status);
  }

  async approvalRoleAssignments(actor: IdentityAuthzContext, identityId?: string) {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminRead);
    return this.approvalMatrixRepository.listApprovalRoleAssignments(
      identityId?.trim() ? identityId.trim() : undefined,
    );
  }

  async listRoles(actor: IdentityAuthzContext): Promise<AccessRoleResponseV1[]> {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminRead);
    const roles = await this.repository.listRoles();
    const capabilitiesByRole = await this.groupCapabilitiesByRole();
    return roles.map((role) =>
      toAccessRoleResponse(role, capabilitiesByRole.get(role.id) ?? []),
    );
  }

  async getRole(actor: IdentityAuthzContext, code: string): Promise<AccessRoleResponseV1> {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminRead);
    const role = await this.repository.getRoleByCode(code);
    if (!role) {
      throw new AuthzHttpException(
        HttpStatus.NOT_FOUND,
        AUTHZ_ERROR_CODES.ACCESS_ADMIN_NOT_FOUND,
        'Access role not found.',
      );
    }
    const capabilities = await this.roleCapabilities(role.id);
    return toAccessRoleResponse(role, capabilities);
  }

  async createRole(
    actor: IdentityAuthzContext,
    command: CreateAccessRoleCommand,
  ): Promise<AccessRoleResponseV1> {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminManage);
    try {
      assertAccessRoleCode(command.code);
      assertAccessRoleLabel(command.label);
      assertAccessRoleDescription(command.description);
      assertRoleCapabilities(command.capabilities);
    } catch (error) {
      throw mapRuleError(error);
    }

    if (await this.repository.roleCodeExists(command.code)) {
      throw new AuthzHttpException(
        HttpStatus.CONFLICT,
        AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT,
        'Access role code already exists.',
      );
    }

    const pool = this.databaseService.getConnection()?.pool;
    if (!pool) {
      throw new Error('DATABASE_URL is not configured.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const role = await this.repository.createRoleWithCapabilities(client, {
        code: command.code,
        label: command.label,
        description: command.description?.trim() ?? '',
        capabilities: [...new Set(command.capabilities)],
        createdByIdentityId: actor.identityId,
      });
      await client.query('COMMIT');
      await this.securityAudit.recordCritical({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.AccessAdminRoleCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.AccessRole,
        resourceId: role.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
        metadata: { role_code: role.code },
      });
      return toAccessRoleResponse(role, [...new Set(command.capabilities)].sort());
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateRole(
    actor: IdentityAuthzContext,
    code: string,
    command: UpdateAccessRoleCommand,
  ): Promise<AccessRoleResponseV1> {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminManage);
    const current = await this.repository.getRoleByCode(code);
    if (!current) {
      throw new AuthzHttpException(
        HttpStatus.NOT_FOUND,
        AUTHZ_ERROR_CODES.ACCESS_ADMIN_NOT_FOUND,
        'Access role not found.',
      );
    }
    try {
      assertExpectedVersion(command.expectedVersion);
      if (command.label !== undefined) {
        assertAccessRoleLabel(command.label);
      }
      if (command.description !== undefined) {
        assertAccessRoleDescription(command.description);
      }
      if (command.capabilities !== undefined) {
        assertRoleCapabilities(command.capabilities);
      }
    } catch (error) {
      throw mapRuleError(error);
    }

    const pool = this.databaseService.getConnection()?.pool;
    if (!pool) {
      throw new Error('DATABASE_URL is not configured.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await this.repository.updateRoleFieldsAndBumpVersion(
        client,
        code,
        command.expectedVersion,
        {
          label: command.label,
          description: command.description,
          status: command.status,
          updatedByIdentityId: actor.identityId,
        },
      );
      if (!updated) {
        throw new AuthzHttpException(
          HttpStatus.CONFLICT,
          AUTHZ_ERROR_CODES.ACCESS_ADMIN_VERSION_CONFLICT,
          'Role was modified by another administrator. Reload and retry.',
        );
      }
      if (command.capabilities !== undefined) {
        await this.repository.replaceRoleCapabilities(
          client,
          updated.id,
          [...new Set(command.capabilities)],
          actor.identityId,
        );
      }
      await client.query('COMMIT');

      const auditAction =
        command.status === 'INACTIVE'
          ? SECURITY_AUDIT_ACTIONS.AccessAdminRoleDeactivate
          : command.status === 'ACTIVE'
            ? SECURITY_AUDIT_ACTIONS.AccessAdminRoleActivate
            : SECURITY_AUDIT_ACTIONS.AccessAdminRoleUpdate;
      await this.securityAudit.recordCritical({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: auditAction,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.AccessRole,
        resourceId: updated.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
        metadata: { role_code: updated.code, version: updated.version },
      });
      const capabilities = await this.roleCapabilities(updated.id);
      return toAccessRoleResponse(updated, capabilities);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listAssignments(actor: IdentityAuthzContext, identityId?: string) {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminRead);
    const rows = await this.repository.listActiveAssignments(identityId);
    return rows.map(toAccessAssignmentResponse);
  }

  async assignRole(
    actor: IdentityAuthzContext,
    command: AssignAccessRoleCommand,
  ) {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminManage);

    if (command.identityId === actor.identityId) {
      throw new AuthzHttpException(
        HttpStatus.FORBIDDEN,
        AUTHZ_ERROR_CODES.ACCESS_ADMIN_SELF_ESCALATION,
        'Self-assignment is forbidden.',
      );
    }

    let scopeType: AuthzScopeType;
    let scopeAnchor: string | null;
    try {
      scopeType = assertAssignableScope(command.scopeType);
      scopeAnchor = command.scopeAnchor?.trim() || null;
      if (isAnchoredScope(scopeType) && !scopeAnchor) {
        throw new AccessAdminRuleError('INVALID_SCOPE', 'Anchored scope requires scopeAnchor.');
      }
      if (scopeType === AUTHZ_SCOPES.Global && scopeAnchor) {
        throw new AccessAdminRuleError('INVALID_SCOPE', 'GLOBAL scope cannot include scopeAnchor.');
      }
    } catch (error) {
      throw mapRuleError(error);
    }

    const role = await this.repository.getRoleByCode(command.roleCode);
    if (!role) {
      throw new AuthzHttpException(
        HttpStatus.NOT_FOUND,
        AUTHZ_ERROR_CODES.ACCESS_ADMIN_NOT_FOUND,
        'Access role not found.',
      );
    }
    if (role.status !== 'ACTIVE') {
      throw new AuthzHttpException(
        HttpStatus.CONFLICT,
        AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT,
        'Access role is inactive.',
      );
    }
    if (!(await this.repository.identityExists(command.identityId))) {
      throw new AuthzHttpException(
        HttpStatus.BAD_REQUEST,
        AUTHZ_ERROR_CODES.VALIDATION_FAILED,
        'Invalid identity.',
      );
    }
    if (
      isAnchoredScope(scopeType) &&
      !(await this.scopeContextRepository.scopeRefExists(scopeType, scopeAnchor as string))
    ) {
      throw new AuthzHttpException(
        HttpStatus.BAD_REQUEST,
        AUTHZ_ERROR_CODES.VALIDATION_FAILED,
        'Scope reference not found.',
      );
    }
    const existing = await this.repository.getActiveAssignment(
      command.identityId,
      role.id,
      scopeType,
      scopeAnchor,
    );
    if (existing) {
      throw new AuthzHttpException(
        HttpStatus.CONFLICT,
        AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT,
        'Assignment already exists.',
      );
    }

    const prospective = await this.buildIdentityCapabilitySet(command.identityId, role, scopeType, scopeAnchor);
    try {
      assertNoSodConflict(prospective);
    } catch (error) {
      throw mapRuleError(error);
    }

    const pool = this.databaseService.getConnection()?.pool;
    if (!pool) {
      throw new Error('DATABASE_URL is not configured.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.repository.insertAssignment(client, {
        roleId: role.id,
        identityId: command.identityId,
        scopeType,
        scopeAnchor,
        assignedByIdentityId: actor.identityId,
      });
      await client.query('COMMIT');
      await this.securityAudit.recordCritical({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.AccessAdminAssign,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.AccessAssignment,
        resourceId: row.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        scopeType,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
        metadata: {
          target_identity_id: command.identityId,
          role_code: role.code,
          scope_anchor: scopeAnchor,
        },
      });
      const inserted = await this.repository.getAssignmentById(row.id);
      if (!inserted) {
        throw new Error('assignment not found after insert');
      }
      return toAccessAssignmentResponse(inserted);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeAssignment(
    actor: IdentityAuthzContext,
    assignmentId: string,
  ): Promise<{ success: true }> {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminManage);
    const row = await this.repository.getAssignmentById(assignmentId);
    if (!row || row.revoked_at) {
      throw new AuthzHttpException(
        HttpStatus.NOT_FOUND,
        AUTHZ_ERROR_CODES.ACCESS_ADMIN_NOT_FOUND,
        'Assignment not found.',
      );
    }
    const pool = this.databaseService.getConnection()?.pool;
    if (!pool) {
      throw new Error('DATABASE_URL is not configured.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const revoked = await this.repository.revokeAssignment(
        client,
        assignmentId,
        actor.identityId,
      );
      await client.query('COMMIT');
      if (!revoked) {
        throw new AuthzHttpException(
          HttpStatus.NOT_FOUND,
          AUTHZ_ERROR_CODES.ACCESS_ADMIN_NOT_FOUND,
          'Assignment not found.',
        );
      }
      await this.securityAudit.recordCritical({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.AccessAdminAssignmentRevoke,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.AccessAssignment,
        resourceId: assignmentId,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
        metadata: { target_identity_id: row.identity_id, role_code: row.role_code },
      });
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async sodConflicts(actor: IdentityAuthzContext): Promise<AccessAdminSodConflictResponseV1[]> {
    await this.assertAllowed(actor, AUTHZ_ACTIONS.AccessAdminRead);
    const assignments = await this.repository.listActiveAssignments();
    if (assignments.length === 0) {
      return [];
    }
    const capabilitiesByRole = await this.groupCapabilitiesByRole();
    const byIdentity = new Map<string, AccessAssignmentRow[]>();
    for (const row of assignments) {
      const list = byIdentity.get(row.identity_id) ?? [];
      list.push(row);
      byIdentity.set(row.identity_id, list);
    }
    const conflicts: AccessAdminSodConflictResponseV1[] = [];
    for (const [identityId, rows] of byIdentity) {
      const effective: CapabilityWithScope[] = [];
      for (const row of rows) {
        for (const capability of capabilitiesByRole.get(row.role_id) ?? []) {
          effective.push({
            capability,
            scopeType: row.scope_type,
            scopeAnchor: row.scope_anchor,
          });
        }
      }
      for (const finding of findSodConflicts(effective)) {
        conflicts.push({
          identityId,
          identityLogin: rows[0]?.identity_login ?? null,
          roleCodes: [...new Set(rows.map((row) => row.role_code))],
          rule: finding.ruleId,
          capabilityA: finding.capabilityA,
          capabilityB: finding.capabilityB,
          status: 'ACTIVE',
        });
      }
    }
    return conflicts;
  }

  private async groupCapabilitiesByRole(): Promise<Map<string, string[]>> {
    const caps = await this.repository.listRoleCapabilities();
    const map = new Map<string, string[]>();
    for (const row of caps) {
      const list = map.get(row.role_id) ?? [];
      list.push(row.capability);
      map.set(row.role_id, list);
    }
    return map;
  }

  private async roleCapabilities(roleId: string): Promise<string[]> {
    const caps = await this.repository.listRoleCapabilities();
    return caps.filter((row) => row.role_id === roleId).map((row) => row.capability).sort();
  }

  private async buildIdentityCapabilitySet(
    identityId: string,
    newRole: AccessRoleRow,
    scopeType: AuthzScopeType,
    scopeAnchor: string | null,
  ): Promise<CapabilityWithScope[]> {
    const capabilitiesByRole = await this.groupCapabilitiesByRole();
    const effective: CapabilityWithScope[] = [];
    const assignments = await this.repository.listActiveAssignments(identityId);
    for (const row of assignments) {
      for (const capability of capabilitiesByRole.get(row.role_id) ?? []) {
        effective.push({
          capability,
          scopeType: row.scope_type,
          scopeAnchor: row.scope_anchor,
        });
      }
    }
    for (const capability of capabilitiesByRole.get(newRole.id) ?? []) {
      effective.push({ capability, scopeType, scopeAnchor });
    }
    return effective;
  }
}

function mapRuleError(error: unknown): AuthzHttpException {
  if (error instanceof AuthzHttpException) {
    return error;
  }
  if (error instanceof AccessAdminRuleError) {
    if (error.code === 'VERSION_CONFLICT') {
      return new AuthzHttpException(
        HttpStatus.CONFLICT,
        AUTHZ_ERROR_CODES.ACCESS_ADMIN_VERSION_CONFLICT,
        'Role was modified by another administrator. Reload and retry.',
      );
    }
    if (error.code === 'SOD_CONFLICT') {
      return new AuthzHttpException(
        HttpStatus.FORBIDDEN,
        AUTHZ_ERROR_CODES.ACCESS_ADMIN_SOD_CONFLICT,
        error.message,
      );
    }
    return new AuthzHttpException(
      HttpStatus.BAD_REQUEST,
      AUTHZ_ERROR_CODES.VALIDATION_FAILED,
      error.message,
    );
  }
  return new AuthzHttpException(
    HttpStatus.BAD_REQUEST,
    AUTHZ_ERROR_CODES.VALIDATION_FAILED,
    'Invalid request.',
  );
}

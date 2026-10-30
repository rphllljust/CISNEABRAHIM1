import { HttpStatus, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { IdentityAuthzContext } from '../types/authz-decision';
import { AUTHZ_ACTIONS, type AuthzAction } from '../types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../types/authz-resources';
import { AUTHZ_SCOPES, type AuthzScopeType } from '../types/authz-scopes';
import { AuthzHttpException } from '../errors/authz-http.exception';
import { AUTHZ_ERROR_CODES } from '../errors/authz-error-codes';
import { ScopeContextRepository } from '../repositories/scope-context.repository';
import { PolicyDecisionPointService } from './policy-decision-point.service';
import { assertAssignableScope, isAnchoredScope } from '../domain/access-admin-rules';

export const SOD_EXCEPTION_APPROVER_LOGIN = 'rafael@cisne.invalid';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ExceptionRow = {
  id: string;
  rule_id: 'SOD-007';
  subject_identity_id: string;
  scope_type: AuthzScopeType;
  scope_anchor: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REVOKED';
  requested_by_identity_id: string;
  requested_at: string;
  approved_by_identity_id: string | null;
  approved_at: string | null;
  revoked_by_identity_id: string | null;
  revoked_at: string | null;
};
export type SodExceptionView = {
  id: string;
  ruleId: 'SOD-007';
  subjectIdentityId: string;
  scopeType: AuthzScopeType;
  scopeAnchor: string | null;
  reason: string;
  status: ExceptionRow['status'];
  requestedByIdentityId: string;
  requestedAt: string;
  approvedByIdentityId: string | null;
  approvedAt: string | null;
  revokedByIdentityId: string | null;
  revokedAt: string | null;
};
function view(row: ExceptionRow): SodExceptionView {
  return {
    id: row.id, ruleId: row.rule_id, subjectIdentityId: row.subject_identity_id,
    scopeType: row.scope_type, scopeAnchor: row.scope_anchor, reason: row.reason,
    status: row.status, requestedByIdentityId: row.requested_by_identity_id,
    requestedAt: row.requested_at, approvedByIdentityId: row.approved_by_identity_id,
    approvedAt: row.approved_at, revokedByIdentityId: row.revoked_by_identity_id,
    revokedAt: row.revoked_at,
  };
}
function deny(code: string, message: string, status = HttpStatus.FORBIDDEN): never {
  throw new AuthzHttpException(status, code, message);
}
function validId(value: string): string {
  if (!UUID.test(value)) {
    return deny(AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Invalid UUID.', HttpStatus.BAD_REQUEST);
  }
  return value;
}
type RequestInput = {
  subjectIdentityId: string;
  scopeType: AuthzScopeType;
  scopeAnchor: string | null;
  reason: string;
};
function parseRequest(raw: unknown): RequestInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return deny(AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Invalid request.', HttpStatus.BAD_REQUEST);
  }
  const object = raw as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.some((key) => !['subjectIdentityId', 'scopeType', 'scopeAnchor', 'reason', 'ruleId'].includes(key))
    || (object['ruleId'] !== undefined && object['ruleId'] !== 'SOD-007')) {
    return deny(AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Unsupported SoD exception.', HttpStatus.BAD_REQUEST);
  }
  const subjectIdentityId = typeof object['subjectIdentityId'] === 'string'
    ? validId(object['subjectIdentityId']) : deny(AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Identity is required.', HttpStatus.BAD_REQUEST);
  const scopeType = typeof object['scopeType'] === 'string'
    ? object['scopeType'] : '';
  let scope: AuthzScopeType;
  try {
    scope = assertAssignableScope(scopeType);
  } catch {
    return deny(AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Invalid exception scope.', HttpStatus.BAD_REQUEST);
  }
  const scopeAnchor = typeof object['scopeAnchor'] === 'string' ? object['scopeAnchor'].trim() || null : null;
  if ((object['scopeAnchor'] !== undefined && typeof object['scopeAnchor'] !== 'string')
    || (isAnchoredScope(scope) && !scopeAnchor)
    || (scope === AUTHZ_SCOPES.Global && scopeAnchor)) {
    return deny(AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Invalid scope anchor.', HttpStatus.BAD_REQUEST);
  }
  const reason = typeof object['reason'] === 'string' ? object['reason'].trim() : '';
  if (reason.length < 10 || reason.length > 500) {
    return deny(AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Reason must be 10..500 characters.', HttpStatus.BAD_REQUEST);
  }
  return { subjectIdentityId, scopeType: scope, scopeAnchor, reason };
}

/** Fail-closed SoD-007 exception. Never bypasses maker-checker for business transactions. */
@Injectable()
export class SodExceptionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly pdp: PolicyDecisionPointService,
    private readonly scopes: ScopeContextRepository,
  ) {}

  private pool() {
    const pool = this.database.getConnection()?.pool;
    if (!pool) { throw new Error('DATABASE_URL is not configured.'); }
    return pool;
  }

  private async authorize(actor: IdentityAuthzContext, action: AuthzAction): Promise<void> {
    const decision = await this.pdp.decide(actor, {
      action, resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
    });
    if (decision.result !== 'ALLOW') {
      deny(AUTHZ_ERROR_CODES.DENIED, 'Access denied.');
    }
  }

  /** Use the real signed-in identity + its active credential, never a submitted email. */
  private async requireNamedApprover(client: PoolClient, actor: IdentityAuthzContext): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM identity.credentials
       WHERE identity_id = $1 AND login_identifier_normalized = $2 AND revoked_at IS NULL
       LIMIT 1`,
      [actor.identityId, SOD_EXCEPTION_APPROVER_LOGIN],
    );
    if (result.rowCount !== 1) {
      deny(AUTHZ_ERROR_CODES.DENIED, 'Designated SoD approver required.');
    }
  }

  private async audit(client: PoolClient, actor: IdentityAuthzContext, action: string,
    row: ExceptionRow, extra: Record<string, unknown> = {}): Promise<void> {
    await client.query(
      `INSERT INTO audit.security_audit_events
         (actor_identity_id, actor_session_id, action, resource_type, resource_id,
          outcome, scope_type, classification, metadata)
       VALUES ($1::uuid, $2::uuid, $3, 'sod-exception', $4::text,
         'SUCCESS', $5, 'SECURITY_CRITICAL', $6::jsonb)`,
      [actor.identityId, actor.sessionId, action, row.id, row.scope_type,
        JSON.stringify({ rule_id: row.rule_id, subject_identity_id: row.subject_identity_id,
          scope_anchor: row.scope_anchor, ...extra })],
    );
  }

  async list(actor: IdentityAuthzContext): Promise<SodExceptionView[]> {
    await this.authorize(actor, AUTHZ_ACTIONS.AccessAdminRead);
    const result = await this.pool().query<ExceptionRow>(
      `SELECT * FROM "authorization".sod_exceptions ORDER BY requested_at DESC, id DESC LIMIT 200`,
    );
    return result.rows.map(view);
  }

  async request(actor: IdentityAuthzContext, raw: unknown): Promise<SodExceptionView> {
    await this.authorize(actor, AUTHZ_ACTIONS.AccessAdminManage);
    const input = parseRequest(raw);
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const identity = await client.query('SELECT 1 FROM identity.identities WHERE id = $1',
        [input.subjectIdentityId]);
      if (identity.rowCount !== 1) {
        deny(AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Subject identity not found.', HttpStatus.BAD_REQUEST);
      }
      if (isAnchoredScope(input.scopeType)
        && !(await this.scopes.scopeRefExists(input.scopeType, input.scopeAnchor!))) {
        deny(AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Scope reference not found.', HttpStatus.BAD_REQUEST);
      }
      const result = await client.query<ExceptionRow>(
        `INSERT INTO "authorization".sod_exceptions
          (subject_identity_id, scope_type, scope_anchor, reason, requested_by_identity_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.subjectIdentityId, input.scopeType, input.scopeAnchor, input.reason, actor.identityId],
      );
      const row = result.rows[0]!;
      await this.audit(client, actor, 'security:authz:sod-exception:request', row);
      await client.query('COMMIT');
      return view(row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        deny(AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT, 'An open exception already exists for that scope.', HttpStatus.CONFLICT);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async approve(actor: IdentityAuthzContext, id: string): Promise<SodExceptionView> {
    await this.authorize(actor, AUTHZ_ACTIONS.AccessAdminManage);
    validId(id);
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      await this.requireNamedApprover(client, actor);
      const result = await client.query<ExceptionRow>(
        `UPDATE "authorization".sod_exceptions SET status = 'APPROVED',
            approved_by_identity_id = $2, approved_at = now()
         WHERE id = $1 AND status = 'PENDING'
           AND requested_by_identity_id <> $2 AND subject_identity_id <> $2
         RETURNING *`, [id, actor.identityId],
      );
      const row = result.rows[0];
      if (!row) {
        deny(AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT, 'Exception unavailable or self-approval forbidden.', HttpStatus.CONFLICT);
      }
      await this.audit(client, actor, 'security:authz:sod-exception:approve', row);
      await client.query('COMMIT');
      return view(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(actor: IdentityAuthzContext, id: string): Promise<SodExceptionView> {
    await this.authorize(actor, AUTHZ_ACTIONS.AccessAdminManage);
    validId(id);
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      await this.requireNamedApprover(client, actor);
      const result = await client.query<ExceptionRow>(
        `UPDATE "authorization".sod_exceptions SET status = 'REVOKED',
            revoked_by_identity_id = $2, revoked_at = now()
         WHERE id = $1 AND status = 'APPROVED' RETURNING *`, [id, actor.identityId],
      );
      const row = result.rows[0];
      if (!row) {
        deny(AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT, 'Only an approved exception can be revoked.', HttpStatus.CONFLICT);
      }
      const dependents = await client.query(
        `UPDATE "authorization".access_role_assignments
         SET revoked_at = now(), revoked_by_identity_id = $2, version = version + 1
         WHERE sod_exception_id = $1 AND revoked_at IS NULL`,
        [id, actor.identityId],
      );
      await this.audit(client, actor, 'security:authz:sod-exception:revoke', row,
        { revoked_assignment_count: dependents.rowCount ?? 0 });
      await client.query('COMMIT');
      return view(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Caller holds a transaction. FOR SHARE prevents approval/revocation racing assignment. */
  async findApprovedForAssignment(client: PoolClient, subjectIdentityId: string,
    scopeType: AuthzScopeType, scopeAnchor: string | null): Promise<string | null> {
    const found = await client.query<{ id: string }>(
      `SELECT id FROM "authorization".sod_exceptions
       WHERE subject_identity_id = $1 AND rule_id = 'SOD-007' AND status = 'APPROVED'
         AND ((scope_type = 'GLOBAL' AND scope_anchor IS NULL)
           OR (scope_type = $2 AND scope_anchor IS NOT DISTINCT FROM $3))
       ORDER BY CASE WHEN scope_type = $2 THEN 0 ELSE 1 END, approved_at DESC
       LIMIT 1 FOR SHARE`,
      [subjectIdentityId, scopeType, scopeAnchor],
    );
    return found.rows[0]?.id ?? null;
  }
}

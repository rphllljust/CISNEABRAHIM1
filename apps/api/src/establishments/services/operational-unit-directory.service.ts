import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { ScopeContextRepository } from '../../authorization/repositories/scope-context.repository';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  OperationalUnitCommandConflict,
  OperationalUnitDirectoryRepository,
  type OperationalUnitRow,
} from '../repositories/operational-unit-directory.repository';

export type OperationalUnitRead = { id: string; code: string; name: string; version: number };

function toRead(row: OperationalUnitRow): OperationalUnitRead {
  return { id: row.id, code: row.code, name: row.business_name, version: row.version };
}

function badInput(message: string): never {
  throw new HttpException({ code: 'UNIT_VALIDATION_FAILED', message }, HttpStatus.BAD_REQUEST);
}

function assertKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    return badInput('idempotencyKey must contain 8-128 allowed characters.');
  }
  return value;
}

function assertCode(value: unknown): string {
  if (typeof value !== 'string') return badInput('Code is required.');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(code)) return badInput('Invalid unit code.');
  return code;
}

function assertName(value: unknown): string {
  if (typeof value !== 'string') return badInput('Business name is required.');
  const name = value.trim();
  if (name.length < 2 || name.length > 200) return badInput('Invalid business name.');
  return name;
}

@Injectable()
export class OperationalUnitDirectoryService {
  constructor(
    private readonly repository: OperationalUnitDirectoryRepository,
    private readonly scopeRefs: ScopeContextRepository,
    private readonly authorization: AuthorizationRepository,
    private readonly pdp: PolicyDecisionPointService,
    private readonly audit: SecurityAuditService,
  ) {}

  /** Cross-context read port: consumers supply their own pre-authorized IDs. */
  async listDetails(authorizedIds: readonly string[]): Promise<OperationalUnitRead[]> {
    const rows = await this.repository.listByIds(authorizedIds);
    return rows.map(toRead);
  }

  private async assertAction(
    actor: IdentityAuthzContext,
    action: typeof AUTHZ_ACTIONS.OperationalUnitRead | typeof AUTHZ_ACTIONS.OperationalUnitManage,
    unitId?: string,
  ): Promise<void> {
    const result = await this.pdp.decide(actor, {
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.OperationalUnit,
      ...(unitId ? { context: { unitId } } : {}),
    }, { audit: true });
    if (result.result !== 'ALLOW') {
      throw new HttpException({ code: 'UNIT_DENIED', message: 'Access denied.' }, HttpStatus.FORBIDDEN);
    }
  }

  async listAdminVisible(actor: IdentityAuthzContext): Promise<{ items: OperationalUnitRead[] }> {
    const [direct, roleDerived, ids] = await Promise.all([
      this.authorization.findActiveGrants(
        actor.identityId,
        AUTHZ_ACTIONS.OperationalUnitRead,
        AUTHZ_RESOURCE_TYPES.OperationalUnit,
      ),
      this.authorization.findRoleDerivedActionRows(actor.identityId, AUTHZ_ACTIONS.OperationalUnitRead),
      this.repository.listAllIds(),
    ]);
    if (direct.length === 0 && roleDerived.length === 0) {
      throw new HttpException({ code: 'UNIT_DENIED', message: 'Access denied.' }, HttpStatus.FORBIDDEN);
    }
    if (ids.length === 0) return { items: [] };
    const decisions = await this.pdp.decideBatch(actor, {
      action: AUTHZ_ACTIONS.OperationalUnitRead,
      resourceType: AUTHZ_RESOURCE_TYPES.OperationalUnit,
    }, ids.map(unitId => ({ unitId })), { audit: false });
    const authorized = ids.filter((_, i) => decisions[i]?.result === 'ALLOW');
    return { items: await this.listDetails(authorized) };
  }

  async getHistory(actor: IdentityAuthzContext, id: string) {
    await this.assertAction(actor, AUTHZ_ACTIONS.OperationalUnitRead, id);
    const master = await this.repository.findById(id);
    if (!master) {
      throw new HttpException({ code: 'UNIT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
    }
    return {
      unit: toRead(master),
      events: await this.repository.listHistory(id),
    };
  }

  async create(
    actor: IdentityAuthzContext,
    input: { refId?: unknown; code?: unknown; name?: unknown; idempotencyKey?: unknown },
  ): Promise<OperationalUnitRead> {
    // Creating a brand-new unit requires global manage authority (no UNIT scope yet).
    await this.assertAction(actor, AUTHZ_ACTIONS.OperationalUnitManage);
    const code = assertCode(input.code);
    const name = assertName(input.name);
    const key = assertKey(input.idempotencyKey);
    // Existing authorization anchors (e.g. UN-PROD-001) retain their business
    // identity. Without refId we create a new unit; no OS lookup is involved.
    const legacyRef = input.refId === undefined ? undefined : input.refId;
    if (legacyRef !== undefined &&
        (typeof legacyRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(legacyRef))) {
      return badInput('Invalid existing unit reference.');
    }
    try {
      const row = await this.repository.execute(
        actor.identityId, key, { operation: 'CREATE', refId: legacyRef ?? null, code, name },
        async client => {
          const created = await this.repository.create(client, {
            id: typeof legacyRef === 'string' ? legacyRef : 'UNIT-' + randomUUID(),
            code, name, actorId: actor.identityId,
          });
          await this.scopeRefs.insertScopeRef(client, AUTHZ_SCOPES.Unit, created.id);
          return created;
        },
      );
      await this.audit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.OperationalUnitManage,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.OperationalUnit,
        resourceId: row.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: { operation: 'CREATE', version: row.version },
      });
      return toRead(row);
    } catch (error) {
      return this.mapError(error);
    }
  }

  async update(
    actor: IdentityAuthzContext,
    id: string,
    input: { code?: unknown; name?: unknown; expectedVersion?: unknown; idempotencyKey?: unknown },
  ): Promise<OperationalUnitRead> {
    await this.assertAction(actor, AUTHZ_ACTIONS.OperationalUnitManage, id);
    if (!id.trim()) return badInput('Unit id is required.');
    const key = assertKey(input.idempotencyKey);
    if (typeof input.expectedVersion !== 'number' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      return badInput('Expected version must be a positive integer.');
    }
    const expectedVersion = input.expectedVersion as number;
    if (input.code === undefined && input.name === undefined) {
      return badInput('At least one business field is required.');
    }
    const code = input.code === undefined ? undefined : assertCode(input.code);
    const name = input.name === undefined ? undefined : assertName(input.name);
    try {
      const row = await this.repository.execute(
        actor.identityId, key, { operation: 'UPDATE', id, expectedVersion, code, name },
        async client => {
          const current = await this.repository.findById(id);
          if (!current) throw new HttpException({ code: 'UNIT_NOT_FOUND' }, HttpStatus.NOT_FOUND);
          return this.repository.update(client, {
            id, expectedVersion, code: code ?? current.code, name: name ?? current.business_name,
            actorId: actor.identityId,
          });
        },
      );
      await this.audit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.OperationalUnitManage,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.OperationalUnit,
        resourceId: id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: { operation: 'UPDATE', version: row.version },
      });
      return toRead(row);
    } catch (error) {
      return this.mapError(error);
    }
  }

  private mapError(error: unknown): never {
    if (error instanceof OperationalUnitCommandConflict) {
      throw new HttpException({
        code: error.reason === 'KEY_REUSED' ? 'UNIT_IDEMPOTENCY_CONFLICT'
          : error.reason === 'CODE_CONFLICT' ? 'UNIT_CODE_CONFLICT'
            : 'UNIT_VERSION_CONFLICT',
      }, HttpStatus.CONFLICT);
    }
    throw error;
  }
}

import {
  hashPassword, insertGrant, insertIdentity, truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthModule } from '../auth/auth.module';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AuthorizationModule } from './authorization.module';
import { AccessAdminService } from './services/access-admin.service';
import { SodExceptionService } from './services/sod-exception.service';
import { AUTHZ_ACTIONS } from './types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from './types/authz-resources';
import { AUTHZ_SCOPES } from './types/authz-scopes';
import { SOD_CAPABILITIES } from './domain/segregation-of-duties';
import { AuthzHttpException } from './errors/authz-http.exception';
import { AUTHZ_ERROR_CODES } from './errors/authz-error-codes';

describe('SOD-007 exceptions — real PostgreSQL + PDP', () => {
  let pool: Pool;
  let access: AccessAdminService;
  let exceptions: SodExceptionService;
  const connectionString = process.env['TEST_DATABASE_URL'];
  const actor = (identityId: string) => ({ identityId, sessionId: randomUUID() });

  beforeAll(async () => {
    if (!connectionString) { throw new Error('TEST_DATABASE_URL is required.'); }
    applyAuthTestEnv(connectionString);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuthorizationModule],
    }).compile();
    access = module.get(AccessAdminService);
    exceptions = module.get(SodExceptionService);
    pool = new Pool({ connectionString });
  });
  beforeEach(async () => { await truncateIdentityAndAuthorizationTables(pool); });
  afterAll(async () => { await pool.end(); });

  async function identity(login: string): Promise<string> {
    const hash = await hashPassword('test-password-strong!');
    const inserted = await insertIdentity(pool, normalizeLoginIdentifier(login), hash);
    return inserted.identityId;
  }
  async function admin(login: string) {
    const id = await identity(login);
    for (const action of [AUTHZ_ACTIONS.AccessAdminRead, AUTHZ_ACTIONS.AccessAdminManage]) {
      await insertGrant(pool, {
        identityId: id, action, resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
        scopeType: AUTHZ_SCOPES.Global, grantedByIdentityId: id,
      });
    }
    return actor(id);
  }
  async function code(promise: Promise<unknown>, expected: string): Promise<void> {
    try {
      await promise;
      throw new Error('Expected denial but call succeeded');
    } catch (error) {
      if (error instanceof AuthzHttpException) {
        expect(error.code).toBe(expected);
      } else {
        throw error;
      }
    }
  }
  const requestBody = (subjectIdentityId: string) => ({
    ruleId: 'SOD-007', subjectIdentityId, scopeType: 'GLOBAL',
    reason: 'Approved exception for documented role separation risk.',
  });

  it('fails closed on absent approval, rogue approver, self-approval and repeated transition', async () => {
    const requester = await admin(`requester-${randomUUID()}@cisne.invalid`);
    const rafael = await admin('rafael@cisne.invalid');
    const rogue = await admin(`rogue-${randomUUID()}@cisne.invalid`);
    const subject = await identity(`subject-${randomUUID()}@cisne.invalid`);
    await access.createRole(requester, { code: 'AUTHZ_MANAGER_TEST', label: 'Manage', capabilities: [AUTHZ_ACTIONS.AccessAdminManage] });
    await access.createRole(requester, { code: 'FIN_APPROVER_TEST', label: 'Approve', capabilities: [SOD_CAPABILITIES.PurchaseApprove] });
    await access.assignRole(requester, { roleCode: 'AUTHZ_MANAGER_TEST', identityId: subject, scopeType: 'GLOBAL' });
    await code(access.assignRole(requester, {
      roleCode: 'FIN_APPROVER_TEST', identityId: subject, scopeType: 'GLOBAL',
    }), AUTHZ_ERROR_CODES.ACCESS_ADMIN_SOD_CONFLICT);

    const requested = await exceptions.request(requester, requestBody(subject));
    expect(requested.status).toBe('PENDING');
    await code(exceptions.approve(rogue, requested.id), AUTHZ_ERROR_CODES.DENIED);
    await code(exceptions.approve(requester, requested.id), AUTHZ_ERROR_CODES.DENIED);
    expect((await exceptions.list(rafael))[0]?.status).toBe('PENDING');

    const approved = await exceptions.approve(rafael, requested.id);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedByIdentityId).toBe(rafael.identityId);
    await code(exceptions.approve(rafael, requested.id), AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT);
    await code(exceptions.request(requester, requestBody(subject)), AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT);

    const granted = await access.assignRole(requester, {
      roleCode: 'FIN_APPROVER_TEST', identityId: subject, scopeType: 'GLOBAL',
    });
    expect(granted.identityId).toBe(subject);
    const dependency = await pool.query<{ sod_exception_id: string }>(
      'SELECT sod_exception_id FROM "authorization".access_role_assignments WHERE id = $1',
      [granted.id],
    );
    expect(dependency.rows[0]?.sod_exception_id).toBe(requested.id);

    await code(exceptions.revoke(rogue, requested.id), AUTHZ_ERROR_CODES.DENIED);
    const revoked = await exceptions.revoke(rafael, requested.id);
    expect(revoked.status).toBe('REVOKED');
    const remaining = await access.listAssignments(requester, subject);
    expect(remaining.map((item) => item.roleCode)).toEqual(['AUTHZ_MANAGER_TEST']);
    await code(exceptions.revoke(rafael, requested.id), AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT);
    await code(access.assignRole(requester, {
      roleCode: 'FIN_APPROVER_TEST', identityId: subject, scopeType: 'GLOBAL',
    }), AUTHZ_ERROR_CODES.ACCESS_ADMIN_SOD_CONFLICT);
    const audits = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events
       WHERE resource_id = $1 AND resource_type = 'sod-exception' ORDER BY occurred_at`, [requested.id],
    );
    expect(audits.rows.map((item) => item.action).sort()).toEqual([
      'security:authz:sod-exception:approve',
      'security:authz:sod-exception:request',
      'security:authz:sod-exception:revoke',
    ]);
  });

  it('blocks approver as beneficiary and prevents an unapproved exception from granting access', async () => {
    const requester = await admin(`requester-${randomUUID()}@cisne.invalid`);
    const rafael = await admin('rafael@cisne.invalid');
    const self = await exceptions.request(requester, requestBody(rafael.identityId));
    await code(exceptions.approve(rafael, self.id), AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT);
    const another = await identity(`subject-${randomUUID()}@cisne.invalid`);
    const requestedByRafael = await exceptions.request(rafael, requestBody(another));
    await code(exceptions.approve(rafael, requestedByRafael.id), AUTHZ_ERROR_CODES.ACCESS_ADMIN_CONFLICT);
    expect((await exceptions.list(requester)).every((entry) => entry.status === 'PENDING')).toBe(true);
  });

  it('denies actions to an actor without the access-admin manage/read grants', async () => {
    const outsider = actor(await identity(`outside-${randomUUID()}@cisne.invalid`));
    const subject = await identity(`subject-${randomUUID()}@cisne.invalid`);
    await code(exceptions.request(outsider, requestBody(subject)), AUTHZ_ERROR_CODES.DENIED);
    await code(exceptions.list(outsider), AUTHZ_ERROR_CODES.DENIED);
  });
});

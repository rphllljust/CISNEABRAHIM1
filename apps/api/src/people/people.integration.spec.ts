import {
  hashPassword,
  insertGrant,
  insertIdentity,
  ensureOperationalLaborTypesBaseline,
  truncateIdentityAndAuthorizationTables,
  truncateWorkforceTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { PeopleModule } from './people.module';
import { PersonAccessService } from './services/person-access.service';
import { PERSON_ERROR_CODES } from './errors/person-error-codes';
import { PersonHttpException } from './errors/person-http.exception';

async function grantPeopleAdmin(
  pool: Pool,
  identityId: string,
  grantedBy: string,
): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.PeoplePersonCreate,
    AUTHZ_ACTIONS.PeoplePersonRead,
    AUTHZ_ACTIONS.PeoplePersonList,
    AUTHZ_ACTIONS.PeoplePersonUpdate,
    AUTHZ_ACTIONS.PeoplePersonDeactivate,
    AUTHZ_ACTIONS.PeoplePersonActivate,
  ];
  for (const action of actions) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.PeoplePerson,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('People PostgreSQL integration', () => {
  let pool: Pool;
  let personAccess: PersonAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for people integration tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);

    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, PeopleModule],
    }).compile();

    personAccess = module.get(PersonAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateWorkforceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureOperationalLaborTypesBaseline(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(): Promise<{ identityId: string }> {
    const login = normalizeLoginIdentifier(`people-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantPeopleAdmin(pool, identityId, identityId);
    return { identityId };
  }

  it('creates, reads, updates, deactivates and reactivates a person', async () => {
    const { identityId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await personAccess.create(actor, {
      legalName: 'Executor Operacional Sintetico',
      preferredName: 'Executor',
      defaultLaborTypeCode: 'DRIVER',
      externalErpId: 'ERP-PEOPLE-001',
    });

    expect(created.status).toBe('ACTIVE');
    expect(created.memberCode).toMatch(/^PSN-/);
    expect(created.defaultLaborTypeCode).toBe('DRIVER');
    expect(created.serviceOrderAllocationSupported).toBe(true);

    const fetched = await personAccess.getById(actor, created.id);
    expect(fetched.legalName).toBe('Executor Operacional Sintetico');

    const updated = await personAccess.update(actor, created.id, {
      version: created.version,
      preferredName: 'Executor Atualizado',
    });
    expect(updated.preferredName).toBe('Executor Atualizado');

    const deactivated = await personAccess.deactivate(
      actor,
      created.id,
      updated.version,
      'Saida operacional',
    );
    expect(deactivated.status).toBe('INACTIVE');

    const history = await personAccess.listHistory(actor, created.id);
    expect(history.items.length).toBeGreaterThanOrEqual(3);

    const reactivated = await personAccess.activate(actor, created.id, deactivated.version);
    expect(reactivated.status).toBe('ACTIVE');
  });

  it('rejects duplicate external reference', async () => {
    const { identityId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await personAccess.create(actor, {
      legalName: 'Pessoa A',
      externalErpId: 'ERP-DUP-001',
    });

    await expect(
      personAccess.create(actor, {
        legalName: 'Pessoa B',
        externalErpId: 'ERP-DUP-001',
      }),
    ).rejects.toMatchObject({ code: PERSON_ERROR_CODES.EXTERNAL_ID_CONFLICT });
  });

  it('denies list without grants', async () => {
    const login = normalizeLoginIdentifier(`people-deny-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    const actor = { identityId, sessionId: 'sid' };

    await expect(personAccess.list(actor, { limit: 20, offset: 0 })).rejects.toMatchObject({
      code: PERSON_ERROR_CODES.DENIED,
    });
  });

  it('detects optimistic concurrency conflicts', async () => {
    const { identityId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await personAccess.create(actor, {
      legalName: 'Concorrencia Operacional',
    });

    await personAccess.update(actor, created.id, {
      version: created.version,
      preferredName: 'V2',
    });

    await expect(
      personAccess.update(actor, created.id, {
        version: created.version,
        preferredName: 'Stale',
      }),
    ).rejects.toMatchObject({ code: PERSON_ERROR_CODES.VERSION_CONFLICT });
  });

  it('paginates list results and supports empty state', async () => {
    const { identityId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const empty = await personAccess.list(actor, { limit: 10, offset: 0 });
    expect(empty.items).toEqual([]);

    for (let index = 0; index < 3; index += 1) {
      await personAccess.create(actor, {
        legalName: `Pessoa Paginacao ${index}`,
      });
    }

    const page = await personAccess.list(actor, { limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
  });

  it('documents that service order allocations reference a physical asset or a workforce member', async () => {
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'res' AND table_name = 'resource_allocations'
       ORDER BY ordinal_position`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain('physical_asset_id');
    expect(names).toContain('workforce_member_id');
  });

  it('rejects invalid labor type on create', async () => {
    const { identityId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    await expect(
      personAccess.create(actor, {
        legalName: 'Tipo invalido',
        defaultLaborTypeCode: 'NOT_A_REAL_TYPE',
      }),
    ).rejects.toBeInstanceOf(PersonHttpException);
  });
});

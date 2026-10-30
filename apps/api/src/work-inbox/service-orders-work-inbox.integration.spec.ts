import {
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { WorkInboxService } from './services/work-inbox.service';
import { ServiceOrdersWorkSource } from './sources/service-orders.source';
import { WorkInboxModule } from './work-inbox.module';

const UNIT_A = 'unit-inbox-a';
const UNIT_B = 'unit-inbox-b';

/**
 * Contrato real PostgreSQL: fonte de OS -> Inbox/KPI -> drill.
 * Os inserts são fixtures de banco DESCARTÁVEL para teste de leitura; jamais produção.
 * Comando release/auditoria/concorrência são cobertos pelas suites do domínio de OS.
 */
describe('OS -> Work Inbox / KPI (PostgreSQL real e escopo PDP)', () => {
  let moduleRef: TestingModule;
  let pool: Pool;
  let inbox: WorkInboxService;
  let actor: { identityId: string; sessionId: string };

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) throw new Error('TEST_DATABASE_URL is required');
    applyAuthTestEnv(url);
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, WorkInboxModule],
    }).compile();
    const source = moduleRef.get(ServiceOrdersWorkSource);
    inbox = new WorkInboxService([source]);
    pool = new Pool({ connectionString: url });
  });

  afterAll(async () => {
    await pool?.end();
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await truncateServiceOrderTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
    const identity = await insertIdentity(pool, `inbox-so-${crypto.randomUUID()}@cisne.invalid`);
    actor = { identityId: identity.identityId, sessionId: 'session-inbox-so' };
  });

  async function grantUnit(unitId: string, action = AUTHZ_ACTIONS.ServiceOrdersServiceOrderList) {
    await insertGrant(pool, {
      identityId: actor.identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: unitId,
      grantedByIdentityId: actor.identityId,
    });
  }

  async function seedOrder(unitId: string, suffix: string, status: string): Promise<string> {
    const prepared = status === 'PREPARED' ? new Date().toISOString() : null;
    const result = await pool.query<{ id: string }>(
      `INSERT INTO so.service_orders (
        internal_code, order_number, unit_id, status, origin,
        service_snapshot, client_snapshot, prepared_at, row_version,
        created_by_identity_id, updated_by_identity_id
      ) VALUES ($1, $2, $3, $4::so.service_order_status, 'AUTHORIZED_DIRECT',
        '{}'::jsonb, '{}'::jsonb, $5, 1, $6, $6) RETURNING id`,
      [`INT-${suffix}`, `OS-${suffix}`, unitId, status, prepared, actor.identityId],
    );
    return result.rows[0]!.id;
  }

  it('nega a fonte sem concessao: nenhum identificador nem contagem vaza', async () => {
    await seedOrder(UNIT_A, 'DENIED', 'PREPARED');
    const page = await inbox.list(actor, { domain: 'OPERACOES' });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.unavailableDomains).toEqual([]);
  });

  it('LIST sem READ nao publica objeto nem KPI na fila', async () => {
    await grantUnit(UNIT_A);
    await seedOrder(UNIT_A, 'LIST-ONLY', 'PREPARED');
    const page = await inbox.list(actor, { domain: 'OPERACOES' });
    expect(page.items).toEqual([]);
    expect(page.byDomain.OPERACOES).toBe(0);
    expect(page.unavailableDomains).toEqual([]);
  });

  it('LIST GLOBAL com READ UNIT nao publica OS de outra unidade', async () => {
    await insertGrant(pool, {
      identityId: actor.identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actor.identityId,
    });
    await grantUnit(UNIT_A, AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead);
    const visible = await seedOrder(UNIT_A, 'READABLE', 'PREPARED');
    await seedOrder(UNIT_B, 'NO-READ', 'PREPARED');
    const page = await inbox.list(actor, { domain: 'OPERACOES' });
    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.targetRoute)).toEqual([`/app/service-orders/${visible}`]);
  });

  it('conta somente OS PREPARED da unidade concedida e reconcilia o drill', async () => {
    await grantUnit(UNIT_A);
    await grantUnit(UNIT_A, AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead);
    const visible = await seedOrder(UNIT_A, 'VISIBLE', 'PREPARED');
    await seedOrder(UNIT_B, 'HIDDEN', 'PREPARED');
    await seedOrder(UNIT_A, 'DRAFT', 'DRAFT');

    const snapshot = await inbox.list(actor, { limit: '0' });
    const drill = await inbox.list(actor, { domain: 'OPERACOES', unitId: UNIT_A });

    expect(snapshot.byDomain.OPERACOES).toBe(1);
    expect(drill.total).toBe(snapshot.byDomain.OPERACOES);
    expect(drill.items).toHaveLength(1);
    expect(drill.items[0]?.id).toBe(`OPERACOES:OS:RELEASE:${visible}`);
    expect(drill.items[0]?.targetRoute).toBe(`/app/service-orders/${visible}`);

    // A projeção volta a ser calculada do estado persistido em cada leitura.
    await pool.query(
      `UPDATE so.service_orders SET status = 'RELEASED', released_at = NOW(),
       updated_at = NOW(), row_version = row_version + 1 WHERE id = $1`,
      [visible],
    );
    const afterTransition = await inbox.list(actor, { domain: 'OPERACOES' });
    expect(afterTransition.total).toBe(0);
  });
});

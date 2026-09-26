import { hashPassword, insertGrant, insertIdentity, truncateIdentityAndAuthorizationTables } from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { CommercialModule } from './commercial.module';
import { PurchaseOrdersAccessAuthz } from './services/purchase-orders-access.authz';

/**
 * P0 — prova da cadeia relacionada do pedido de compra.
 *
 * Nao mocka o que se esta provando: o PDP, o casamento de grants e o escopo rodam contra o banco
 * de teste real (`TEST_DATABASE_URL`), com grants inseridos de verdade. So o dado de entrada da
 * cadeia e montado no teste — ele representa registro ja carregado do repositorio.
 *
 * Principio tirado de frappe/frappe `frappe/tests/test_permissions.py`: testar como usuario
 * restrito real e provar AUSENCIA (`assertFalse`/`not.toContain`) do dado nao autorizado, nao a
 * implementacao interna; e o resultado observavel da resposta que conta.
 */
const UNIT_A = 'unit-linked-a';
const UNIT_B = 'unit-linked-b';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SERVICE_ORDER_ID = '22222222-2222-4222-8222-222222222222';
const MEASUREMENT_ID = '33333333-3333-4333-8333-333333333333';
const BILLING_RECORD_ID = '44444444-4444-4444-8444-444444444444';
const BILLING_DOCUMENT_ID = '55555555-5555-4555-8555-555555555555';

describe('Purchase order linked chain — authorization (P0)', () => {
  let moduleFixture: TestingModule;
  let authz: PurchaseOrdersAccessAuthz;
  let pool: Pool;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for purchase order linked chain tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    moduleFixture = await Test.createTestingModule({
      imports: [AuditModule, AuthorizationModule, CommercialModule],
    }).compile();
    authz = moduleFixture.get(PurchaseOrdersAccessAuthz);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterAll(async () => {
    await pool.end();
    await moduleFixture.close();
  });

  beforeEach(async () => {
    await truncateIdentityAndAuthorizationTables(pool);
  });

  /** Cadeia completa do pedido, com a mesma forma que o repositorio devolve. */
  function chain(unitId = UNIT_A) {
    return [
      { kind: 'REQUEST', id: REQUEST_ID, parent_id: null, unit_id: unitId, client_id: null },
      {
        kind: 'SERVICE_ORDER',
        id: SERVICE_ORDER_ID,
        parent_id: null,
        unit_id: unitId,
        client_id: null,
      },
      {
        kind: 'MEASUREMENT',
        id: MEASUREMENT_ID,
        parent_id: SERVICE_ORDER_ID,
        unit_id: unitId,
        client_id: null,
      },
      {
        kind: 'BILLING_RECORD',
        id: BILLING_RECORD_ID,
        parent_id: SERVICE_ORDER_ID,
        unit_id: unitId,
        client_id: null,
      },
      {
        kind: 'BILLING_DOCUMENT',
        id: BILLING_DOCUMENT_ID,
        parent_id: SERVICE_ORDER_ID,
        unit_id: unitId,
        client_id: null,
      },
    ];
  }

  async function actorWith(
    grants: Array<{ action: string; resourceType: string; unitId?: string }>,
  ) {
    const loginId = normalizeLoginIdentifier(`linked-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, loginId, passwordHash);
    for (const grant of grants) {
      await insertGrant(pool, {
        identityId,
        action: grant.action,
        resourceType: grant.resourceType,
        scopeType: grant.unitId ? AUTHZ_SCOPES.Unit : AUTHZ_SCOPES.Global,
        resourceId: grant.unitId,
        grantedByIdentityId: identityId,
      });
    }
    return { identityId, sessionId: crypto.randomUUID() };
  }

  const PO_READ = {
    action: AUTHZ_ACTIONS.CommercialPurchaseOrderRead,
    resourceType: AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
  };
  const REQUEST_READ = {
    action: AUTHZ_ACTIONS.RequestsServiceRequestRead,
    resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
  };
  const SO_READ = {
    action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
  };
  const BILLING_RECORD_READ = {
    action: AUTHZ_ACTIONS.BillingBillingRecordRead,
    resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
  };
  const BILLING_DOCUMENT_READ = {
    action: AUTHZ_ACTIONS.BillingBillingDocumentRead,
    resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
  };

  it('1. sem requests:service-request:read o elo REQUEST nao aparece', async () => {
    const actor = await actorWith([PO_READ]);
    const allowed = await authz.filterAuthorizedLinkedChain(actor, chain());

    expect([...allowed]).toEqual([]);
    expect(allowed.has(`REQUEST:${REQUEST_ID}`)).toBe(false);
    // Nem o identificador: a ausencia significa "nao exposto", nao "nao existe".
    expect(JSON.stringify([...allowed])).not.toContain(REQUEST_ID);
  });

  it('2. sem service-orders:service-order:read nao aparece SERVICE_ORDER nem MEASUREMENT', async () => {
    const actor = await actorWith([PO_READ, REQUEST_READ]);
    const allowed = await authz.filterAuthorizedLinkedChain(actor, chain());

    expect(allowed.has(`REQUEST:${REQUEST_ID}`)).toBe(true);
    expect(allowed.has(`SERVICE_ORDER:${SERVICE_ORDER_ID}`)).toBe(false);
    expect(allowed.has(`MEASUREMENT:${MEASUREMENT_ID}`)).toBe(false);
  });

  it('3. com OS read mas sem billing:read nenhum dado financeiro relacionado e exposto', async () => {
    const actor = await actorWith([PO_READ, SO_READ]);
    const allowed = await authz.filterAuthorizedLinkedChain(actor, chain());

    expect(allowed.has(`SERVICE_ORDER:${SERVICE_ORDER_ID}`)).toBe(true);
    expect(allowed.has(`MEASUREMENT:${MEASUREMENT_ID}`)).toBe(true);
    expect(allowed.has(`BILLING_RECORD:${BILLING_RECORD_ID}`)).toBe(false);
    expect(allowed.has(`BILLING_DOCUMENT:${BILLING_DOCUMENT_ID}`)).toBe(false);
    const serialized = JSON.stringify([...allowed]);
    expect(serialized).not.toContain(BILLING_RECORD_ID);
    expect(serialized).not.toContain(BILLING_DOCUMENT_ID);
  });

  it('4. com todos os grants e escopo compativel a cadeia completa aparece', async () => {
    const actor = await actorWith([PO_READ, REQUEST_READ, SO_READ, BILLING_RECORD_READ, BILLING_DOCUMENT_READ]);
    const allowed = await authz.filterAuthorizedLinkedChain(actor, chain());

    expect([...allowed].sort()).toEqual(
      [
        `REQUEST:${REQUEST_ID}`,
        `SERVICE_ORDER:${SERVICE_ORDER_ID}`,
        `MEASUREMENT:${MEASUREMENT_ID}`,
        `BILLING_RECORD:${BILLING_RECORD_ID}`,
        `BILLING_DOCUMENT:${BILLING_DOCUMENT_ID}`,
      ].sort(),
    );
  });

  it('7. mesma capability com escopo de OUTRA unidade nao expoe o elo', async () => {
    // Grants ancorados em UNIT_B; o pedido e seus elos estao em UNIT_A.
    const actor = await actorWith([
      { ...PO_READ, unitId: UNIT_B },
      { ...REQUEST_READ, unitId: UNIT_B },
      { ...SO_READ, unitId: UNIT_B },
    ]);
    const allowed = await authz.filterAuthorizedLinkedChain(actor, chain(UNIT_A));

    // Prova que nao virou capability-check disfarcado: a capability existe, o escopo nao cobre.
    expect([...allowed]).toEqual([]);
  });

  it('7b. o mesmo ator autorizado passa quando o escopo da unidade casa', async () => {
    const actor = await actorWith([
      { ...PO_READ, unitId: UNIT_A },
      { ...REQUEST_READ, unitId: UNIT_A },
      { ...SO_READ, unitId: UNIT_A },
    ]);
    const allowed = await authz.filterAuthorizedLinkedChain(actor, chain(UNIT_A));

    expect(allowed.has(`REQUEST:${REQUEST_ID}`)).toBe(true);
    expect(allowed.has(`SERVICE_ORDER:${SERVICE_ORDER_ID}`)).toBe(true);
  });
});

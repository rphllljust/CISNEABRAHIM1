import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compensateSyntheticScenario,
  findSyntheticNamespaceClientId,
  hashPassword,
  insertIdentity,
  syntheticExternalRef,
  SYNTHETIC_SEED_CONFIRM_ENV,
  SYNTHETIC_SEED_CONFIRM_VALUE,
  SYNTHETIC_SEED_NAMESPACE,
  SYNTHETIC_SEED_UNIT_ID,
} from '@cisne/database';
import { AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { buildDeterministicSyntheticClient } from '../master-business/synthetic-test-data';
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { grantUatProfile, runUatVerticalScenario } from '../uat/uat-vertical-runner';
import { getUatScenario } from '../uat/uat-scenarios';
import {
  buildSyntheticActor,
  closeSyntheticSeedHarness,
  prepareSyntheticSeedHarness,
  type SyntheticSeedHarness,
} from './synthetic-seed-harness';
import { runSyntheticBusinessSeed } from './synthetic-business-seed-runner';
import { ensureTestDefaultIssuer } from '../test/ensure-test-issuer';

describe('synthetic business seed (integration)', () => {
  let pool: Pool;
  let harness: SyntheticSeedHarness;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required.');
    }
    process.env['NODE_ENV'] = 'test';
    process.env['SYNTHETIC_SEED_TEST_MODE'] = SYNTHETIC_SEED_CONFIRM_VALUE;
    process.env['DATABASE_URL'] = testDatabaseUrl;
    process.env[SYNTHETIC_SEED_CONFIRM_ENV] = SYNTHETIC_SEED_CONFIRM_VALUE;
    process.env['HML_INTEGRATIONS_SANDBOX'] = 'true';
    pool = new Pool({ connectionString: testDatabaseUrl, max: 4 });
    harness = await prepareSyntheticSeedHarness(pool);
  });

  afterAll(async () => {
    await closeSyntheticSeedHarness(harness);
    await pool.end();
  });

  async function seedActor(): Promise<string> {
    const login = normalizeLoginIdentifier(`synthetic-seed-${randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantUatProfile(pool, identityId, identityId, 'control_admin');
    return identityId;
  }

  it('seeds deterministic namespace scenarios idempotently', async () => {
    const identityId = await seedActor();
    const actor = buildSyntheticActor(identityId);
    const scenarioKey = `test-idempotent-${randomUUID().slice(0, 8)}`;
    const scenario = {
      key: scenarioKey,
      displayLabel: 'Cliente teste idempotente',
      cnpjIndex: 9100 + Math.floor(Math.random() * 100),
      flow: { kind: 'client_inactive' as const },
    };

    try {
      const first = await runSyntheticBusinessSeed(pool, actor, harness.services, {
        scenarios: [scenario],
      });
      expect(first.scenarios[0]?.outcome).toBe('created');

      const second = await runSyntheticBusinessSeed(pool, actor, harness.services, {
        scenarios: [scenario],
      });
      expect(second.scenarios[0]?.outcome).toBe('already_present');
    } finally {
      await compensateSyntheticScenario(pool, scenarioKey).catch(() => undefined);
    }
  });

  it('opens exactly one receivable from a finalized synthetic billing document and cleans its origin', async () => {
    const identityId = await seedActor();
    const actor = buildSyntheticActor(identityId);
    const scenarioKey = `test-receivable-${randomUUID().slice(0, 8)}`;
    await ensureTestDefaultIssuer(pool);
    try {
      const seeded = await runSyntheticBusinessSeed(pool, actor, harness.services, {
        scenarios: [{
          key: scenarioKey,
          displayLabel: 'Cliente teste recebível',
          cnpjIndex: 9801,
          flow: { kind: 'vertical', uatScenarioId: 'locacao', stopAfter: 'complete' },
        }],
      });
      expect(seeded.scenarios[0]?.outcome).toBe('created');

      const result = await pool.query<{
        service_order_id: string; document_id: string; receivable_id: string;
        document_amount: string; principal: string; document_currency: string; currency_code: string;
      }>(
        `SELECT so.id AS service_order_id, bd.id AS document_id, r.id AS receivable_id,
                bd.total_amount::text AS document_amount, r.principal::text AS principal,
                bd.currency_code AS document_currency, r.currency_code
           FROM pty.clients c
           JOIN so.service_orders so ON so.client_id = c.id
           JOIN bil.billing_documents bd ON bd.service_order_id = so.id AND bd.status = 'FINALIZED'
           JOIN fin.receivables r ON r.origin_billing_document_id = bd.id
          WHERE c.external_erp_id = $1`,
        [syntheticExternalRef(scenarioKey)],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.principal).toBe(result.rows[0]?.document_amount);
      expect(result.rows[0]?.currency_code).toBe(result.rows[0]?.document_currency);

      const serviceOrderId = result.rows[0]!.service_order_id;
      await compensateSyntheticScenario(pool, scenarioKey);
      const remaining = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM fin.receivables WHERE origin_service_order_id = $1',
        [serviceOrderId],
      );
      expect(remaining.rows[0]?.count).toBe('0');
    } finally {
      await compensateSyntheticScenario(pool, scenarioKey).catch(() => undefined);
    }
  });

  it('positive PostgreSQL vertical: same OS completes, approves measurement and persists authorized customer acceptance', async () => {
    const actor = buildSyntheticActor(await seedActor());
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const scenarioKey = `test-ops360-${suffix.toLowerCase()}`;
    await ensureTestDefaultIssuer(pool);
    try {
      const outcome = await runUatVerticalScenario(
        harness.services,
        getUatScenario('locacao'),
        actor,
        SYNTHETIC_SEED_UNIT_ID,
        {
          deterministicSuffix: suffix,
          clientExternalErpId: syntheticExternalRef(scenarioKey),
          vehiclePlateScenarioIndex: 9901,
          syntheticRequireCustomerAcceptance: true,
        },
      );
      expect(outcome.status, outcome.error ?? 'UAT vertical execution failed').toBe('PASS');
      const id = outcome.serviceOrderId;
      expect(id).toBeTruthy();
      expect(outcome.measurementId).toBeTruthy();

      const rows = await pool.query<{
        status: string; unit_id: string; planned: string; allocated: string;
        entries: string; approved: string; billing: string;
      }>(
        `SELECT so.status, so.unit_id::text AS unit_id,
                (SELECT count(*)::text FROM so.planned_resources p WHERE p.service_order_id = so.id) AS planned,
                (SELECT count(*)::text FROM res.resource_allocations a WHERE a.service_order_id = so.id) AS allocated,
                (SELECT count(*)::text FROM so.execution_entries e WHERE e.service_order_id = so.id) AS entries,
                (SELECT count(*)::text FROM msr.measurements m WHERE m.service_order_id = so.id AND m.status = 'APPROVED') AS approved,
                (SELECT count(*)::text FROM bil.billing_records b WHERE b.service_order_id = so.id) AS billing
           FROM so.service_orders so
          WHERE so.id = $1::uuid`,
        [id],
      );
      expect(rows.rows).toHaveLength(1);
      const row = rows.rows[0]!;
      expect(row.status).toBe('COMPLETED');
      expect(row.unit_id).toBe(SYNTHETIC_SEED_UNIT_ID);
      expect(Number(row.planned)).toBeGreaterThan(0);
      expect(Number(row.allocated)).toBeGreaterThan(0);
      expect(Number(row.entries)).toBeGreaterThan(0);
      expect(row.approved).toBe('1');
      expect(row.billing).toBe('1');

      // Backend PDP/owner read model: an actual acceptance is not inferred from a UI label.
      const workbench = await harness.services.measurementsCapability!.getWorkbench(actor, id!);
      expect(workbench.identity.serviceOrderId).toBe(id);
      expect(workbench.acceptance.state).toBe('ACCEPTED');
      expect(workbench.acceptance.blocksBilling).toBe(false);
    } finally {
      await compensateSyntheticScenario(pool, scenarioKey).catch(() => undefined);
    }
  });

  it('rejects production NODE_ENV', async () => {
    process.env['NODE_ENV'] = 'production';
    const previousCisneEnv = process.env['CISNE_ENV'];
    process.env['CISNE_ENV'] = 'production';
    const identityId = await seedActor();
    try {
      await expect(
        runSyntheticBusinessSeed(pool, buildSyntheticActor(identityId), harness.services, {
          scenarios: [
            {
              key: 'test-prod-block',
              displayLabel: 'Cliente bloqueio produção',
              cnpjIndex: 9301,
              flow: { kind: 'client_inactive' },
            },
          ],
        }),
      ).rejects.toThrow(/forbidden/i);
    } finally {
      process.env['NODE_ENV'] = 'test';
      if (previousCisneEnv === undefined) delete process.env['CISNE_ENV'];
      else process.env['CISNE_ENV'] = previousCisneEnv;
    }
  });

  it('compensates after injected client-create failure', async () => {
    const identityId = await seedActor();
    const scenarioKey = `test-recovery-${randomUUID().slice(0, 8)}`;
    const scenario = {
      key: scenarioKey,
      displayLabel: 'Cliente teste recovery',
      cnpjIndex: 9400 + Math.floor(Math.random() * 100),
      flow: { kind: 'client_inactive' as const },
    };
    const actor = buildSyntheticActor(identityId);

    await expect(
      runSyntheticBusinessSeed(pool, actor, harness.services, {
        scenarios: [scenario],
        injectFailureAfterClientCreate: true,
      }),
    ).rejects.toThrow(/INJECTED_FAILURE|after_client_create/i);

    const remaining = await findSyntheticNamespaceClientId(pool, scenarioKey);
    expect(remaining).toBeNull();

    const recovered = await runSyntheticBusinessSeed(pool, actor, harness.services, {
      scenarios: [scenario],
    });
    expect(recovered.scenarios[0]?.outcome).toBe('created');
  });

  it('detects and compensates incomplete namespace scenario before retry', async () => {
    const identityId = await seedActor();
    const scenarioKey = `test-incomplete-${randomUUID().slice(0, 8)}`;
    const scenario = {
      key: scenarioKey,
      displayLabel: 'Cliente incompleto',
      cnpjIndex: 9500 + Math.floor(Math.random() * 100),
      flow: { kind: 'client_inactive' as const },
    };
    const actor = buildSyntheticActor(identityId);
    const externalRef = `${SYNTHETIC_SEED_NAMESPACE}:${scenarioKey}`;

    try {
      const fictional = buildDeterministicSyntheticClient(
        scenario.displayLabel,
        scenario.key,
        scenario.cnpjIndex,
      );
      await harness.services.clientAccess.create(actor, {
        legalName: fictional.legalName,
        tradeName: fictional.tradeName,
        taxId: fictional.taxId,
        externalErpId: externalRef,
        contacts: [
          {
            name: fictional.contactName,
            purpose: CONTACT_PURPOSES.Operational,
            phone: '69999000000',
          },
        ],
      });

      const result = await runSyntheticBusinessSeed(pool, actor, harness.services, {
        scenarios: [scenario],
      });
      expect(result.scenarios[0]?.outcome).toBe('created');
    } finally {
      await compensateSyntheticScenario(pool, scenarioKey).catch(() => undefined);
    }
  });

  it('converges under concurrent advisory lock', async () => {
    const identityId = await seedActor();
    const scenarioKey = `test-concurrent-${randomUUID().slice(0, 8)}`;
    const scenario = {
      key: scenarioKey,
      displayLabel: 'Cliente teste concorrente',
      cnpjIndex: 9200 + Math.floor(Math.random() * 100),
      flow: { kind: 'client_inactive' as const },
    };
    const actor = buildSyntheticActor(identityId);

    try {
      const results = await Promise.all([
        runSyntheticBusinessSeed(pool, actor, harness.services, { scenarios: [scenario] }),
        runSyntheticBusinessSeed(pool, actor, harness.services, { scenarios: [scenario] }),
      ]);
      const outcomes = results.flatMap((entry) => entry.scenarios.map((s) => s.outcome));
      expect(outcomes.filter((o) => o === 'created').length).toBe(1);
      expect(outcomes.filter((o) => o === 'already_present').length).toBe(1);
    } finally {
      await compensateSyntheticScenario(pool, scenarioKey).catch(() => undefined);
    }
  });
});

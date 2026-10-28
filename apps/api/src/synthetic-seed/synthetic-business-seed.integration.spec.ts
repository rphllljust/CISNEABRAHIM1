import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compensateSyntheticScenario,
  findSyntheticNamespaceClientId,
  hashPassword,
  insertIdentity,
  SYNTHETIC_SEED_CONFIRM_ENV,
  SYNTHETIC_SEED_CONFIRM_VALUE,
  SYNTHETIC_SEED_NAMESPACE,
} from '@cisne/database';
import { AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { buildDeterministicSyntheticClient } from '../master-business/synthetic-test-data';
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { grantUatProfile } from '../uat/uat-vertical-runner';
import {
  buildSyntheticActor,
  closeSyntheticSeedHarness,
  prepareSyntheticSeedHarness,
  type SyntheticSeedHarness,
} from './synthetic-seed-harness';
import { runSyntheticBusinessSeed } from './synthetic-business-seed-runner';

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

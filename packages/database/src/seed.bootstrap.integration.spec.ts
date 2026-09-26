import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEVELOPMENT_SEED_LOGIN } from './seed/constants';
import { runDevelopmentSeed } from './seed/development-seed';
import {
  CONTROLE_FINANCEIRO_LOGIN,
  EMPREGADO_LOGIN,
  runOperationalProfilesSeed,
} from './seed/operational-profiles';
import { runProductionBootstrap } from './seed/production-bootstrap';
import type { SafeSeedResult } from './seed/types';
import { IdentityTestBuilders, truncateIdentityTables } from './test-builders/identity-builders';

const STRONG_PASSWORD = 'Str0ng!Bootstrap-99';

function assertNoCredentialLeak(result: SafeSeedResult): void {
  expect(result).not.toHaveProperty('password');
  expect(result).not.toHaveProperty('passwordHash');
  expect(result).not.toHaveProperty('token');
  expect(result).not.toHaveProperty('tokenHash');

  const serialized = JSON.stringify(result);
  expect(serialized).not.toMatch(/scrypt\$/);
  expect(serialized).not.toMatch(/\$2[aby]\$/);
}

describe('seed and bootstrap (PostgreSQL integration)', () => {
  let pool: Pool;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
  let originalNodeEnv: string | undefined;

  beforeAll(() => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for seed integration tests.');
    }

    pool = new Pool({ connectionString: testDatabaseUrl });
    originalNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';
  });

  afterEach(async () => {
    await truncateIdentityTables(pool);
  });

  afterAll(async () => {
    process.env['NODE_ENV'] = originalNodeEnv;
    await pool.end();
  });

  it('runs DEVELOPMENT_SEED idempotently', async () => {
    const first = await runDevelopmentSeed(pool, {
      password: 'Dev-Only-1!Synthetic',
    });
    const second = await runDevelopmentSeed(pool, {
      password: 'Dev-Only-1!Synthetic',
    });

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('already_exists');
    expect(first.login).toBe(DEVELOPMENT_SEED_LOGIN);
    expect(second.identityId).toBe(first.identityId);

    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM identity.credentials
       WHERE login_identifier_normalized = $1`,
      [DEVELOPMENT_SEED_LOGIN],
    );
    expect(Number(count.rows[0]?.count)).toBe(1);
  });

  it('does not expose password or hash in seed result', async () => {
    const result = await runDevelopmentSeed(pool, {
      password: 'Dev-Only-1!Synthetic',
    });
    assertNoCredentialLeak(result);
  });

  it('seeds static owners and developer with least privilege for the operational employee', async () => {
    const result = await runOperationalProfilesSeed(pool, {
      controlePassword: 'Dev-Only-1!Synthetic',
      controleFinanceiroPassword: 'Dev-Only-1!Synthetic',
      empregadoPassword: 'Dev-Only-1!Synthetic',
    });

    expect(result.empregadoLogin).toBe(EMPREGADO_LOGIN);
    expect(result.controleFinanceiroLogin).toBe(CONTROLE_FINANCEIRO_LOGIN);

    /**
     * EMPREGADO: somente ASSIGNED (perfil autoritativo `executor`). Nenhum grant
     * financeiro/contabil/fiscal e nenhum GLOBAL sobre OS. A versao anterior deste teste
     * afirmava "broad development access" e por isso passava apenas enquanto o bug de
     * sobre-privilegio existia; a correcao de 2026-09-25 (prompt-execution-log,
     * "CORRECAO DE PERMISSOES — EMPREGADO SOBRE-PRIVILEGIADO") tornou a afirmacao antiga
     * falsa. Aqui ela passa a verificar a regra registrada, nao o comportamento antigo.
     */
    const empregadoSensitive = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM "authorization".grants
       WHERE identity_id = $1
         AND revoked_at IS NULL
         AND (
           action LIKE 'finance:%'
           OR action LIKE 'accounting:%'
           OR action LIKE 'fiscal:%'
         )`,
      [result.empregadoIdentityId],
    );
    expect(Number(empregadoSensitive.rows[0]?.count)).toBe(0);

    const empregadoGlobalOrders = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM "authorization".grants
       WHERE identity_id = $1
         AND revoked_at IS NULL
         AND scope_type = 'GLOBAL'
         AND resource_type = 'service-orders:service-order'`,
      [result.empregadoIdentityId],
    );
    expect(Number(empregadoGlobalOrders.rows[0]?.count)).toBe(0);

    const empregadoAssignedOrders = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM "authorization".grants
       WHERE identity_id = $1
         AND revoked_at IS NULL
         AND scope_type = 'ASSIGNED'
         AND resource_type = 'service-orders:service-order'`,
      [result.empregadoIdentityId],
    );
    expect(Number(empregadoAssignedOrders.rows[0]?.count)).toBeGreaterThan(0);

    // O dono continua com o conjunto GLOBAL amplo de desenvolvimento (conveniencia dev).
    const ownerBroad = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM "authorization".grants
       WHERE identity_id = $1
         AND revoked_at IS NULL
         AND scope_type = 'GLOBAL'
         AND resource_type = 'service-orders:service-order'`,
      [result.controleIdentityId],
    );
    expect(Number(ownerBroad.rows[0]?.count)).toBeGreaterThan(0);

    const financeChecker = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM "authorization".approval_role_assignments
       WHERE identity_id = $1
         AND role_code = 'FINANCIAL_CONTROLLER'
         AND scope_type = 'UNIT'`,
      [result.controleFinanceiroIdentityId],
    );
    expect(Number(financeChecker.rows[0]?.count)).toBe(1);
  });

  it('blocks DEVELOPMENT_SEED when NODE_ENV=production', async () => {
    process.env['NODE_ENV'] = 'production';
    await expect(runDevelopmentSeed(pool, { password: 'Dev-Only-1!Synthetic' })).rejects.toThrow(
      /only permitted when NODE_ENV=development/,
    );
    process.env['NODE_ENV'] = 'development';
  });

  it('rejects PRODUCTION_BOOTSTRAP without confirmation token', async () => {
    const result = await runProductionBootstrap(pool, {
      login: 'bootstrap-admin@cisne.invalid',
      password: STRONG_PASSWORD,
      confirmToken: '',
    });
    expect(result.outcome).toBe('rejected');
    assertNoCredentialLeak(result);
  });

  it('rejects PRODUCTION_BOOTSTRAP with weak password', async () => {
    const result = await runProductionBootstrap(pool, {
      login: 'bootstrap-admin@cisne.invalid',
      password: 'weak',
      confirmToken: 'I_UNDERSTAND',
    });
    expect(result.outcome).toBe('rejected');
    expect(result.message).toMatch(/weak|characters/i);
  });

  it('creates first identity on empty database via PRODUCTION_BOOTSTRAP', async () => {
    const result = await runProductionBootstrap(pool, {
      login: 'bootstrap-admin@cisne.invalid',
      password: STRONG_PASSWORD,
      confirmToken: 'I_UNDERSTAND',
    });

    expect(result.outcome).toBe('created');
    assertNoCredentialLeak(result);

    const identities = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM identity.identities`,
    );
    expect(identities.rows[0]?.count).toBe(1);
  });

  it('rejects repeated PRODUCTION_BOOTSTRAP on initialized database', async () => {
    await runProductionBootstrap(pool, {
      login: 'bootstrap-admin@cisne.invalid',
      password: STRONG_PASSWORD,
      confirmToken: 'I_UNDERSTAND',
    });

    const repeat = await runProductionBootstrap(pool, {
      login: 'bootstrap-admin-2@cisne.invalid',
      password: STRONG_PASSWORD,
      confirmToken: 'I_UNDERSTAND',
    });

    expect(repeat.outcome).toBe('rejected');
    expect(repeat.message).toMatch(/already initialized/i);
  });

  it('isolates TEST_DATA_BUILDERS from DEVELOPMENT_SEED login', async () => {
    await runDevelopmentSeed(pool, { password: 'Dev-Only-1!Synthetic' });
    const builders = new IdentityTestBuilders(pool);
    const built = await builders.activeIdentity();

    expect(built.login).not.toBe(DEVELOPMENT_SEED_LOGIN);
    expect(built.login).toMatch(/@cisne\.invalid$/);
  });

  it('builds active, disabled, credential, and session variants', async () => {
    const builders = new IdentityTestBuilders(pool);

    const active = await builders.activeIdentity();
    const disabled = await builders.disabledIdentity();
    const credential = await builders.validCredential();
    const session = await builders.validSession(active.identityId);
    const expired = await builders.expiredSession(active.identityId);
    const revoked = await builders.revokedSession(active.identityId);

    expect(active.login).toMatch(/@cisne\.invalid$/);
    expect(disabled.login).toMatch(/@cisne\.invalid$/);
    expect(credential.login).toMatch(/@cisne\.invalid$/);
    expect(session.status).toBe('active');
    expect(expired.status).toBe('expired');
    expect(revoked.status).toBe('revoked');
  });
});

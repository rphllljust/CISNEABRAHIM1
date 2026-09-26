import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runOperationalProfilesSeed } from './operational-profiles';
import { truncateIdentityAndAuthorizationTables } from '../test-builders/authz-builders';
import { truncateIdentityTables } from '../test-builders/identity-builders';

/**
 * INTEGRIDADE DO SEED DE PERFIS OPERACIONAIS (PostgreSQL integration)
 *
 * Dois defeitos comprovados contra o banco real, ambos no mesmo grafo
 * (`authorization.approval_matrices` -> `approval_matrix_versions` -> `approval_matrix_rules`):
 *
 * 1. SIMETRIA DO BUILDER — `truncateIdentityTables` apaga o grafo de identidades por CASCADE,
 *    que alcanca versoes e regras (FK para `identity.identities`), mas NAO alcanca
 *    `approval_matrices`, porque a tabela de matriz nao tem FK para identidade (por desenho:
 *    a matriz vincula papel/capability/escopo/limite, nunca pessoa). A matriz sobrevivia orfa,
 *    com zero versoes — estado que nao ocorre por DELETE normal, ja que a FK de versoes para
 *    identidades e NO ACTION.
 *
 * 2. ATOMICIDADE — `ensureDevPaymentMatrix` executava matriz, versao, regra e atualizacao da
 *    matriz como statements soltos (autocommit). Uma falha no meio deixava estado parcial
 *    commitado: versao PUBLISHED sem nenhuma regra e `published_version` ainda NULL. O console
 *    de aprovacoes (`listMatricesOverview`) passa a exibir uma matriz publicada que nao aprova
 *    nada, porque o PDP resolve regras por `approval_matrix_rules` publicadas.
 *
 * A falha e injetada pelo banco (gatilho que aborta o INSERT da regra), nao por mock: o que se
 * verifica e o estado real que fica gravado quando a operacao logica nao completa.
 */

const MATRIX_CODE = 'DEV-PAYMENT-MATRIX';
const INJECTED_FAILURE = 'INJECTED_APPROVAL_RULE_FAILURE';

type MatrixCounts = { matrices: number; versions: number; rules: number };

describe('seed de perfis operacionais — integridade da matriz de aprovacao', () => {
  let pool: Pool;
  let originalNodeEnv: string | undefined;

  const seedProfiles = () =>
    runOperationalProfilesSeed(pool, {
      controlePassword: 'Dev-Only-1!Synthetic',
      controleFinanceiroPassword: 'Dev-Only-1!Synthetic',
      empregadoPassword: 'Dev-Only-1!Synthetic',
    });

  async function matrixCounts(): Promise<MatrixCounts> {
    const result = await pool.query<MatrixCounts>(
      `SELECT
         (SELECT count(*)::int FROM "authorization".approval_matrices) AS matrices,
         (SELECT count(*)::int FROM "authorization".approval_matrix_versions) AS versions,
         (SELECT count(*)::int FROM "authorization".approval_matrix_rules) AS rules`,
    );
    return result.rows[0]!;
  }

  beforeAll(async () => {
    const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for seed integrity tests.');
    }
    pool = new Pool({ connectionString: testDatabaseUrl });
    originalNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterEach(async () => {
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    process.env['NODE_ENV'] = originalNodeEnv;
    await pool.end();
  });

  it('o seed cria exatamente uma matriz publicada com uma regra de pagamento', async () => {
    await seedProfiles();

    expect(await matrixCounts()).toEqual({ matrices: 1, versions: 1, rules: 1 });

    const published = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM "authorization".approval_matrix_versions
        WHERE status = 'PUBLISHED'`,
    );
    expect(published.rows[0]?.count).toBe('1');
  });

  it('converge quando a matriz ja existe (idempotencia da segunda execucao)', async () => {
    const first = await seedProfiles();
    const second = await seedProfiles();

    expect(second.controleIdentityId).toBe(first.controleIdentityId);
    expect(second.controleFinanceiroIdentityId).toBe(first.controleFinanceiroIdentityId);
    expect(await matrixCounts()).toEqual({ matrices: 1, versions: 1, rules: 1 });
  });

  it('converge a partir de matriz orfa sem versoes (ancoragem no code, nao na leitura da regra)', async () => {
    await seedProfiles();

    // Estado orfo: a matriz sobrevive sem nenhuma versao. A guarda antiga (regra publicada
    // existente) passava e o INSERT estourava `approval_matrices_code_uidx`.
    await pool.query(
      `DELETE FROM "authorization".approval_matrix_rules
        WHERE version_id IN (
          SELECT v.id
            FROM "authorization".approval_matrix_versions v
            JOIN "authorization".approval_matrices m ON m.id = v.matrix_id
           WHERE m.code = $1
        )`,
      [MATRIX_CODE],
    );
    await pool.query(
      `DELETE FROM "authorization".approval_matrix_versions
        WHERE matrix_id = (SELECT id FROM "authorization".approval_matrices WHERE code = $1)`,
      [MATRIX_CODE],
    );
    expect(await matrixCounts()).toEqual({ matrices: 1, versions: 0, rules: 0 });

    await seedProfiles();

    expect(await matrixCounts()).toEqual({ matrices: 1, versions: 1, rules: 1 });
  });

  it('nao deixa matriz orfa depois do truncate de identidades (setup e cleanup simetricos)', async () => {
    await seedProfiles();
    expect(await matrixCounts()).toEqual({ matrices: 1, versions: 1, rules: 1 });

    await truncateIdentityTables(pool);

    const residue = await matrixCounts();
    expect(
      residue.matrices,
      'approval_matrices sobreviveu ao truncate: matriz orfa sem versoes nem regras',
    ).toBe(0);
    expect(residue).toEqual({ matrices: 0, versions: 0, rules: 0 });
  });

  it('a matriz e criada como uma unica operacao: falha injetada nao deixa estado parcial', async () => {
    await pool.query(`
      CREATE OR REPLACE FUNCTION "authorization".__inject_approval_rule_failure()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '${INJECTED_FAILURE}';
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER __inject_approval_rule_failure
      BEFORE INSERT ON "authorization".approval_matrix_rules
      FOR EACH ROW EXECUTE FUNCTION "authorization".__inject_approval_rule_failure()
    `);

    try {
      await expect(seedProfiles()).rejects.toThrow(INJECTED_FAILURE);
    } finally {
      await pool.query(
        `DROP TRIGGER IF EXISTS __inject_approval_rule_failure ON "authorization".approval_matrix_rules`,
      );
      await pool.query(
        `DROP FUNCTION IF EXISTS "authorization".__inject_approval_rule_failure()`,
      );
    }

    expect(
      await matrixCounts(),
      'a falha na regra deixou matriz/versao commitadas: a operacao logica nao e atomica',
    ).toEqual({ matrices: 0, versions: 0, rules: 0 });
  });
});

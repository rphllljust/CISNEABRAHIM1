import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assessPendingMigrations,
  assertSafeMigrationDeploy,
  readAppliedMigrationTags,
} from './migration-policy';

/**
 * GATE DE MIGRATION ESCOPADO AO DELTA.
 *
 * O defeito medido em producao (CD run 39682188718): `assessMigrationsDirectory()` varria as 104
 * migrations do repositorio e encontrava para sempre as MESMAS QUATRO do passado que usam
 * `ALTER COLUMN`/`DROP CONSTRAINT`:
 *
 *   0010_physical_resource_types, 0071_operational_authority_gates,
 *   0078_workforce_member_allocation, 0088_metadata_views_v4
 *
 * Resultado: `Enforce existing migration safety policy` reprovava uma release em que NENHUMA
 * migration nova existia. O gate bloqueava TODA promocao, permanentemente, e a unica saida
 * aparente seria `CD_ALLOW_BREAKING_MIGRATIONS=I_UNDERSTAND` — que desliga a protecao para
 * todo o futuro.
 *
 * A intencao estava certa; o CONJUNTO analisado estava errado. Migration ja aplicada e HISTORIA,
 * nao risco de release. O que pode quebrar a proxima promocao e a migration que ainda vai rodar.
 *
 * Os tres criterios de aceite que estes testes cobrem:
 *
 *   1. as quatro historicas DEIXAM DE APARECER no gate;
 *   2. uma migration nova deliberadamente high-risk CONTINUA sendo bloqueada;
 *   3. uma migration nova segura PASSA.
 */

const BREAKING_SQL = 'ALTER TABLE "x"."y" DROP COLUMN "z";';
const SAFE_SQL = 'ALTER TABLE "x"."y" ADD COLUMN "novo" text;';

type Fixture = { dir: string; cleanup: () => void };

function createMigrationsFixture(files: Record<string, string>, journalTags: string[]): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'cisne-migration-policy-'));
  mkdirSync(join(dir, 'meta'), { recursive: true });
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql, 'utf8');
  }
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: journalTags.map((tag, index) => ({ idx: index, tag, breakpoints: true })),
    }),
    'utf8',
  );
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const fixtures: Fixture[] = [];
afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

function fixture(files: Record<string, string>, journalTags: string[]): string {
  const created = createMigrationsFixture(files, journalTags);
  fixtures.push(created);
  return created.dir;
}

describe('assessPendingMigrations — escopo ao delta', () => {
  it('IGNORA migration historica ja aplicada que usa padrao destrutivo', () => {
    /*
     * Criterio 1: as quatro historicas (0010, 0071, 0078, 0088) deixam de aparecer.
     *
     * Simula exatamente o estado real: migrations antigas com ALTER COLUMN/DROP no journal,
     * nenhuma pendente. Antes, o gate reprovava; agora, `pending` fica vazio.
     */
    const dir = fixture(
      {
        '0010_physical_resource_types.sql': BREAKING_SQL,
        '0071_operational_authority_gates.sql': BREAKING_SQL,
        '0078_workforce_member_allocation.sql': BREAKING_SQL,
        '0088_metadata_views_v4.sql': BREAKING_SQL,
      },
      [
        '0010_physical_resource_types',
        '0071_operational_authority_gates',
        '0078_workforce_member_allocation',
        '0088_metadata_views_v4',
      ],
    );

    const { pending, applied } = assessPendingMigrations(dir);

    expect(applied).toHaveLength(4);
    expect(pending).toEqual([]);
    // E o gate passa — que e o ponto: nenhuma migration NOVA, nenhum risco de release.
    expect(() => assertSafeMigrationDeploy(pending, false)).not.toThrow();
  });

  it('BLOQUEIA migration nova high-risk ainda pendente', () => {
    /*
     * Criterio 2: uma migration nova deliberadamente destrutiva continua sendo bloqueada.
     * O gate nao foi desligado — foi escopado.
     */
    const dir = fixture(
      {
        '0010_historical.sql': BREAKING_SQL,
        '0104_nova_destrutiva.sql': BREAKING_SQL,
      },
      ['0010_historical'],
    );

    const { pending } = assessPendingMigrations(dir);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.file).toBe('0104_nova_destrutiva.sql');
    expect(pending[0]?.risk).toBe('breaking-high-risk');
    expect(() => assertSafeMigrationDeploy(pending, false)).toThrow(
      /Breaking\/high-risk migrations detected/i,
    );
  });

  it('PERMITE migration nova segura', () => {
    /* Criterio 3: migration aditiva (ADD COLUMN) nao bloqueia a release. */
    const dir = fixture(
      {
        '0010_historical.sql': BREAKING_SQL,
        '0104_nova_segura.sql': SAFE_SQL,
      },
      ['0010_historical'],
    );

    const { pending } = assessPendingMigrations(dir);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.file).toBe('0104_nova_segura.sql');
    expect(pending[0]?.risk).toBe('backward-compatible');
    expect(() => assertSafeMigrationDeploy(pending, false)).not.toThrow();
  });

  it('mistura historica destrutiva + nova segura: nao bloqueia', () => {
    /*
     * O caso real do CISNE: historico cheio de ALTER COLUMN, release apenas aditiva.
     * Antes, este cenario era impossivel de passar.
     */
    const dir = fixture(
      {
        '0010_a.sql': BREAKING_SQL,
        '0088_b.sql': BREAKING_SQL,
        '0104_c.sql': SAFE_SQL,
      },
      ['0010_a', '0088_b'],
    );

    const { pending } = assessPendingMigrations(dir);

    expect(pending.map((entry) => entry.file)).toEqual(['0104_c.sql']);
    expect(() => assertSafeMigrationDeploy(pending, false)).not.toThrow();
  });
});

describe('readAppliedMigrationTags — fail-closed', () => {
  it('LANCA quando o journal nao existe', () => {
    /*
     * FAIL-CLOSED. Devolver `[]` significaria "nada aplicado, tudo pendente" — ou, pior, se
     * usado como filtro invertido, "nada pendente". Nos dois casos o deploy passaria sem avaliar.
     * O gate tem de falhar ALTO.
     */
    const dir = mkdtempSync(join(tmpdir(), 'cisne-migration-policy-'));
    fixtures.push({ dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) });

    expect(() => readAppliedMigrationTags(join(dir, 'meta', '_journal.json'))).toThrow();
  });

  it('LANCA quando o journal nao tem `entries`', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cisne-migration-policy-'));
    fixtures.push({ dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) });
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ version: '7' }), 'utf8');

    expect(() => readAppliedMigrationTags(join(dir, 'meta', '_journal.json'))).toThrow(
      /missing entries/i,
    );
  });

  it('LANCA quando o journal e JSON invalido', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cisne-migration-policy-'));
    fixtures.push({ dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) });
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(join(dir, 'meta', '_journal.json'), '{ not json', 'utf8');

    expect(() => readAppliedMigrationTags(join(dir, 'meta', '_journal.json'))).toThrow();
  });
});

describe('CD_ALLOW_BREAKING_MIGRATIONS permanece escape manual', () => {
  it('nao bloqueia quando explicitamente autorizado', () => {
    /*
     * O escape continua existindo, mas so funciona quando alguem escreve I_UNDERSTAND
     * deliberadamente. NUNCA e o padrao — o gate nao foi desativado, foi escopado.
     */
    const dir = fixture({ '0104_nova_destrutiva.sql': BREAKING_SQL }, []);
    const { pending } = assessPendingMigrations(dir);

    expect(() => assertSafeMigrationDeploy(pending, false)).toThrow();
    expect(() => assertSafeMigrationDeploy(pending, true)).not.toThrow();
  });
});

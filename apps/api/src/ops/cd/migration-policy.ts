import { existsSync } from 'node:fs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MigrationAssessment, MigrationRisk } from './cd-types';

function findMigrationsDirectory(): string {
  const candidates = [
    resolve(process.cwd(), 'packages/database/migrations'),
    resolve(process.cwd(), '../../packages/database/migrations'),
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (!found) {
    throw new Error('packages/database/migrations not found');
  }
  return found;
}

const BREAKING_PATTERNS: Array<{ pattern: RegExp; rationale: string }> = [
  { pattern: /\bDROP\s+TABLE\b/i, rationale: 'DROP TABLE is destructive' },
  { pattern: /\bDROP\s+COLUMN\b/i, rationale: 'DROP COLUMN requires expand/contract' },
  { pattern: /\bTRUNCATE\b/i, rationale: 'TRUNCATE is destructive' },
  { pattern: /\bALTER\s+COLUMN\b/i, rationale: 'ALTER COLUMN may break old application code' },
  { pattern: /\bDROP\s+CONSTRAINT\b/i, rationale: 'DROP CONSTRAINT can break compatibility' },
];

const COMPATIBLE_PATTERNS: Array<{ pattern: RegExp; rationale: string }> = [
  { pattern: /\bADD\s+COLUMN\b/i, rationale: 'ADD COLUMN is expand-phase compatible' },
  { pattern: /\bCREATE\s+(UNIQUE\s+)?INDEX\b/i, rationale: 'CREATE INDEX is backward-compatible' },
  { pattern: /\bCREATE\s+TABLE\b/i, rationale: 'CREATE TABLE is additive' },
];

function classifySql(sql: string, file: string): MigrationAssessment {
  for (const rule of BREAKING_PATTERNS) {
    if (rule.pattern.test(sql)) {
      return { file, risk: 'breaking-high-risk', rationale: rule.rationale };
    }
  }
  for (const rule of COMPATIBLE_PATTERNS) {
    if (rule.pattern.test(sql)) {
      return { file, risk: 'backward-compatible', rationale: rule.rationale };
    }
  }
  return { file, risk: 'backward-compatible', rationale: 'No destructive pattern detected' };
}

export function assessMigrationFile(filePath: string): MigrationAssessment {
  const sql = readFileSync(filePath, 'utf8');
  return classifySql(sql, filePath.split(/[/\\]/).pop() ?? filePath);
}

export function assessMigrationsDirectory(migrationsDir = findMigrationsDirectory()): MigrationAssessment[] {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(migrationsDir, name));
  return files.map((file) => assessMigrationFile(file));
}

/** Tag de migration sem a extensao: `0103_saved_views.sql` -> `0103_saved_views`. */
function migrationTag(fileName: string): string {
  return fileName.replace(/\.sql$/, '');
}

/**
 * Tags registradas no journal do Drizzle — a fonte de "o que o repositorio considera aplicado".
 *
 * O journal (`meta/_journal.json`) e versionado junto das migrations e e exatamente o que
 * `drizzle-kit migrate` consulta para decidir o que aplicar. Nao inventamos um segundo registro:
 * usar o mesmo arquivo garante que o gate e o migrator enxerguem o MESMO conjunto.
 */
export function readAppliedMigrationTags(
  journalPath = join(findMigrationsDirectory(), 'meta', '_journal.json'),
): string[] {
  const raw = readFileSync(journalPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid migrations journal: not an object');
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new Error('Invalid migrations journal: missing entries');
  }
  const tags: string[] = [];
  for (const entry of entries) {
    const tag = (entry as { tag?: unknown }).tag;
    if (typeof tag === 'string' && tag.length > 0) {
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Avalia APENAS as migrations ainda NAO registradas no journal — o delta real de release.
 *
 * ---------------------------------------------------------------------------------------------
 * O DEFEITO QUE ESTA FUNCAO CORRIGE
 * ---------------------------------------------------------------------------------------------
 *
 * `assessMigrationsDirectory()` varre o diretorio inteiro. Como o repositorio acumula 104
 * migrations, o gate encontrava para sempre as mesmas quatro do PASSADO que usam
 * `ALTER COLUMN`/`DROP CONSTRAINT` — `0010_physical_resource_types`, `0071_operational_authority_gates`,
 * `0078_workforce_member_allocation`, `0088_metadata_views_v4`.
 *
 * Medido no CD run 39682188718: `Enforce existing migration safety policy` reprovou uma release
 * em que NENHUMA migration nova existia. Efeito pratico — o gate bloqueava TODA promocao,
 * permanentemente, e a unica saida aparente seria `CD_ALLOW_BREAKING_MIGRATIONS=I_UNDERSTAND`,
 * que desliga a protecao para todo o futuro.
 *
 * A INTENCAO do gate estava certa (impedir migration destrutiva), o CONJUNTO analisado estava
 * errado: migration ja aplicada nao e risco de release, e HISTORIA. O que pode quebrar a proxima
 * promocao e a migration que ainda vai rodar.
 *
 * ---------------------------------------------------------------------------------------------
 * FAIL-CLOSED
 * ---------------------------------------------------------------------------------------------
 *
 * Se o journal nao puder ser lido (arquivo ausente, JSON invalido, `entries` ausente), esta
 * funcao LANCA em vez de devolver lista vazia. Devolver `[]` significaria "nada pendente" — a
 * conclusao mais perigosa possivel — e o deploy passaria sem avaliar nada.
 */
export function assessPendingMigrations(
  migrationsDir = findMigrationsDirectory(),
): { pending: MigrationAssessment[]; applied: string[] } {
  const applied = readAppliedMigrationTags(join(migrationsDir, 'meta', '_journal.json'));
  const appliedSet = new Set(applied);

  const pendingFiles = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    // O delta e o que NAO esta no journal. Migration historica ja aplicada nunca entra no risco.
    .filter((name) => !appliedSet.has(migrationTag(name)))
    .sort()
    .map((name) => join(migrationsDir, name));

  return {
    pending: pendingFiles.map((file) => assessMigrationFile(file)),
    applied,
  };
}

export function assertSafeMigrationDeploy(
  assessments: MigrationAssessment[],
  allowBreaking: boolean,
): void {
  const breaking = assessments.filter((entry) => entry.risk === 'breaking-high-risk');
  if (breaking.length > 0 && !allowBreaking) {
    const names = breaking.map((entry) => entry.file).join(', ');
    throw new Error(
      `Breaking/high-risk migrations detected (${names}). Use expand/contract or set CD_ALLOW_BREAKING_MIGRATIONS=I_UNDERSTAND with coordinated deploy.`,
    );
  }
}

export function summarizeMigrationRisk(assessments: MigrationAssessment[]): Record<MigrationRisk, number> {
  return assessments.reduce(
    (acc, entry) => {
      acc[entry.risk] += 1;
      return acc;
    },
    { 'backward-compatible': 0, 'breaking-high-risk': 0 } as Record<MigrationRisk, number>,
  );
}

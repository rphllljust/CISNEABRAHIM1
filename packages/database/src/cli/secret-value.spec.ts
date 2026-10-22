import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSecretValue } from './secret-value';

/**
 * O runner de migrations precisa aceitar a credencial montada como arquivo
 * (`DATABASE_URL_FILE`): em producao o Coolify entrega o secret por arquivo, e
 * exigir a URL inline forcaria o valor a existir no environment do processo.
 *
 * Estes testes fixam o contrato fail-closed do resolvedor.
 */
let workDir: string | null = null;

function createWorkDir(): string {
  workDir = mkdtempSync(join(tmpdir(), 'cisne-migrate-cli-'));
  return workDir;
}

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = null;
  }
});

describe('readSecretValue', () => {
  it('reads the URL from DATABASE_URL_FILE, trimming the trailing newline', () => {
    const dir = createWorkDir();
    const file = join(dir, 'db_url');
    writeFileSync(file, 'postgres://cisne:secret@db:5432/cisne_production\n', 'utf8');

    expect(readSecretValue('DATABASE_URL', { DATABASE_URL_FILE: file })).toBe(
      'postgres://cisne:secret@db:5432/cisne_production',
    );
  });

  it('prefers DATABASE_URL_FILE over an inline DATABASE_URL', () => {
    const dir = createWorkDir();
    const file = join(dir, 'db_url');
    writeFileSync(file, 'postgres://from-file/db', 'utf8');

    expect(
      readSecretValue('DATABASE_URL', {
        DATABASE_URL_FILE: file,
        DATABASE_URL: 'postgres://from-env/db',
      }),
    ).toBe('postgres://from-file/db');
  });

  it('falls back to inline DATABASE_URL when no file is configured', () => {
    expect(readSecretValue('DATABASE_URL', { DATABASE_URL: ' postgres://inline/db ' })).toBe(
      'postgres://inline/db',
    );
  });

  it('returns undefined when neither is configured', () => {
    expect(readSecretValue('DATABASE_URL', {})).toBeUndefined();
  });

  it('fails closed when the secret file does not exist', () => {
    expect(() =>
      readSecretValue('DATABASE_URL', {
        DATABASE_URL_FILE: join(tmpdir(), 'cisne-does-not-exist-1234'),
      }),
    ).toThrow(/DATABASE_URL_FILE cannot be read/);
  });

  it('fails closed when the secret file is empty', () => {
    const dir = createWorkDir();
    const file = join(dir, 'empty');
    writeFileSync(file, '\n  \n', 'utf8');

    expect(() => readSecretValue('DATABASE_URL', { DATABASE_URL_FILE: file })).toThrow(
      /points to an empty secret file/,
    );
  });
});

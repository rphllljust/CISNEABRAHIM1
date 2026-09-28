import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoInlineSecrets, readSecretValue } from './secret-value';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('secret-value', () => {
  it('prefers mounted secret files over inline values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cisne-secret-'));
    dirs.push(dir);
    const secretFile = join(dir, 'jwt');
    writeFileSync(secretFile, 'file-backed-secret\n', 'utf8');

    const value = readSecretValue(
      {
        JWT_SECRET: 'inline-secret',
        JWT_SECRET_FILE: secretFile,
      },
      'JWT_SECRET',
    );

    expect(value).toBe('file-backed-secret');
  });

  it('fails when a configured secret file cannot be read', () => {
    expect(() =>
      readSecretValue(
        { JWT_SECRET_FILE: '/path/that/does/not/exist' },
        'JWT_SECRET',
      ),
    ).toThrow(/JWT_SECRET_FILE cannot be read/);
  });

  it('rejects inline secrets when a store-backed policy is required', () => {
    expect(() =>
      assertNoInlineSecrets(
        { JWT_SECRET: 'inline-secret', DATABASE_URL: 'postgresql://inline' },
        ['JWT_SECRET', 'DATABASE_URL'],
      ),
    ).toThrow(/JWT_SECRET, DATABASE_URL/);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { collectRuntimeConfigErrors } from './runtime-config';

const ORIGINAL_ENV = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...ORIGINAL_ENV };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

const PROD_API_OK: Record<string, string> = {
  NODE_ENV: 'production',
  CISNE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@postgres:5432/cisne_production',
  JWT_SECRET: 'a'.repeat(40),
  OBJECT_STORAGE_PROVIDER: 's3',
  OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
  OBJECT_STORAGE_S3_ACCESS_KEY_ID: 'key',
  OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('runtime config validation', () => {
  it('accepts a complete production API configuration', () => {
    expect(collectRuntimeConfigErrors('api', withEnv(PROD_API_OK))).toEqual([]);
  });

  it('accepts a complete production worker configuration', () => {
    const env = withEnv({
      NODE_ENV: 'production',
      CISNE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@postgres:5432/cisne_production',
      JWT_SECRET: 'b'.repeat(40),
    });
    expect(collectRuntimeConfigErrors('worker', env)).toEqual([]);
  });

  it('fails fast when DATABASE_URL is missing in a production-like env', () => {
    const errors = collectRuntimeConfigErrors('api', withEnv({ ...PROD_API_OK, DATABASE_URL: '' }));
    expect(errors.some((e) => e.startsWith('DATABASE_URL:'))).toBe(true);
  });

  it('fails when DATABASE_URL is not a postgres URL', () => {
    const errors = collectRuntimeConfigErrors(
      'api',
      withEnv({ ...PROD_API_OK, DATABASE_URL: 'mysql://host/db' }),
    );
    expect(errors.some((e) => e.startsWith('DATABASE_URL: invalid'))).toBe(true);
  });

  it('reports short or missing JWT_SECRET', () => {
    const short = collectRuntimeConfigErrors(
      'api',
      withEnv({ ...PROD_API_OK, JWT_SECRET: 'short' }),
    );
    const missing = collectRuntimeConfigErrors('api', withEnv({ ...PROD_API_OK, JWT_SECRET: '' }));
    expect(short.some((e) => e.startsWith('JWT_SECRET:'))).toBe(true);
    expect(missing.some((e) => e.startsWith('JWT_SECRET:'))).toBe(true);
  });

  it('requires static S3 credentials when IAM role is not configured', () => {
    const env = withEnv({
      ...PROD_API_OK,
      OBJECT_STORAGE_ENDPOINT: '',
      OBJECT_STORAGE_S3_ACCESS_KEY_ID: '',
      OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: '',
      OBJECT_STORAGE_IAM_ROLE: 'false',
    });
    const errors = collectRuntimeConfigErrors('api', env);
    expect(errors.some((e) => e.includes('S3_ACCESS_KEY_ID'))).toBe(true);
    expect(errors.some((e) => e.includes('S3_SECRET_ACCESS_KEY'))).toBe(true);
    expect(errors.some((e) => e.startsWith('OBJECT_STORAGE_ENDPOINT:'))).toBe(false);
  });

  it('accepts native S3 with IAM role and no static credentials or custom endpoint', () => {
    const env = withEnv({
      NODE_ENV: 'production',
      CISNE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@host/db',
      JWT_SECRET: 'c'.repeat(40),
      OBJECT_STORAGE_PROVIDER: 's3',
      OBJECT_STORAGE_BUCKET: 'cisne-prod-documents',
      OBJECT_STORAGE_IAM_ROLE: 'true',
      OBJECT_STORAGE_ENDPOINT: '',
      OBJECT_STORAGE_S3_ACCESS_KEY_ID: '',
      OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: '',
    });
    expect(collectRuntimeConfigErrors('api', env)).toEqual([]);
  });

  it('accepts S3 aliases used by infra env files (S3_ACCESS_KEY_ID / OBJECT_STORAGE_ENDPOINT)', () => {
    const env = withEnv({
      NODE_ENV: 'production',
      CISNE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@host/db',
      JWT_SECRET: 'c'.repeat(40),
      OBJECT_STORAGE_PROVIDER: 's3',
      OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
      S3_ACCESS_KEY_ID: 'alias-key',
      S3_SECRET_ACCESS_KEY: 'alias-secret',
    });
    expect(collectRuntimeConfigErrors('api', env)).toEqual([]);
  });

  it('rejects unsupported object storage provider values', () => {
    const errors = collectRuntimeConfigErrors(
      'api',
      withEnv({ ...PROD_API_OK, OBJECT_STORAGE_PROVIDER: 'nfs' }),
    );
    expect(errors.some((e) => e.startsWith('OBJECT_STORAGE_PROVIDER:'))).toBe(true);
  });

  it('rejects a non-numeric PORT and an empty API_HOST', () => {
    const badPort = collectRuntimeConfigErrors('api', withEnv({ ...PROD_API_OK, PORT: 'abc' }));
    const emptyHost = collectRuntimeConfigErrors('api', withEnv({ ...PROD_API_OK, API_HOST: ' ' }));
    expect(badPort.some((e) => e.startsWith('PORT:'))).toBe(true);
    expect(emptyHost.some((e) => e.startsWith('API_HOST:'))).toBe(true);
  });

  it('only warns (does not error) when DATABASE_URL is missing in development', () => {
    const errors = collectRuntimeConfigErrors(
      'api',
      withEnv({ NODE_ENV: 'development', DATABASE_URL: undefined, JWT_SECRET: 'd'.repeat(40) }),
    );
    expect(errors.every((e) => !e.startsWith('DATABASE_URL: is required'))).toBe(true);
    expect(errors.some((e) => e.startsWith('DATABASE_URL: missing'))).toBe(true);
  });
});

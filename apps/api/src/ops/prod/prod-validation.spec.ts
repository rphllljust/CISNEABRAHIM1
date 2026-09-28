import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveComputeSizing, PERF_FULL_MAX_CONCURRENCY } from './prod-sizing';
import { assertNetworkPolicy, evaluateNetworkPolicy, parseExposedPorts } from './prod-network';
import { assertScalingCompatibility, evaluateScalingCompatibility } from './prod-scaling';
import { scanConfigForEmbeddedSecrets } from './prod-secrets';
import { runProdInfrastructureValidation } from './prod-validation';

const TEST_DIGEST = 'a'.repeat(64);

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CISNE_ENV: 'production',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://cisne:secret@postgres.internal:5432/cisne_production?sslmode=require',
    DATABASE_POOL_MAX: '10',
    OBJECT_STORAGE_PROVIDER: 's3',
    OBJECT_STORAGE_BUCKET: 'cisne-prod-documents',
    OBJECT_STORAGE_ENDPOINT: 'http://minio.internal:9000',
    OBJECT_STORAGE_VERSIONING: 'true',
    OBJECT_STORAGE_LIFECYCLE_CONFIGURED: 'true',
    OBJECT_STORAGE_IAM_ROLE: 'true',
    BACKUP_USE_DEDICATED_ROLE: 'true',
    BACKUP_ENABLE_POSTGRES: 'true',
    BACKUP_ENABLE_OBJECT_STORAGE: 'true',
    BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    PROD_PUBLIC_API_URL: 'https://api.cisne.example',
    PROD_PUBLIC_WEB_URL: 'https://app.cisne.example',
    PROD_REQUIRE_TLS: 'true',
    PROD_REQUIRE_DB_TLS: 'true',
    PROD_REQUIRE_SECRET_STORE: 'false',
    JWT_SECRET: 'production-jwt-secret-with-sufficient-length-32',
    PROD_COST_ALERTS_ENABLED: 'true',
    PROD_MONTHLY_BUDGET_USD: '500',
    PROD_EXPOSED_PORTS: '80,443',
    PROD_POSTGRES_IMAGE: `postgres:18-alpine@sha256:${TEST_DIGEST}`,
    PROD_MINIO_IMAGE: `minio/minio@sha256:${TEST_DIGEST}`,
    PROD_MINIO_MC_IMAGE: `minio/mc@sha256:${TEST_DIGEST}`,
    PROD_CADDY_IMAGE: `caddy:2.9-alpine@sha256:${TEST_DIGEST}`,
    CISNE_API_IMAGE: `cisne-api@sha256:${TEST_DIGEST}`,
    CISNE_WEB_IMAGE: `cisne-web@sha256:${TEST_DIGEST}`,
    PROD_SKIP_BACKUP_STATUS_CHECK: 'I_UNDERSTAND',
    PROD_SKIP_OBSERVABILITY_CHECK: 'I_UNDERSTAND',
    ...overrides,
  };
}

describe('production infrastructure (Prompt 88)', () => {
  it('derives compute sizing from Prompt 82 concurrency baseline without over-provisioning', () => {
    const sizing = deriveComputeSizing({ DATABASE_POOL_MAX: '10' });
    expect(sizing.source).toBe('PROMPT_82_MEASURED_BASELINE');
    expect(sizing.measuredMaxConcurrency).toBe(PERF_FULL_MAX_CONCURRENCY);
    expect(sizing.apiMinReplicas).toBe(1);
    expect(sizing.apiMaxReplicas).toBeLessThanOrEqual(2);
    expect(sizing.postgresMaxConnections).toBeGreaterThanOrEqual(25);
  });

  it('passes full infrastructure validation with hardened production env', () => {
    const result = runProdInfrastructureValidation(productionEnv());
    expect(result.status).toBe('PASS');
    expect(result.stages.every((entry) => entry.passed)).toBe(true);
  });

  it('blocks mutable production image tags', () => {
    const result = runProdInfrastructureValidation(
      productionEnv({ CISNE_API_IMAGE: 'cisne-api:latest' }),
    );
    expect(result.status).toBe('FAIL');
    expect(result.stages.find((stage) => stage.id === 'supply_chain')?.passed).toBe(false);
  });

  it('blocks public database exposure', () => {
    const policy = evaluateNetworkPolicy({
      exposedPorts: parseExposedPorts('443'),
      databaseHost: 'db.public.cloud.example',
      databasePort: 5432,
      objectStorageEndpoint: 'http://minio.internal:9000',
      tlsTermination: 'edge',
    });
    expect(() => assertNetworkPolicy(policy)).toThrow(/PostgreSQL must not be publicly reachable/);
  });

  it('blocks non-TLS public URLs', () => {
    const result = runProdInfrastructureValidation(
      productionEnv({ PROD_PUBLIC_API_URL: 'http://api.cisne.example' }),
    );
    expect(result.status).toBe('FAIL');
    expect(result.stages.find((stage) => stage.id === 'tls')?.passed).toBe(false);
  });

  it('blocks filesystem object storage for multi-instance production', () => {
    const report = evaluateScalingCompatibility({
      OBJECT_STORAGE_PROVIDER: 'filesystem',
      PROD_API_REPLICAS: '2',
    });
    expect(() => assertScalingCompatibility(report, { PROD_API_REPLICAS: '2', OBJECT_STORAGE_PROVIDER: 'filesystem' })).toThrow(
      /shared object storage/,
    );
  });

  it('blocks multiple API replicas while rate limiting is process-local', () => {
    const report = evaluateScalingCompatibility({
      OBJECT_STORAGE_PROVIDER: 's3',
      PROD_API_REPLICAS: '2',
      SECURITY_RATE_LIMIT_BACKEND: 'memory',
    });
    expect(() =>
      assertScalingCompatibility(report, {
        PROD_API_REPLICAS: '2',
        OBJECT_STORAGE_PROVIDER: 's3',
        SECURITY_RATE_LIMIT_BACKEND: 'memory',
      }),
    ).toThrow(/RATE_LIMIT_BACKEND=external/);
  });

  it('accepts multiple replicas only when shared storage and external rate limiting are explicit', () => {
    const env = {
      OBJECT_STORAGE_PROVIDER: 's3',
      PROD_API_REPLICAS: '2',
      SECURITY_RATE_LIMIT_BACKEND: 'external',
    };
    const report = evaluateScalingCompatibility(env);
    expect(() => assertScalingCompatibility(report, env)).not.toThrow();
  });

  it('blocks admin cloud credentials on runtime service account', () => {
    const result = runProdInfrastructureValidation(
      productionEnv({ PROD_CLOUD_ADMIN_CREDENTIALS: 'true' }),
    );
    expect(result.status).toBe('FAIL');
    expect(result.stages.find((stage) => stage.id === 'service_account')?.passed).toBe(false);
  });

  it('detects embedded secrets in configuration scan', () => {
    const violations = scanConfigForEmbeddedSecrets({
      AWS_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
    });
    expect(violations).toContain('AWS_ACCESS_KEY');
  });

  it('accepts mounted secret files in hardened production mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cisne-prod-secrets-'));
    try {
      const databaseFile = join(dir, 'database_url');
      const jwtFile = join(dir, 'jwt_secret');
      const backupFile = join(dir, 'backup_encryption_key');
      writeFileSync(
        databaseFile,
        'postgresql://cisne:secret@postgres.internal:5432/cisne_production?sslmode=require',
      );
      writeFileSync(jwtFile, 'file-backed-production-jwt-secret-with-sufficient-length-32');
      writeFileSync(backupFile, Buffer.alloc(32, 7).toString('base64'));

      const result = runProdInfrastructureValidation(
        productionEnv({
          PROD_REQUIRE_SECRET_STORE: 'true',
          DATABASE_URL: undefined,
          JWT_SECRET: undefined,
          BACKUP_ENCRYPTION_KEY: undefined,
          DATABASE_URL_FILE: databaseFile,
          JWT_SECRET_FILE: jwtFile,
          BACKUP_ENCRYPTION_KEY_FILE: backupFile,
        }),
      );

      expect(result.status).toBe('PASS');
      expect(result.stages.find((stage) => stage.id === 'secrets')?.passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires explicit production gate when secret store is mandated', () => {
    const result = runProdInfrastructureValidation(
      productionEnv({
        PROD_REQUIRE_SECRET_STORE: 'true',
        JWT_SECRET: 'inline-forbidden',
      }),
    );
    expect(result.status).toBe('FAIL');
    expect(result.stages.find((stage) => stage.id === 'secrets')?.passed).toBe(false);
  });
});

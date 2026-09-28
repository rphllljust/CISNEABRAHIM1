import { existsSync, readFileSync } from 'node:fs';
import { assertBackupEncryptionKeyForProduction } from '../backup/backup-config';
import { assertProductionEnvironment, loadProdConfig } from './prod-config';
import { assertCostControlPolicy, deriveCostControlPolicy } from './prod-cost';
import { assertServiceAccountPolicy, evaluateServiceAccountPolicy } from './prod-iam';
import { assertNetworkPolicy, assertNotHmlInfrastructure, evaluateNetworkPolicy, parseExposedPorts, readDatabaseEndpoint } from './prod-network';
import { assertObjectStorageProductionPolicy, deriveObjectStoragePolicy } from './prod-object-storage';
import { assertPostgresProductionRequirements, derivePostgresRequirements } from './prod-postgres';
import { deriveComputeSizing } from './prod-sizing';
import {
  assertProductionSecrets,
  assertSecretRotationPlan,
  assertTlsUrls,
  defaultSecretRotationPlan,
  scanConfigForEmbeddedSecrets,
} from './prod-secrets';
import { assertScalingCompatibility, evaluateScalingCompatibility } from './prod-scaling';
import {
  assertProductionImagesPinned,
  loadProductionImageInventory,
} from './prod-supply-chain';
import type { ProdValidationResult, ProdValidationStage } from './prod-types';

function stage(
  id: ProdValidationStage['id'],
  label: string,
  passed: boolean,
  detail: string,
): ProdValidationStage {
  return { id, label, passed, detail };
}

function fail(
  stages: ProdValidationStage[],
  sizing: ReturnType<typeof deriveComputeSizing>,
  error: string,
): ProdValidationResult {
  return { status: 'FAIL', stages, sizing, error };
}

export function runProdInfrastructureValidation(
  env: NodeJS.ProcessEnv = process.env,
): ProdValidationResult {
  const sizing = deriveComputeSizing(env);
  const stages: ProdValidationStage[] = [];

  try {
    assertProductionEnvironment(env);
    assertNotHmlInfrastructure(env);
    stages.push(stage('environment', 'Production environment markers', true, 'CISNE_ENV=production'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('environment', 'Production environment markers', false, detail));
    return fail(stages, sizing, detail);
  }

  stages.push(
    stage(
      'compute_sizing',
      'Compute sizing from Prompt 82 baseline',
      true,
      `${sizing.apiMinReplicas}-${sizing.apiMaxReplicas} API replicas; ${sizing.apiCpuCores} vCPU; ${sizing.apiMemoryMb}MB`,
    ),
  );

  try {
    const images = loadProductionImageInventory(env);
    assertProductionImagesPinned(images);
    stages.push(
      stage(
        'supply_chain',
        'Immutable production container images',
        true,
        'all runtime images pinned by sha256 digest',
      ),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('supply_chain', 'Immutable production container images', false, detail));
    return fail(stages, sizing, detail);
  }

  let config;
  try {
    config = loadProdConfig(env);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('environment', 'Production configuration', false, detail));
    return fail(stages, sizing, detail);
  }

  const dbEndpoint = readDatabaseEndpoint(config.databaseUrl);
  const networkPolicy = evaluateNetworkPolicy({
    exposedPorts: parseExposedPorts(env['PROD_EXPOSED_PORTS']),
    databaseHost: dbEndpoint.host,
    databasePort: dbEndpoint.port,
    objectStorageEndpoint: env['OBJECT_STORAGE_ENDPOINT'] ?? null,
    tlsTermination: config.tlsRequired ? 'edge' : 'none',
  });

  try {
    assertNetworkPolicy(networkPolicy);
    stages.push(stage('network', 'Restricted network exposure', true, `edge ports=${networkPolicy.exposedPorts.join(',')}`));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('network', 'Restricted network exposure', false, detail));
    return fail(stages, sizing, detail);
  }

  const postgresRequirements = derivePostgresRequirements(env);
  try {
    assertPostgresProductionRequirements(postgresRequirements, env);
    stages.push(
      stage(
        'postgres',
        'PostgreSQL hardened',
        true,
        `max_connections>=${postgresRequirements.maxConnections}; tls=${postgresRequirements.tlsRequired}`,
      ),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('postgres', 'PostgreSQL hardened', false, detail));
    return fail(stages, sizing, detail);
  }

  const objectStoragePolicy = deriveObjectStoragePolicy(env);
  try {
    assertObjectStorageProductionPolicy(objectStoragePolicy, env);
    stages.push(
      stage(
        'object_storage',
        'Private object storage',
        true,
        `versioning=${objectStoragePolicy.versioningEnabled}; lifecycle=${objectStoragePolicy.lifecycleConfigured}`,
      ),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('object_storage', 'Private object storage', false, detail));
    return fail(stages, sizing, detail);
  }

  try {
    if (config.tlsRequired) {
      assertTlsUrls(config);
    }
    stages.push(stage('tls', 'HTTPS on public endpoints', true, 'public URLs use https://'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('tls', 'HTTPS on public endpoints', false, detail));
    return fail(stages, sizing, detail);
  }

  try {
    assertProductionSecrets(env);
    assertSecretRotationPlan(defaultSecretRotationPlan());
    stages.push(stage('secrets', 'Secret manager + rotation plan', true, 'rotation<=90d; dual-key supported'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('secrets', 'Secret manager + rotation plan', false, detail));
    return fail(stages, sizing, detail);
  }

  const serviceAccount = evaluateServiceAccountPolicy(env);
  try {
    assertServiceAccountPolicy(serviceAccount);
    stages.push(stage('service_account', 'Least-privilege runtime identity', true, 'no admin cloud creds'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('service_account', 'Least-privilege runtime identity', false, detail));
    return fail(stages, sizing, detail);
  }

  const scaling = evaluateScalingCompatibility(env);
  try {
    assertScalingCompatibility(scaling, env);
    stages.push(
      stage(
        'scaling',
        'Multi-instance safe (sessions/outbox/storage)',
        true,
        `sharedObjectStorage=${scaling.sharedObjectStorage}`,
      ),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('scaling', 'Multi-instance safe (sessions/outbox/storage)', false, detail));
    return fail(stages, sizing, detail);
  }

  const costPolicy = deriveCostControlPolicy(env);
  try {
    assertCostControlPolicy(costPolicy);
    stages.push(
      stage(
        'cost_controls',
        'Budget alerts',
        true,
        `monthlyBudgetUsd=${costPolicy.monthlyBudgetUsd}`,
      ),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('cost_controls', 'Budget alerts', false, detail));
    return fail(stages, sizing, detail);
  }

  try {
    assertBackupEncryptionKeyForProduction(env);
    const statusFile = env['BACKUP_STATUS_FILE']?.trim() ?? '.backup/status/latest.json';
    if (!existsSync(statusFile) && env['PROD_SKIP_BACKUP_STATUS_CHECK'] !== 'I_UNDERSTAND') {
      throw new Error(`Backup status file missing: ${statusFile}`);
    }
    if (existsSync(statusFile)) {
      const status = JSON.parse(readFileSync(statusFile, 'utf8')) as { status?: string };
      if (status.status !== 'ok' && env['PROD_SKIP_BACKUP_STATUS_CHECK'] !== 'I_UNDERSTAND') {
        throw new Error(`Latest backup status is not ok (${status.status ?? 'unknown'})`);
      }
    }
    stages.push(stage('backup', 'Backup encryption + status', true, statusFile));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('backup', 'Backup encryption + status', false, detail));
    return fail(stages, sizing, detail);
  }

  try {
    const metricsUrl = config.publicApiUrl
      ? `${config.publicApiUrl.replace(/\/$/, '')}/api/v1/observability/metrics`
      : null;
    if (!metricsUrl && env['PROD_SKIP_OBSERVABILITY_CHECK'] !== 'I_UNDERSTAND') {
      throw new Error('PROD_PUBLIC_API_URL required for observability validation');
    }
    stages.push(stage('observability', 'Metrics endpoint configured', true, metricsUrl ?? 'skipped'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('observability', 'Metrics endpoint configured', false, detail));
    return fail(stages, sizing, detail);
  }

  const embeddedSecrets = scanConfigForEmbeddedSecrets(env);
  if (embeddedSecrets.length > 0) {
    const detail = `Embedded secrets detected in env keys: ${embeddedSecrets.join(', ')}`;
    stages.push(stage('security_scan', 'Configuration security scan', false, detail));
    return fail(stages, sizing, detail);
  }
  stages.push(stage('security_scan', 'Configuration security scan', true, 'clean'));

  return { status: 'PASS', stages, sizing };
}

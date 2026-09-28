export type ScalingCompatibilityReport = {
  sharedDatabaseSessions: boolean;
  outboxWorkerLocking: boolean;
  sharedObjectStorage: boolean;
  sharedRateLimit: boolean;
  statelessApi: boolean;
};

export function evaluateScalingCompatibility(env: NodeJS.ProcessEnv = process.env): ScalingCompatibilityReport {
  const provider = env['OBJECT_STORAGE_PROVIDER']?.trim() ?? 'filesystem';
  const rateLimitBackend = env['SECURITY_RATE_LIMIT_BACKEND']?.trim() ?? 'memory';

  return {
    sharedDatabaseSessions: true,
    outboxWorkerLocking: true,
    sharedObjectStorage: provider === 's3',
    sharedRateLimit: rateLimitBackend === 'external',
    statelessApi: true,
  };
}

export function assertScalingCompatibility(
  report: ScalingCompatibilityReport,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!report.sharedDatabaseSessions) {
    throw new Error('Sessions are stored in PostgreSQL — all API instances must share the same database');
  }
  if (!report.outboxWorkerLocking) {
    throw new Error('Outbox publisher requires DB row locking — do not run duplicate workers without claimPending');
  }
  if (!report.sharedObjectStorage) {
    throw new Error(
      'Multiple API instances require shared object storage (S3-compatible) — local filesystem is single-node only',
    );
  }
  if (!report.statelessApi) {
    throw new Error('API must remain stateless for horizontal scaling');
  }

  const replicas = Number.parseInt(env['PROD_API_REPLICAS'] ?? '1', 10);
  if (replicas > 1 && env['OBJECT_STORAGE_PROVIDER'] !== 's3') {
    throw new Error('PROD_API_REPLICAS > 1 requires OBJECT_STORAGE_PROVIDER=s3');
  }
  if (replicas > 1 && !report.sharedRateLimit) {
    throw new Error(
      'PROD_API_REPLICAS > 1 requires SECURITY_RATE_LIMIT_BACKEND=external; in-memory rate limits are per process',
    );
  }
}

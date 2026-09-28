import {
  readFirstSecretValue,
  readSecretValue,
} from './secret-value';

/**
 * Centralized, fail-fast runtime configuration validation for the API and
 * worker processes.
 *
 * Every real start (main.ts / worker/main.ts) calls this BEFORE NestFactory
 * creates the application and before any port is bound, so a missing or
 * malformed required setting surfaces as a single aggregated
 * `CONFIGURATION_ERROR` instead of a late failure on the first request.
 *
 * Environment classification:
 * - `production-like` = NODE_ENV=production or CISNE_ENV in
 *   {production, hml} (HML uses NODE_ENV=production). In these environments
 *   missing required settings are hard errors.
 * - `development` = anything else. Missing database is only a warning so local
 *   tooling keeps its previous ergonomics (health reports not_configured).
 *
 * This module is the single bootstrap validation point; per-module loaders
 * (auth.config, document-storage.config, ...) keep their own parsing logic.
 */

export type RuntimeRole = 'api' | 'worker';

const PRODUCTION_LIKE_ENVS = new Set(['production', 'hml']);

function isProductionLike(env: NodeJS.ProcessEnv): boolean {
  return (
    env['NODE_ENV'] === 'production' ||
    (env['CISNE_ENV'] !== undefined && PRODUCTION_LIKE_ENVS.has(env['CISNE_ENV']))
  );
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function parseDatabaseUrl(raw: string): { ok: boolean; reason?: string } {
  if (!raw.startsWith('postgres://') && !raw.startsWith('postgresql://')) {
    return { ok: false, reason: 'must start with postgres:// or postgresql://' };
  }
  try {
    const url = new URL(raw);
    if (!url.hostname) {
      return { ok: false, reason: 'host is missing' };
    }
    const dbName = url.pathname.replace(/^\//, '');
    if (!dbName) {
      return { ok: false, reason: 'database name is missing' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'is not a valid URL' };
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns a list of human-readable configuration errors (empty = valid). */
export function collectRuntimeConfigErrors(
  role: RuntimeRole,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const errors: string[] = [];
  const hard = isProductionLike(env);

  const push = (key: string, message: string): void => {
    errors.push(`${key}: ${message}`);
  };

  // DATABASE_URL — direct env or mounted DATABASE_URL_FILE.
  let databaseUrl: string | undefined;
  try {
    databaseUrl = readSecretValue(env, 'DATABASE_URL');
  } catch (error) {
    push('DATABASE_URL_FILE', errorDetail(error));
  }

  if (!isPresent(databaseUrl)) {
    if (hard) {
      push('DATABASE_URL', 'is required (missing or empty)');
    } else {
      errors.push('DATABASE_URL: missing — runtime will report database not_configured');
    }
  } else {
    const parsed = parseDatabaseUrl(databaseUrl);
    if (!parsed.ok) {
      push('DATABASE_URL', `invalid: ${parsed.reason}`);
    }
  }

  // JWT_SECRET — direct env or mounted JWT_SECRET_FILE.
  let jwtSecret: string | undefined;
  try {
    jwtSecret = readSecretValue(env, 'JWT_SECRET');
  } catch (error) {
    push('JWT_SECRET_FILE', errorDetail(error));
  }
  if (!isPresent(jwtSecret) || (jwtSecret?.length ?? 0) < 32) {
    push('JWT_SECRET', 'is required and must be at least 32 characters');
  }

  if (role === 'api') {
    const provider = env['OBJECT_STORAGE_PROVIDER']?.trim() || 'filesystem';
    if (provider !== 'filesystem' && provider !== 's3') {
      push(
        'OBJECT_STORAGE_PROVIDER',
        `unsupported value "${provider}" (expected filesystem or s3)`,
      );
    } else if (provider === 's3') {
      const bucket = env['OBJECT_STORAGE_BUCKET']?.trim();
      if (!bucket) {
        push('OBJECT_STORAGE_BUCKET', 'is required when OBJECT_STORAGE_PROVIDER=s3');
      }

      const iamRole = env['OBJECT_STORAGE_IAM_ROLE'] === 'true';
      if (!iamRole) {
        let accessKey: string | undefined;
        let secretKey: string | undefined;
        try {
          accessKey = readFirstSecretValue(env, [
            { key: 'OBJECT_STORAGE_S3_ACCESS_KEY_ID' },
            { key: 'S3_ACCESS_KEY_ID' },
          ]);
          secretKey = readFirstSecretValue(env, [
            { key: 'OBJECT_STORAGE_S3_SECRET_ACCESS_KEY' },
            { key: 'S3_SECRET_ACCESS_KEY' },
          ]);
        } catch (error) {
          push('OBJECT_STORAGE_S3_CREDENTIALS_FILE', errorDetail(error));
        }
        if (!accessKey) {
          push(
            'OBJECT_STORAGE_S3_ACCESS_KEY_ID/S3_ACCESS_KEY_ID',
            'is required when OBJECT_STORAGE_PROVIDER=s3 and OBJECT_STORAGE_IAM_ROLE is not true',
          );
        }
        if (!secretKey) {
          push(
            'OBJECT_STORAGE_S3_SECRET_ACCESS_KEY/S3_SECRET_ACCESS_KEY',
            'is required when OBJECT_STORAGE_PROVIDER=s3 and OBJECT_STORAGE_IAM_ROLE is not true',
          );
        }
      }
    }

    // HTTP listener sanity.
    const rawPort = env['PORT'];
    if (rawPort !== undefined && rawPort.trim() !== '') {
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        push('PORT', `"${rawPort}" is not a valid TCP port (1-65535)`);
      }
    }
    if (env['API_HOST'] !== undefined && env['API_HOST'].trim() === '') {
      push('API_HOST', 'must not be empty when set');
    }
  }

  if (role === 'worker') {
    const workerEnabled = env['WORKER_ENABLED'];
    if (workerEnabled !== undefined && !['true', 'false'].includes(workerEnabled)) {
      push('WORKER_ENABLED', `unsupported value "${workerEnabled}" (expected true|false)`);
    }
  }

  return errors;
}

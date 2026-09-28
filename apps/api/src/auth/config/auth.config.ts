import { readSecretValue } from '../../platform/runtime-config/secret-value';

export type AuthConfig = {
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  jwtClockSkewSeconds: number;
  corsOrigins: string[];
  loginRateLimitPerMinute: number;
};

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
] as const;

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOrigin(origin: string): string | null {
  const trimmed = origin.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

function isProductionLike(env: NodeJS.ProcessEnv): boolean {
  return env['NODE_ENV'] === 'production' || env['CISNE_ENV'] === 'production';
}

function parseCorsOrigins(
  raw: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = (raw ?? '')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

  const merged = isProductionLike(env)
    ? configured
    : [...configured, ...DEFAULT_CORS_ORIGINS];
  return [...new Set(merged)];
}

export function loadAuthConfig(): AuthConfig {
  const jwtSecret = readSecretValue(process.env, 'JWT_SECRET');
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters.');
  }

  return {
    jwtSecret,
    jwtIssuer: process.env['JWT_ISSUER'] ?? 'cisne-api',
    jwtAudience: process.env['JWT_AUDIENCE'] ?? 'cisne-clients',
    accessTokenTtlSeconds: readNumber('JWT_ACCESS_TTL_SECONDS', 900),
    refreshTokenTtlSeconds: readNumber('JWT_REFRESH_TTL_SECONDS', 43_200),
    jwtClockSkewSeconds: readNumber('JWT_CLOCK_SKEW_SECONDS', 30),
    corsOrigins: parseCorsOrigins(process.env['CORS_ORIGIN']),
    loginRateLimitPerMinute: readNumber('AUTH_LOGIN_RATE_LIMIT_PER_MINUTE', 5),
  };
}

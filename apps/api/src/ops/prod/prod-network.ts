import { readSecretValue } from '../../platform/runtime-config/secret-value';
import type { ProdNetworkPolicy } from './prod-types';

const ALLOWED_EDGE_PORTS = new Set([80, 443]);
const HML_MARKERS = ['_hml', '-hml', '/hml', 'homolog'];

export function parseExposedPorts(raw: string | undefined): number[] {
  if (!raw?.trim()) {
    return [443];
  }
  return raw
    .split(',')
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((port) => Number.isFinite(port) && port > 0);
}

export function evaluateNetworkPolicy(input: {
  exposedPorts: number[];
  databaseHost: string | null;
  databasePort: number | null;
  objectStorageEndpoint: string | null;
  tlsTermination: 'edge' | 'none';
}): ProdNetworkPolicy {
  const databasePubliclyExposed =
    input.databaseHost !== null &&
    !isPrivateHost(input.databaseHost) &&
    input.databasePort !== null &&
    input.databasePort > 0;

  const objectStoragePubliclyExposed =
    input.objectStorageEndpoint !== null && !isPrivateEndpoint(input.objectStorageEndpoint);

  return {
    exposedPorts: input.exposedPorts,
    databasePubliclyExposed,
    objectStoragePubliclyExposed,
    tlsTermination: input.tlsTermination,
  };
}

export function assertNetworkPolicy(policy: ProdNetworkPolicy): void {
  for (const port of policy.exposedPorts) {
    if (!ALLOWED_EDGE_PORTS.has(port)) {
      throw new Error(
        `Port ${port} must not be exposed on production edge — only 80/443 (redirect/TLS) allowed`,
      );
    }
  }

  if (policy.databasePubliclyExposed) {
    throw new Error('PostgreSQL must not be publicly reachable without documented exception');
  }

  if (policy.objectStoragePubliclyExposed) {
    throw new Error('Object storage endpoint must stay private; access via IAM/service network only');
  }
}

export function assertNotHmlInfrastructure(env: NodeJS.ProcessEnv = process.env): void {
  const markers = [
    readSecretValue(env, 'DATABASE_URL')?.toLowerCase() ?? '',
    env['OBJECT_STORAGE_BUCKET']?.toLowerCase() ?? '',
    env['OBJECT_STORAGE_ROOT']?.toLowerCase() ?? '',
  ];
  if (markers.some((value) => HML_MARKERS.some((marker) => value.includes(marker)))) {
    throw new Error('Production must not reuse HML database or object storage identifiers');
  }
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === 'postgres' || host.endsWith('.internal')) {
    return true;
  }
  if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('127.')) {
    return true;
  }
  const octets = host.match(/^172\.(\d+)\./);
  if (octets) {
    const second = Number.parseInt(octets[1] ?? '0', 10);
    return second >= 16 && second <= 31;
  }
  return false;
}

function isPrivateEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return isPrivateHost(url.hostname);
  } catch {
    return endpoint.includes('minio') || endpoint.includes('internal');
  }
}

export function readDatabaseEndpoint(databaseUrl: string): { host: string | null; port: number | null } {
  try {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname,
      port: url.port ? Number.parseInt(url.port, 10) : 5432,
    };
  } catch {
    return { host: null, port: null };
  }
}

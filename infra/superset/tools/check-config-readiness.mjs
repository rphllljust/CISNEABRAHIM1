/**
 * MASTER 015: pure, non-mutating static configuration preflight.
 * It does NOT verify runtime, guest-token RLS, real dashboards, backup or web build flags.
 * Never log secret values.
 */
import { fileURLToPath } from 'node:url';

const DASHBOARDS = Object.freeze([
  'SERVICE_ORDERS', 'FLEET_ASSETS', 'CONTRACTS_MEASUREMENTS',
  'FINANCE_TREASURY', 'OPERATIONAL_COSTS', 'TRANSPORT_RENTALS',
  'TEAM_PRODUCTIVITY', 'EXECUTIVE',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseEndpoint(raw, external) {
  if (!raw) return 'absent';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return 'invalid_url';
    }
    if (external && (url.protocol !== 'https:' || /(^localhost$|\.localhost$|\.invalid$|\.example$|\.test$)/i.test(url.hostname))) {
      return 'public_https_required';
    }
    return null;
  } catch {
    return 'invalid_url';
  }
}

export function inspectSupersetConfiguration(env = {}) {
  const missing = [];
  const problems = [];
  const configuredDashboards = [];
  for (const key of ['SUPERSET_INTERNAL_URL', 'SUPERSET_PUBLIC_URL', 'SUPERSET_SERVICE_USERNAME', 'SUPERSET_SERVICE_PASSWORD']) {
    if (!env[key]?.trim()) missing.push(key);
  }
  for (const [key, external] of [['SUPERSET_INTERNAL_URL', false], ['SUPERSET_PUBLIC_URL', true]]) {
    const problem = parseEndpoint(env[key], external);
    if (problem && problem !== 'absent') problems.push(key + ': ' + problem);
  }
  for (const name of DASHBOARDS) {
    const key = 'SUPERSET_DASHBOARD_' + name + '_ID';
    const value = env[key]?.trim();
    if (!value) continue;
    if (!UUID.test(value)) problems.push(key + ': invalid_uuid');
    else configuredDashboards.push(name.toLowerCase().replaceAll('_', '-'));
  }
  if (configuredDashboards.length === 0) problems.push('no_real_dashboard_uuid_configured');
  const backendFeatureEnabled = env.SUPERSET_EMBED_ENABLED === 'true';
  const configValidated = missing.length === 0 && problems.length === 0;
  return {
    kind: 'STATIC_CONFIGURATION_ONLY',
    configValidated,
    backendFeatureEnabled,
    configuredDashboards,
    missing,
    problems,
    browserArtifactFlagVerified: false,
    liveSupersetHealthVerified: false,
    datasetColumnScopeVerified: false,
    leastPrivilegeReaderVerified: false,
    guestTokenRlsCrossUnitVerified: false,
    dashboardDataReconciled: false,
    metadataRestoreTestVerified: false,
    operationallyReady: false,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = inspectSupersetConfiguration(process.env);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  // Exit 0 only means configuration format passed. NOT production readiness.
  if (!result.configValidated) process.exitCode = 2;
}

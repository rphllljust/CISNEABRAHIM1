/**
 * MASTER 015 — read-only Coolify HML discovery using existing GitHub Actions secrets.
 * No POST/PATCH/DELETE, no secret/UUID/URL logging, no deployment.
 * The result is an access diagnostic, NEVER permission to deploy or RLS proof.
 */
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LIMIT = 30;
const fingerprint = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
const hmlName = (value) => typeof value === 'string' && /(?:^|[^a-z])(hml|homolog)(?:[^a-z]|$)/i.test(value.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

function parseBaseUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname.replace(/\/$/, '') !== '/api/v1') return null;
    return u.href.replace(/\/$/, '');
  } catch { return null; }
}

export async function probe({ baseUrl, token, fetchImpl = fetch } = {}) {
  const result = {
    kind: 'COOLIFY_HML_READ_ONLY_ACCESS_PROBE',
    secretValuesLogged: false,
    writesAttempted: false,
    resourceCreated: false,
    apiAccess: 'NOT_CHECKED',
    endpoints: {},
    projectCount: null,
    hmlCandidateCount: 0,
    candidates: [],
    projectInventoryTruncated: false,
    creationPermission: 'UNVERIFIED_NO_WRITE_ATTEMPT',
    requiredNextAction: null,
  };
  const url = parseBaseUrl(baseUrl);
  if (!url || !token) {
    result.apiAccess = 'MISSING_OR_INVALID_CONFIGURATION';
    result.requiredNextAction = 'Verify COOLIFY_BASE_URL and COOLIFY_TOKEN repository secret availability; never print values.';
    return result;
  }
  async function get(path, key) {
    try {
      const res = await fetchImpl(`${url}${path}`, {
        method: 'GET', redirect: 'error',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      result.endpoints[key] = res.status;
      if (!res.ok) return null;
      // Only parse successful GET responses; never emit raw payloads to logs/artifacts.
      const body = await res.json();
      return body;
    } catch {
      result.endpoints[key] = 'NETWORK_OR_RESPONSE_ERROR';
      return null;
    }
  }
  // Deliberately exclude /envs, /logs, /settings and other sensitive endpoints.
  const projects = await get('/projects', 'projects');
  if (result.endpoints.projects !== 200 || !Array.isArray(projects)) {
    result.apiAccess = result.endpoints.projects === 401 ? 'UNAUTHENTICATED_401'
      : result.endpoints.projects === 403 ? 'PROJECT_READ_DENIED_403'
      : result.endpoints.projects === 200 ? 'PROJECTS_RESPONSE_UNEXPECTED'
      : 'PROJECT_READ_UNAVAILABLE';
    result.requiredNextAction = result.endpoints.projects === 403
      ? 'Grant read scope to a separate team-bound HML discovery token; do not broaden existing deploy token.'
      : 'Investigate the indicated non-successful read-only API request using the existing trusted runner.';
    return result;
  }
  result.apiAccess = 'PROJECT_READ_ALLOWED';
  result.projectCount = projects.length;
  result.projectInventoryTruncated = projects.length > LIMIT;
  for (const p of projects.slice(0, LIMIT)) {
    if (typeof p.uuid !== 'string' || !p.uuid) continue;
    const envs = await get(`/projects/${encodeURIComponent(p.uuid)}/environments`, 'environments_' + fingerprint(p.uuid));
    if (!Array.isArray(envs)) continue;
    for (const env of envs) {
      if (!hmlName(env.name)) continue;
      result.hmlCandidateCount += 1;
      result.candidates.push({
        projectFingerprint: fingerprint(p.uuid),
        environmentFingerprint: fingerprint(env.uuid ?? env.id),
        // Never include raw names, project UUIDs, domains, secret fields or hostnames.
        match: 'HML_OR_HOMOLOG_NAME',
      });
    }
  }
  // Does not attempt a dangerous dry-run POST: a malformed create request could mutate state.
  result.requiredNextAction = result.hmlCandidateCount === 1 && !result.projectInventoryTruncated
    ? 'Confirm candidate HML project/team/server and authorize separate scoped write+deploy token before provisioning.'
    : 'Resolve HML project/environment identity using an authorized operator; do not guess or create services.';
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = await probe({ baseUrl: process.env.COOLIFY_BASE_URL, token: process.env.COOLIFY_TOKEN });
  const payload = JSON.stringify(r);
  console.log(`MASTER015_HML_ACCESS_PROBE=${payload}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### MASTER 015 — read-only HML access audit\n\n` +
      `- API projects: **${r.apiAccess}** (${r.endpoints.projects ?? 'NOT_CALLED'})\n` +
      `- HML environment candidates: **${r.hmlCandidateCount}**\n` +
      `- Compose creation permission: **${r.creationPermission}**\n` +
      `- Writes/Deployments: **NONE**\n` +
      `- Next action: ${r.requiredNextAction}\n`);
  }
  // A denied read is an observed diagnostic, not a CI policy failure.
  // Action can be safely reviewed in a PR before any HML mutations are attempted.
}

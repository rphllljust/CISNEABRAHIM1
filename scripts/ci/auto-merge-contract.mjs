// Fail-closed contracts used by the trusted auto-merge controller.
// Keep this module dependency-free so its incident tests run with node --test.
export const REQUIRED_CI_JOBS = Object.freeze([
  'Lint / Typecheck / Audit',
  'Unit tests',
  'Database migration gate',
  'Integration',
  'API E2E',
  'Build / artifacts',
  'Visual critical',
  'Visual full',
  'Release ready',
]);

export function latestExactRun(runs, name, sha) {
  return [...runs]
    .filter((run) =>
      run.name === name &&
      run.head_sha === sha &&
      run.event === 'pull_request' &&
      run.head_repository?.full_name !== undefined)
    .sort((a, b) => b.id - a.id)[0] ?? null;
}

export function requiredJobsPassed(jobs, required = REQUIRED_CI_JOBS) {
  return required.every((name) => {
    const matches = jobs.filter((job) => job.name === name);
    return matches.length === 1 &&
      matches[0].status === 'completed' &&
      matches[0].conclusion === 'success';
  });
}

export function verifiedPlaywrightLog(input) {
  const log = input.replace(/\u001b\[[0-9;]*m/g, '');
  // An old workflow could be marked SUCCESS because tee masked Playwright's
  // exit code. Never trust the GitHub job conclusion alone.
  if (/\b[1-9][0-9]*\s+failed\b/i.test(log)) return false;
  if (/\bExit status\s+[1-9][0-9]*\b/i.test(log)) return false;
  if (/\bProcess completed with exit code\s+[1-9][0-9]*\b/i.test(log)) return false;
  if (/\bVisual Full acceptance blocked\b/i.test(log)) return false;
  return /\b[1-9][0-9]*\s+passed\b/i.test(log);
}

// Keep the same risk surface as hml-isolated-e2e.yml, so HML-required
// changes can never be merged with a missing, skipped or failed HML check.
export function requiresIsolatedHml(files) {
  const paths = files.map((file) => typeof file === 'string' ? file : file.filename);
  return paths.some((path) =>
    /^(apps\/api\/src\/(people|catalog)|apps\/web\/src\/(people|catalog)|apps\/web\/e2e\/hml)\//.test(path) ||
    path === '.github/workflows/hml-isolated-e2e.yml' ||
    path === '.github/workflows/coolify-release.yml' ||
    path.startsWith('scripts/cd/'));
}

export function isProtectedAutomationPath(path) {
  return /^\.github\/workflows\//.test(path) ||
    /^scripts\/(ci|cd)\//.test(path) ||
    /^\.github\/CODEOWNERS$/.test(path);
}

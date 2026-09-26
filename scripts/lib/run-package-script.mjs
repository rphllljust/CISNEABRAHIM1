import { spawnSync } from 'node:child_process';
import { repoRoot } from './env.mjs';

/**
 * Delegate a root `scripts/` entrypoint to a workspace package script.
 *
 * Why this exists: the root of the monorepo is not a pnpm workspace package, so it
 * has no `node_modules/.bin` of its own. `tsx` is only linked inside `apps/api`
 * (`apps/api/node_modules/.bin/tsx`), therefore `npx tsx <path>` invoked from the
 * root does not resolve on a clean install — it either needs network access to
 * fetch `tsx` from the registry or a hoisted copy that this repo never declares.
 * `tsx` appears in no `package.json` of the workspace; it only exists as a
 * transitive dependency of vitest.
 *
 * Running through `pnpm --filter <package> run <script>` instead:
 * - resolves `tsx` from the package's own linked bins (no network, no hoisting);
 * - keeps the CLI entrypoint path in exactly one place (`apps/api/package.json`)
 *   instead of duplicating it between the root script and the package script;
 * - is the pattern the repository already proved in production use at
 *   `scripts/readiness/gate.mjs` (`corepack pnpm --filter @cisne/api readiness:gate`).
 *
 * Returns the child exit status so callers can `process.exit(status)`.
 */
export function runPackageScript(scriptName, args = [], options = {}) {
  // `--` is required so pnpm forwards the flags to the script instead of
  // consuming them itself (e.g. `--production` is a pnpm config flag).
  const forwarded = args.length > 0 ? ['--', ...args] : [];
  const result = spawnSync(
    'corepack',
    ['pnpm', '--filter', options.filter ?? '@cisne/api', 'run', scriptName, ...forwarded],
    {
      cwd: options.cwd ?? repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: options.env ? { ...process.env, ...options.env } : process.env,
    },
  );

  if (result.error) {
    console.error(`failed to spawn package script "${scriptName}": ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Canonical environment loader for repository scripts.
 *
 * Rationale: scripts under `scripts/` run from the monorepo root, which is not a
 * workspace package, so they cannot resolve `dotenv` (declared only by
 * `@cisne/api` and `@cisne/database`). The repository already forbids `dotenv`
 * in root scripts — see `assertRootReadinessGateScriptDoesNotImportDotenv` in
 * `apps/api/src/ops/readiness/readiness-gate.ts`.
 *
 * This uses the runtime primitive (`process.loadEnvFile`, Node >= 20.12) instead
 * of a hand-rolled parser, so quoting, escaping and comments follow a single
 * documented contract — the same one `node --env-file` uses.
 *
 * Semantics preserved from the previous `dotenv` usage in `scripts/`:
 * - a missing file is a no-op (`dotenv` returned an error object and continued);
 * - a key already present in `process.env` is never overwritten (`dotenv` default,
 *   and the previous local parsers in `scripts/lib/database-test-env.mjs` and
 *   `scripts/split-repos/resolve-repo-paths.mjs` behaved the same way);
 * - files are applied in order, so the first file defining a key wins.
 *
 * There is no fallback to a custom parser: `process.loadEnvFile` is guaranteed by
 * the pinned runtime (`engines.node >= 24`, `.node-version` 24), and a silent
 * fallback would reintroduce exactly the divergent parsing this module removes.
 */
export function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return false;
  }
  process.loadEnvFile(filePath);
  return true;
}

/**
 * Apply env files in order. First definition of a key wins; missing files are skipped.
 */
export function loadEnvFiles(filePaths) {
  for (const filePath of filePaths) {
    loadEnvFile(filePath);
  }
}

/**
 * Repository root, resolved from this module's location so scripts behave the same
 * regardless of the caller's working directory (`scripts/lib/` → repo root).
 */
export const repoRoot = resolve(import.meta.dirname, '..', '..');

/**
 * Resolve env file names against the repository root and load them in order.
 */
export function loadRepoEnvFiles(fileNames) {
  loadEnvFiles(fileNames.map((fileName) => resolve(repoRoot, fileName)));
}

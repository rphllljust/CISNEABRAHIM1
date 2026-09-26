#!/usr/bin/env node
/**
 * Gate for `scripts/` — the part of the repository outside every turbo task.
 *
 * Why this exists (both defects were real and shipped):
 *   1. a root script imported `dotenv`, which is declared only by `@cisne/api` and
 *      `@cisne/database`. `scripts/` is not a workspace package, so the specifier did
 *      not resolve and the script died at runtime — no lint, typecheck or build task
 *      covered it;
 *   2. an operational script invoked `tsx` while `tsx` was not declared anywhere.
 *
 * Both are decidable statically and hermetically, so this gate is deliberately the
 * smallest mechanism that fails fast on each of them, plus a guard for the migration
 * probe registry, which also lives in `scripts/lib/`:
 *
 *   A. SYNTAX      — `node --check` on every `scripts/**\/*.mjs`.
 *   B. RESOLUTION  — every bare import specifier found in a script must resolve from
 *                    that script's own location (Node's own lookup, no guessing).
 *   C. BINARIES    — every executable an npm script invokes must be provided by the
 *                    install (`node_modules/.bin`), or be a platform/shell command.
 *   D. PROBES      — every `packages/database/migrations` journal tag above the legacy
 *                    boundary must have an artefact probe, so a migration can never be
 *                    recorded as applied without its effect being verifiable.
 *
 * No network, no database, no install: cheap enough to run on every lint invocation.
 *
 * Usage:
 *   node scripts/check-scripts.mjs              # gate the repository
 *   node scripts/check-scripts.mjs --json       # machine-readable summary
 *   node scripts/check-scripts.mjs --self-test  # prove the detectors catch known-bad input
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  binariesInScript,
  staticSpecifiers,
  undeclaredBinaries,
} from './lib/script-gate.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptsDir = join(repoRoot, 'scripts');
const jsonOutput = process.argv.includes('--json');
const selfTestOnly = process.argv.includes('--self-test');

/**
 * Detectors that are never shown to fail are not evidence. The self-test runs on
 * every invocation (pure functions, no I/O), so a detector that silently stops
 * matching — the way a regex rots — fails the gate instead of passing everything.
 * `--self-test` stops after this section for focused use.
 */
function runSelfTest({ verbose }) {
  const cases = [];
  const check = (name, ok, detail) => cases.push({ name, ok, detail });

  // B — the exact regression: a bare specifier that does not resolve from scripts/.
  check(
    'detector B extracts the dotenv regression',
    staticSpecifiers("import 'dotenv/config';\n").includes('dotenv'),
    JSON.stringify(staticSpecifiers("import 'dotenv/config';\n")),
  );
  check(
    'detector B ignores relative and node: specifiers',
    staticSpecifiers("import { x } from './a.mjs';\nimport { y } from 'node:fs';\n").length === 0,
  );
  check(
    'detector B ignores specifiers written inside comments (no false positive)',
    staticSpecifiers("/** docs: `import('spec')` is how you write it */\n").length === 0,
    JSON.stringify(staticSpecifiers("/** docs: `import('spec')` is how you write it */\n")),
  );
  check(
    'detector B ignores string literals that only look like imports (no false positive)',
    staticSpecifiers("const doc = \"import 'dotenv/config';\";\n").length === 0,
    JSON.stringify(staticSpecifiers("const doc = \"import 'dotenv/config';\";\n")),
  );
  check(
    'detector B reads a multi-line import statement',
    staticSpecifiers(
      "import {\n  readFileSync,\n} from 'node:fs';\nimport {\n  a,\n} from 'some-pkg';\n",
    ).join() === 'some-pkg',
    JSON.stringify(
      staticSpecifiers(
        "import {\n  readFileSync,\n} from 'node:fs';\nimport {\n  a,\n} from 'some-pkg';\n",
      ),
    ),
  );
  check(
    'detector B ignores `export const` statements',
    staticSpecifiers("export const x = 'some-pkg';\n").length === 0,
    JSON.stringify(staticSpecifiers("export const x = 'some-pkg';\n")),
  );

  // C — the exact regression: an npm script calling an uninstalled binary.
  const noBinsProvided = () => false;
  const allBinsProvided = () => true;
  check(
    'detector C flags the undeclared-binary regression',
    undeclaredBinaries({ 'test:uat': 'tsx src/uat.ts' }, noBinsProvided).length === 1,
    JSON.stringify(undeclaredBinaries({ 'test:uat': 'tsx src/uat.ts' }, noBinsProvided)),
  );
  check(
    'detector C accepts a binary the install provides',
    undeclaredBinaries({ 'test:uat': 'tsx src/uat.ts' }, allBinsProvided).length === 0,
  );
  check(
    'detector C ignores platform binaries and exit codes',
    undeclaredBinaries({ x: 'node a.mjs && pnpm lint || true' }, noBinsProvided).length === 0,
    JSON.stringify(undeclaredBinaries({ x: 'node a.mjs && pnpm lint || true' }, noBinsProvided)),
  );
  check(
    'detector C skips leading environment assignments',
    binariesInScript('NODE_ENV=test vitest run')[0] === 'vitest',
    JSON.stringify(binariesInScript('NODE_ENV=test vitest run')),
  );

  const failed = cases.filter((c) => !c.ok);
  if (verbose) {
    for (const c of cases) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  :: ${c.detail}` : ''}`);
    }
  }
  return { total: cases.length, failed };
}

const selfTest = runSelfTest({ verbose: selfTestOnly });

if (selfTestOnly) {
  console.log(`\nself-test: ${selfTest.total - selfTest.failed.length}/${selfTest.total} PASS`);
  process.exit(selfTest.failed.length > 0 ? 1 : 0);
}

const failures = [];
function fail(check, file, detail) {
  failures.push({ check, file, detail });
}

if (selfTest.failed.length > 0) {
  for (const c of selfTest.failed) {
    fail(
      'B/C',
      'scripts/check-scripts.mjs',
      `self-test case failed: "${c.name}"${c.detail ? ` :: ${c.detail}` : ''}`,
    );
  }
}

// ------------------------------------------------------------------------------- A/B
/**
 * The gate scans the scripts that are actually part of the repository. Ignored
 * scratch files (`.gitignore` already excludes `scripts/_*`) belong to a working
 * copy, not to the project, and failing CI over them would be a false positive —
 * exactly the kind of noise that gets a gate disabled. Falls back to a directory
 * walk when `git` is unavailable so the check still runs in a bare export.
 */
function trackedScripts(extension) {
  const listed = spawnSync('git', ['ls-files', `scripts/**/*${extension}`, `scripts/*${extension}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (listed.status === 0) {
    const files = listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((rel) => join(repoRoot, rel))
      .filter((file) => existsSync(file));
    // `scripts/**` misses files directly under scripts/ in some git versions.
    const topLevel = listFiles(scriptsDir, (file) => file.endsWith(extension));
    return [...new Set([...files, ...topLevel])].sort();
  }
  return listFiles(scriptsDir, (file) => file.endsWith(extension));
}

function listFiles(root, predicate) {
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === 'node_modules' || entry === 'tmp') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (predicate(full)) out.push(full);
    }
  };
  walk(root);
  return out;
}

const mjsFiles = trackedScripts('.mjs');
const ps1Files = trackedScripts('.ps1');

if (mjsFiles.length === 0) {
  fail('A', 'scripts/', 'no .mjs files found — the gate is not scanning anything');
}

for (const file of mjsFiles) {
  const rel = file.slice(repoRoot.length + 1);
  const source = readFileSync(file, 'utf8');

  // A. syntax, via Node's own parser
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) {
    fail('A', rel, `node --check failed: ${(syntax.stderr || '').trim().split('\n')[0]}`);
    continue; // a file that does not parse cannot be resolution-checked
  }

  // B. resolution from the script's own directory — the same lookup Node performs
  const require = createRequire(file);
  for (const specifier of staticSpecifiers(source)) {
    try {
      require.resolve(specifier);
    } catch {
      try {
        require.resolve(`${specifier}/package.json`);
      } catch {
        fail('B', rel, `bare import "${specifier}" does not resolve from ${dirname(rel)}`);
      }
    }
  }
}

// --------------------------------------------------------------------------------- C
function binaryIsProvided(packageDir, bin) {
  for (const candidate of [
    join(packageDir, 'node_modules', '.bin', bin),
    join(packageDir, 'node_modules', '.bin', `${bin}.cmd`),
    join(packageDir, 'node_modules', '.bin', `${bin}.ps1`),
    join(repoRoot, 'node_modules', '.bin', bin),
    join(repoRoot, 'node_modules', '.bin', `${bin}.cmd`),
    join(repoRoot, 'node_modules', '.bin', `${bin}.ps1`),
  ]) {
    if (existsSync(candidate)) return true;
  }
  return false;
}

function packageJsonPaths() {
  const paths = [join(repoRoot, 'package.json')];
  for (const group of ['apps', 'packages']) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const candidate = join(groupDir, name, 'package.json');
      if (existsSync(candidate)) paths.push(candidate);
    }
  }
  return paths;
}

for (const packagePath of packageJsonPaths()) {
  const rel = packagePath.slice(repoRoot.length + 1);
  const packageDir = dirname(packagePath);
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  for (const { script, bin } of undeclaredBinaries(pkg.scripts, (candidate) =>
    binaryIsProvided(packageDir, candidate),
  )) {
    fail(
      'C',
      `${rel}#${script}`,
      declared.has(bin)
        ? `runs "${bin}", declared in package.json but not provided by node_modules/.bin — run \`pnpm install\``
        : `runs "${bin}" but it is neither declared as a dependency nor provided by node_modules/.bin`,
    );
  }
}

// --------------------------------------------------------------------------------- D
const { findUnprobedJournalTags, LEGACY_UNPROBED_MAX_TAG } = await import(
  './lib/database-test-env.mjs'
);
for (const tag of findUnprobedJournalTags()) {
  fail(
    'D',
    'scripts/lib/database-test-env.mjs',
    `journal tag ${tag} is above ${LEGACY_UNPROBED_MAX_TAG} and has no artefact probe in MIGRATION_EFFECT_CHECKS`,
  );
}

// ------------------------------------------------------------------------------ report
if (jsonOutput) {
  process.stdout.write(
    `${JSON.stringify(
      {
        scanned: { mjs: mjsFiles.length, ps1: ps1Files.length },
        selfTest: { total: selfTest.total, failed: selfTest.failed.length },
        checks: {
          A: 'syntax (node --check)',
          B: 'module resolution from the script location',
          C: 'npm script binaries provided by the install',
          D: 'migration artefact probes cover every domain journal tag',
        },
        failures,
      },
      null,
      2,
    )}\n`,
  );
} else if (failures.length === 0) {
  console.log(
    `scripts gate OK — ${mjsFiles.length} .mjs checked (syntax, resolution), ` +
      `npm script binaries provided, migration probes complete, ` +
      `detectors self-tested (${selfTest.total}/${selfTest.total})`,
  );
} else {
  console.error(`scripts gate FAILED — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  [${f.check}] ${f.file}\n        ${f.detail}`);
}

process.exit(failures.length > 0 ? 1 : 0);

/**
 * Pure detection logic for the `scripts/` gate. Kept separate from
 * `scripts/check-scripts.mjs` so the detectors can be exercised against known-bad
 * fixtures (`node scripts/check-scripts.mjs --self-test`) without touching the real
 * repository — a gate that is never shown to fail is not evidence.
 *
 * No filesystem, no process, no Node built-ins beyond nothing at all: every function
 * here is a pure transform, which is what makes the self-test meaningful.
 */

/**
 * Strip comments and line comments so the specifier scan cannot match prose or
 * documentation examples. Cheap and good enough for ESM sources: it only has to
 * avoid false positives, because a missed specifier is caught by Node at runtime.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/(^|[^:])\/\/[^\n"'`]*$/gm, '$1 ');
}

/**
 * Bare (non-relative, non-`node:`) package specifiers referenced by real import
 * statements.
 *
 * The scan is statement-oriented rather than "any quoted string after `import`",
 * because that naive form produces false positives on ordinary string literals
 * (a script that documents `import 'dotenv/config'` inside a template string, or a
 * gate that embeds fixtures) and false negatives on side-effect imports. Only a
 * line that STARTS a module statement opens the scan, and only the first quoted
 * string of that statement — possibly on a later line, as with
 * `import {\n a,\n} from 'x'` — is taken as the specifier.
 *
 * Side-effect-only imports (`import 'dotenv/config'`) are the exact shape of the
 * real regression, so the self-test asserts them explicitly.
 */
export function staticSpecifiers(source) {
  const found = new Set();
  const add = (raw) => {
    if (!raw) return;
    if (raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('node:')) return;
    if (/[\s;]/.test(raw) || raw.includes('\\')) return;
    found.add(raw.split('/').slice(0, raw.startsWith('@') ? 2 : 1).join('/'));
  };

  // `export const x = 'y'` is not a module statement; `export {..}`, `export *`
  // and `export type {..}` are.
  const OPENS_STATEMENT = /^(?:import\b|export\s*(?:\{|type\s*\{|\*))/;
  const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"])([^'"]+)\1/g;
  const FIRST_STRING = /(['"])([^'"]+)\1/;

  let pending = false;
  for (const line of stripComments(source).split('\n')) {
    const trimmed = line.trim();

    for (const match of line.matchAll(DYNAMIC_IMPORT)) add(match[2]);

    if (!pending) {
      if (!OPENS_STATEMENT.test(trimmed)) continue;
      if (/^import\s*\(/.test(trimmed)) continue; // dynamic form handled above
      pending = true;
    }

    const specifier = trimmed.match(FIRST_STRING);
    if (specifier) {
      add(specifier[2]);
      pending = false;
    } else if (/;\s*$/.test(trimmed)) {
      pending = false;
    }
  }
  return [...found];
}

/** Binaries available from the platform or the shell, with no package install. */
export const ALWAYS_AVAILABLE_BINARIES = new Set([
  'node',
  'npm',
  'npx',
  'pnpm',
  'docker',
  'docker-compose',
  'git',
  'bash',
  'sh',
  'pwsh',
  'powershell',
  'echo',
  'cd',
  'rm',
  'cp',
  'mv',
  'mkdir',
  'curl',
  'sleep',
  'wait',
  'true',
  'false',
]);

const BIN_TOKEN = /^[a-z0-9][a-z0-9._-]*$/i;

/** Leading binaries of an npm script command, following `&&`, `||`, `;` and `|`. */
export function binariesInScript(command) {
  return command
    .split(/&&|\|\||;|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const tokens = segment.split(/\s+/);
      let index = 0;
      while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
      return tokens[index] ?? '';
    })
    .filter((bin) => BIN_TOKEN.test(bin));
}

/**
 * Binaries an npm script requires but which are neither platform-provided nor
 * present in `node_modules/.bin` of the owning package or the workspace root.
 * This is the invariant the real defect broke: an operational script called `tsx`
 * while nothing declared or installed it, so a clean `pnpm install` produced a
 * script that could not run. Matching dependency *names* would not catch that;
 * looking at `.bin` does.
 */
export function undeclaredBinaries(scripts, binaryIsProvided) {
  const problems = [];
  for (const [name, command] of Object.entries(scripts ?? {})) {
    if (typeof command !== 'string') continue;
    for (const bin of binariesInScript(command)) {
      if (ALWAYS_AVAILABLE_BINARIES.has(bin)) continue;
      if (binaryIsProvided(bin)) continue;
      problems.push({ script: name, bin });
    }
  }
  return problems;
}

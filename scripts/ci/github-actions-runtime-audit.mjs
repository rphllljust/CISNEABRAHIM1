import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const workflowsDir = path.resolve('.github/workflows');

const minimumMajor = new Map([
  ['actions/checkout', 5],
  ['actions/setup-node', 5],
  ['actions/cache', 5],
  ['actions/upload-artifact', 7],
  ['actions/download-artifact', 7],
  ['pnpm/action-setup', 6],
  ['docker/login-action', 4],
  ['docker/setup-buildx-action', 4],
  ['docker/build-push-action', 7],
]);

const files = (await readdir(workflowsDir))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const failures = [];

for (const file of files) {
  const fullPath = path.join(workflowsDir, file);
  const source = await readFile(fullPath, 'utf8');
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/\buses:\s*([^\s@]+)@([^\s#]+)/);
    if (!match) continue;

    const [, action, ref] = match;
    const min = minimumMajor.get(action);
    if (min === undefined) continue;

    const version = /^v(\d+)(?:\.|$)/.exec(ref);
    if (!version) {
      failures.push(
        `${file}:${index + 1} ${action}@${ref}: ref nao auditavel; use major Node 24 conhecido (>= v${min})`,
      );
      continue;
    }

    const major = Number(version[1]);
    if (major < min) {
      failures.push(
        `${file}:${index + 1} ${action}@${ref}: major antigo; minimo Node 24 aceito e v${min}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('[actions-runtime-audit] FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `[actions-runtime-audit] PASS: ${files.length} workflows sem majors conhecidos presos em Node 20`,
);

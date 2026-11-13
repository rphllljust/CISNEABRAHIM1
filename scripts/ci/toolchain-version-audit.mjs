#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const match = /^pnpm@(\d+)\.(\d+)\.(\d+)$/.exec(String(pkg.packageManager ?? ''));
if (!match) {
  console.error('[toolchain-audit] packageManager precisa pin exato pnpm@X.Y.Z');
  process.exit(1);
}
const pnpmVersion = match.slice(1).join('.');
const pnpmMajor = Number(match[1]);
const expectedEngine = `>=${pnpmMajor}.0.0 <${pnpmMajor + 1}.0.0`;
const failures = [];

if (pkg.engines?.pnpm !== expectedEngine) {
  failures.push(`engines.pnpm=${pkg.engines?.pnpm ?? 'MISSING'} expected=${expectedEngine}`);
}

const nodeVersion = (await readFile(path.join(root, '.node-version'), 'utf8')).trim();
const nodeMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion);
if (!nodeMatch) {
  failures.push(`.node-version precisa pin exato X.Y.Z; recebido=${nodeVersion || 'MISSING'}`);
}
const nodeMajor = nodeMatch ? Number(nodeMatch[1]) : null;
if (nodeMajor !== null && pkg.engines?.node !== `>=${nodeMajor}.0.0 <${nodeMajor + 1}.0.0`) {
  failures.push(
    `engines.node=${pkg.engines?.node ?? 'MISSING'} diverge do major de .node-version=${nodeVersion}`,
  );
}

const workflowsDir = path.join(root, '.github', 'workflows');
for (const name of await readdir(workflowsDir)) {
  if (!/\.ya?ml$/.test(name)) continue;
  const lines = (await readFile(path.join(workflowsDir, name), 'utf8')).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/uses:\s*pnpm\/action-setup@/.test(lines[i])) continue;
    const indent = lines[i].match(/^\s*/)?.[0].length ?? 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const trimmed = lines[j].trim();
      const currentIndent = lines[j].match(/^\s*/)?.[0].length ?? 0;
      if (trimmed.startsWith('- ') && currentIndent <= indent) break;
      if (/^version:\s*/.test(trimmed)) {
        failures.push(
          `${name}:${j + 1} duplica versao do pnpm; use packageManager=${pkg.packageManager}`,
        );
      }
    }
  }
}

const pinnedFiles = [
  'docker/hml/Dockerfile.api',
  'docker/hml/Dockerfile.web',
  'docker/release/Dockerfile.api',
  'scripts/split-repos/templates/Dockerfile.backend',
  'scripts/split-repos/templates/Dockerfile.frontend',
];

const expectedNodeImage = `node:${nodeVersion}-alpine`;
for (const relative of pinnedFiles) {
  const source = await readFile(path.join(root, relative), 'utf8');
  const bases = [...source.matchAll(/^FROM\s+(node:[^\s]+)(?:\s+AS\s+\S+)?$/gim)].map((m) => m[1]);
  if (bases.length === 0) {
    failures.push(`${relative}: base Node ausente`);
  }
  for (const base of bases) {
    if (base !== expectedNodeImage) {
      failures.push(`${relative}: base=${base} expected=${expectedNodeImage}`);
    }
  }
}

for (const relative of pinnedFiles) {
  const source = await readFile(path.join(root, relative), 'utf8');
  const pins = [...source.matchAll(/corepack prepare pnpm@([^\s]+) --activate/g)].map((m) => m[1]);
  if (pins.length === 0) {
    failures.push(`${relative}: pin corepack do pnpm ausente`);
    continue;
  }
  for (const pin of pins) {
    if (pin !== pnpmVersion) {
      failures.push(`${relative}: pnpm@${pin} diverge de packageManager pnpm@${pnpmVersion}`);
    }
  }
}

const worker = await readFile(path.join(root, 'docker/release/Dockerfile.worker'), 'utf8');
const workerArg = /^ARG CISNE_API_IMAGE=(\S+)$/m.exec(worker)?.[1];
if (!workerArg) {
  failures.push('Dockerfile.worker: CISNE_API_IMAGE precisa de default sintaticamente valido');
} else if (!workerArg.startsWith('invalid.invalid/')) {
  failures.push(
    'Dockerfile.worker: default de CISNE_API_IMAGE deve ser irresolvivel para falhar fechado sem build-arg',
  );
}

if (failures.length > 0) {
  console.error('[toolchain-audit] FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `[toolchain-audit] PASS node=${nodeVersion} pnpm=${pnpmVersion} workflows=packageManager docker=pinned fail-closed-worker-arg=ok`,
);

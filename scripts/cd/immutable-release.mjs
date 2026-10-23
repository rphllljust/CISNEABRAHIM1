#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE_INPUTS = [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/database/package.json',
  'packages/eslint-config/package.json',
  'packages/tsconfig/package.json',
  'apps/api/dist',
  'apps/web/dist',
  'packages/database/dist',
  'packages/database/migrations',
  'docker/release/nginx.conf',
  'docker/release/runtime-config.js.template',
];

function copyInto(root, output, relativePath) {
  const from = resolve(root, relativePath);
  if (!existsSync(from)) throw new Error(`Immutable release input missing: ${relativePath}`);
  const to = resolve(output, relativePath);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

export function packageImmutableRelease({
  root = process.cwd(),
  output = resolve(process.cwd(), 'artifacts/release'),
} = {}) {
  const metadata = JSON.parse(
    readFileSync(resolve(root, 'artifacts/ci/build-metadata.json'), 'utf8'),
  );
  if (!/^[0-9a-f]{40}$/i.test(metadata.commitSha ?? '')) {
    throw new Error('Build metadata commitSha must be a full SHA');
  }

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  for (const relativePath of RELEASE_INPUTS) copyInto(root, output, relativePath);

  for (const name of ['Dockerfile.api', 'Dockerfile.web']) {
    const target = resolve(output, 'docker/release', name);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(resolve(root, 'docker/release', name), target);
  }

  const identity = {
    sourceSha: metadata.commitSha,
    buildRunId: metadata.buildRunId,
  };
  const identityPath = resolve(output, 'artifacts/release-identity.json');
  mkdirSync(dirname(identityPath), { recursive: true });
  writeFileSync(identityPath, `${JSON.stringify(identity)}\n`, 'utf8');

  return { output, ...identity };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const result = packageImmutableRelease();
  console.log(`[release] packaged source=${result.sourceSha} root=${result.output}`);
}

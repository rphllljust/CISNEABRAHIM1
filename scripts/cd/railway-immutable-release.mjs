#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ARTIFACT_PATHS, verifyProvenance } from './verify-provenance.mjs';

export const RELEASE_CONTROL_PATHS = [
  'artifacts/ci/build-metadata.json',
  'artifacts/cd/deploy-manifest.json',
];

export function prepareImmutableRailwayRelease({
  root = process.cwd(),
  output = resolve(process.cwd(), 'artifacts/railway/release'),
} = {}) {
  const source = verifyProvenance({ root });
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  for (const relativePath of [...RELEASE_CONTROL_PATHS, ...DEFAULT_ARTIFACT_PATHS]) {
    const from = resolve(root, relativePath);
    if (!existsSync(from)) {
      throw new Error(`Immutable release input missing: ${relativePath}`);
    }
    const to = resolve(output, relativePath);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }

  const copied = verifyProvenance({
    root: output,
    expectedSourceSha: source.sourceSha,
    expectedArtifactDigest: source.artifactDigest,
  });

  // Railway services already point at these Dockerfile paths. The aliases are
  // exact copies of sealed runtime Dockerfiles; no source Dockerfile is used.
  const apiAlias = resolve(output, 'docker/hml/Dockerfile.api');
  const webAlias = resolve(output, 'docker/railway/Dockerfile.web');
  mkdirSync(dirname(apiAlias), { recursive: true });
  mkdirSync(dirname(webAlias), { recursive: true });
  cpSync(resolve(output, 'docker/release/Dockerfile.api'), apiAlias);
  cpSync(resolve(output, 'docker/release/Dockerfile.web'), webAlias);

  return {
    output,
    sourceSha: copied.sourceSha,
    artifactDigest: copied.artifactDigest,
  };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const result = prepareImmutableRailwayRelease();
  console.log(
    `[railway-release] source=${result.sourceSha} digest=${result.artifactDigest} root=${result.output}`,
  );
}

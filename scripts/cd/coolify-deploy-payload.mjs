#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_RE = /^[0-9a-f]{40}$/i;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/i;
const IMAGE_BY_DIGEST_RE = /^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/i;

function requireMatch(name, value, regex) {
  if (typeof value !== 'string' || !regex.test(value.trim())) {
    throw new Error(`${name} is invalid: ${String(value)}`);
  }
  return value.trim();
}

export function buildCoolifyDeployPayload({
  sourceSha,
  artifactDigest,
  apiImage,
  // Opcional: imagem dedicada do worker (mesmos bits da API, CMD diferente).
  // Ausente => worker herda a imagem da API e depende de WORKER_ENABLED.
  workerImage,
  webImage,
}) {
  const normalizedSha = requireMatch('sourceSha', sourceSha, SHA_RE).toLowerCase();
  const normalizedArtifactDigest = requireMatch(
    'artifactDigest',
    artifactDigest,
    DIGEST_RE,
  ).toLowerCase();
  const normalizedApiImage = requireMatch(
    'apiImage',
    apiImage,
    IMAGE_BY_DIGEST_RE,
  ).toLowerCase();
  const normalizedWorkerImage = workerImage
    ? requireMatch('workerImage', workerImage, IMAGE_BY_DIGEST_RE).toLowerCase()
    : normalizedApiImage;
  const normalizedWebImage = requireMatch(
    'webImage',
    webImage,
    IMAGE_BY_DIGEST_RE,
  ).toLowerCase();

  return {
    schemaVersion: 1,
    sourceSha: normalizedSha,
    artifactDigest: normalizedArtifactDigest,
    images: {
      api: normalizedApiImage,
      worker: normalizedWorkerImage,
      web: normalizedWebImage,
    },
    runtime: {
      api: {
        port: 3000,
        healthPath: '/api/v1/health/ready',
        command: ['node', 'apps/api/dist/main.js'],
      },
      worker: {
        command: ['node', 'apps/api/dist/worker/main.js'],
      },
      web: {
        port: 80,
        healthPath: '/health',
        requiredEnvironment: ['CISNE_PUBLIC_API_URL'],
      },
    },
  };
}

function runCli() {
  const payload = buildCoolifyDeployPayload({
    sourceSha: process.env.COOLIFY_SOURCE_SHA,
    artifactDigest: process.env.COOLIFY_ARTIFACT_DIGEST,
    apiImage: process.env.COOLIFY_API_IMAGE,
    workerImage: process.env.COOLIFY_WORKER_IMAGE,
    webImage: process.env.COOLIFY_WEB_IMAGE,
  });
  const output = resolve(
    process.env.COOLIFY_PAYLOAD_PATH || 'artifacts/coolify/deploy-payload.json',
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `[coolify-payload] source=${payload.sourceSha} artifact=${payload.artifactDigest} output=${output}`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}

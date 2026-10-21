#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectId = process.env.RAILWAY_PROJECT_ID;
const environmentId = process.env.RAILWAY_TARGET_ENVIRONMENT_ID;
const apiServiceId = process.env.RAILWAY_API_SERVICE_ID;
const webServiceId = process.env.RAILWAY_WEB_SERVICE_ID;
const expectedSha =
  process.env.CISNE_DEPLOY_COMMIT_SHA ?? process.env.CD_COMMIT_SHA ?? process.env.RELEASE_SHA;
const expectedDigest =
  process.env.CISNE_DEPLOY_ARTIFACT_DIGEST ?? process.env.CD_ARTIFACT_DIGEST ?? process.env.RELEASE_DIGEST;
const releaseRoot = resolve(process.cwd(), 'artifacts/railway/release');

for (const [key, value] of Object.entries({
  RAILWAY_PROJECT_ID: projectId,
  RAILWAY_TARGET_ENVIRONMENT_ID: environmentId,
  RAILWAY_API_SERVICE_ID: apiServiceId,
  RAILWAY_WEB_SERVICE_ID: webServiceId,
  RELEASE_SHA: expectedSha,
  RELEASE_DIGEST: expectedDigest,
})) {
  if (!value) throw new Error(`${key} is required`);
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'artifacts/cd/deploy-manifest.json'), 'utf8'),
);
if (manifest.commitSha !== expectedSha || manifest.artifactDigest !== expectedDigest) {
  throw new Error(
    `DEPLOY REFUSED: identity mismatch manifestSha=${manifest.commitSha} expectedSha=${expectedSha} manifestDigest=${manifest.artifactDigest} expectedDigest=${expectedDigest}`,
  );
}

function run(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('railway', args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`railway ${args.join(' ')} exited ${code}`));
    });
  });
}

async function stamp(serviceId) {
  await run([
    'variable', 'set',
    `CISNE_RELEASE_SHA=${expectedSha}`,
    `CISNE_RELEASE_DIGEST=${expectedDigest}`,
    '--skip-deploys',
    '--project', projectId,
    '--environment', environmentId,
    '--service', serviceId,
  ]);
}

async function deploy(serviceId, label) {
  await run([
    'up', releaseRoot,
    '--path-as-root',
    '--project', projectId,
    '--environment', environmentId,
    '--service', serviceId,
    '--message', `CISNE ${label} ${expectedSha} ${expectedDigest}`,
  ]);
}

await Promise.all([stamp(apiServiceId), stamp(webServiceId)]);
await Promise.all([
  deploy(apiServiceId, 'api'),
  deploy(webServiceId, 'web'),
]);

console.log(
  `[railway-release] environment=${environmentId} sha=${expectedSha} digest=${expectedDigest} api=SUCCESS web=SUCCESS`,
);

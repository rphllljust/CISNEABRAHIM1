#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const token = process.env.RAILWAY_TOKEN;
const projectId = process.env.RAILWAY_PROJECT_ID;
const environmentId = process.env.RAILWAY_PRODUCTION_ENVIRONMENT_ID;
const apiServiceId = process.env.RAILWAY_API_SERVICE_ID;
const webServiceId = process.env.RAILWAY_WEB_SERVICE_ID;
const releaseSha = process.env.CISNE_DEPLOY_COMMIT_SHA;
const releaseDigest = process.env.CISNE_DEPLOY_ARTIFACT_DIGEST;
const releaseRoot = resolve(process.cwd(), 'artifacts/railway/release');

for (const [key, value] of Object.entries({
  RAILWAY_TOKEN: token,
  RAILWAY_PROJECT_ID: projectId,
  RAILWAY_PRODUCTION_ENVIRONMENT_ID: environmentId,
  RAILWAY_API_SERVICE_ID: apiServiceId,
  RAILWAY_WEB_SERVICE_ID: webServiceId,
  CISNE_DEPLOY_COMMIT_SHA: releaseSha,
  CISNE_DEPLOY_ARTIFACT_DIGEST: releaseDigest,
})) {
  if (!value) throw new Error(`${key} is required`);
}

const manifest = JSON.parse(
  readFileSync(resolve(releaseRoot, 'artifacts/cd/deploy-manifest.json'), 'utf8'),
);
if (manifest.commitSha !== releaseSha || manifest.artifactDigest !== releaseDigest) {
  throw new Error(
    `DEPLOY REFUSED: release identity mismatch manifestSha=${manifest.commitSha} expectedSha=${releaseSha} manifestDigest=${manifest.artifactDigest} expectedDigest=${releaseDigest}`,
  );
}

async function gql(query, variables) {
  const response = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) {
    throw new Error(`Railway GraphQL failed: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data;
}

for (const serviceId of [apiServiceId, webServiceId]) {
  await gql(
    `mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        variables: {
          CISNE_RELEASE_SHA: releaseSha,
          CISNE_RELEASE_DIGEST: releaseDigest,
        },
        replace: false,
        skipDeploys: true,
      },
    },
  );
}

function deploy(serviceId, label) {
  const child = spawnSync(
    'railway',
    [
      'up',
      releaseRoot,
      '--path-as-root',
      '--project',
      projectId,
      '--environment',
      environmentId,
      '--service',
      serviceId,
      '--message',
      `CISNE PROD ${releaseSha} ${releaseDigest} ${label}`,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`Railway ${label} deployment failed with exit ${child.status}`);
  }
}

deploy(apiServiceId, 'api');
deploy(webServiceId, 'web');
console.log(`[railway-production] sha=${releaseSha} digest=${releaseDigest} api=SUCCESS web=SUCCESS`);

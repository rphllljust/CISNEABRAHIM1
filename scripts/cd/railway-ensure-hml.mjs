#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { env } from './secret-envelope.mjs';

const token = env('RAILWAY_API_TOKEN');
const projectId = env('RAILWAY_PROJECT_ID');
const sourceEnvironmentId = env('RAILWAY_PRODUCTION_ENVIRONMENT_ID');
const apiServiceId = env('RAILWAY_API_SERVICE_ID');
const webServiceId = env('RAILWAY_WEB_SERVICE_ID');
const postgresServiceId = env('RAILWAY_POSTGRES_SERVICE_ID');
const releaseSha = env('CD_COMMIT_SHA');
const releaseDigest = env('CD_ARTIFACT_DIGEST');
const name = env('RAILWAY_HML_ENVIRONMENT_NAME') || 'hml';

for (const [key, value] of Object.entries({
  RAILWAY_API_TOKEN: token,
  RAILWAY_PROJECT_ID: projectId,
  RAILWAY_PRODUCTION_ENVIRONMENT_ID: sourceEnvironmentId,
  RAILWAY_API_SERVICE_ID: apiServiceId,
  RAILWAY_WEB_SERVICE_ID: webServiceId,
  RAILWAY_POSTGRES_SERVICE_ID: postgresServiceId,
  CD_COMMIT_SHA: releaseSha,
  CD_ARTIFACT_DIGEST: releaseDigest,
})) {
  if (!value) throw new Error(`${key} is required`);
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

const listed = await gql(
  `query environments($projectId: String!) {
    environments(projectId: $projectId) { edges { node { id name } } }
  }`,
  { projectId },
);

let environment = listed.environments.edges
  .map((edge) => edge.node)
  .find((item) => item.name === name);

if (!environment) {
  const created = await gql(
    `mutation environmentCreate($input: EnvironmentCreateInput!) {
      environmentCreate(input: $input) { id name }
    }`,
    {
      input: {
        projectId,
        name,
        sourceEnvironmentId,
        ephemeral: false,
        skipInitialDeploys: true,
      },
    },
  );
  environment = created.environmentCreate;
}

if (!environment?.id) throw new Error('Unable to resolve Railway HML environment');

for (const serviceId of [apiServiceId, webServiceId]) {
  await gql(
    `mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId,
        environmentId: environment.id,
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

const deploymentsQuery = `query deployments($input: DeploymentListInput!) {
  deployments(input: $input, first: 1) {
    edges { node { id status createdAt } }
  }
}`;

let pg = await gql(deploymentsQuery, {
  input: {
    projectId,
    environmentId: environment.id,
    serviceId: postgresServiceId,
  },
});

let latestPg = pg.deployments.edges[0]?.node ?? null;
if (!latestPg || !['SUCCESS', 'BUILDING', 'DEPLOYING', 'INITIALIZING', 'WAITING', 'QUEUED'].includes(latestPg.status)) {
  await gql(
    `mutation serviceInstanceDeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId: postgresServiceId, environmentId: environment.id },
  );
}

const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  pg = await gql(deploymentsQuery, {
    input: {
      projectId,
      environmentId: environment.id,
      serviceId: postgresServiceId,
    },
  });
  latestPg = pg.deployments.edges[0]?.node ?? null;
  if (latestPg?.status === 'SUCCESS') break;
  if (latestPg && ['FAILED', 'CRASHED', 'REMOVED'].includes(latestPg.status)) {
    throw new Error(`HML Postgres deployment failed: ${latestPg.status}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

if (latestPg?.status !== 'SUCCESS') {
  throw new Error(`HML Postgres did not become ready in time; status=${latestPg?.status ?? 'missing'}`);
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `environment_id=${environment.id}\n`);
}
console.log(
  `[railway-hml] environment=${environment.name} id=${environment.id} postgres=${latestPg.status}`,
);

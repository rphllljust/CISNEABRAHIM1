#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const token = process.env.RAILWAY_TOKEN;
const projectId = process.env.RAILWAY_PROJECT_ID;
const sourceEnvironmentId = process.env.RAILWAY_PRODUCTION_ENVIRONMENT_ID;
const name = process.env.RAILWAY_HML_ENVIRONMENT_NAME || 'hml';

if (!token || !projectId || !sourceEnvironmentId) {
  throw new Error('RAILWAY_TOKEN, RAILWAY_PROJECT_ID and RAILWAY_PRODUCTION_ENVIRONMENT_ID are required');
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
let environment = listed.environments.edges.map((edge) => edge.node).find((item) => item.name === name);

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

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `environment_id=${environment.id}\n`);
}
console.log(`[railway-hml] environment=${environment.name} id=${environment.id}`);

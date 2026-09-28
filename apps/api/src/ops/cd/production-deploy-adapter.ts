import { spawnSync } from 'node:child_process';
import type { DeployManifest } from './cd-types';

export type ProductionDeployResult = {
  ok: boolean;
  detail: string;
};

function parseArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PROD_DEPLOY_ARGS_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('PROD_DEPLOY_ARGS_JSON must be a JSON array of strings');
  }
  const args: string[] = [];
  for (const entry of parsed as unknown[]) {
    if (typeof entry !== 'string') {
      throw new Error('PROD_DEPLOY_ARGS_JSON must be a JSON array of strings');
    }
    args.push(entry);
  }
  return args;
}

export function runProductionDeployAdapter(
  env: NodeJS.ProcessEnv,
  manifest: DeployManifest,
): ProductionDeployResult {
  const command = env['PROD_DEPLOY_COMMAND']?.trim();
  if (!command) {
    return {
      ok: false,
      detail:
        'PROD_DEPLOY_COMMAND is not configured; production promotion cannot pass without a real external deploy adapter',
    };
  }

  let args: string[];
  try {
    args = parseArgs(env['PROD_DEPLOY_ARGS_JSON']);
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const child = spawnSync(command, args, {
    cwd: env['PROD_DEPLOY_WORKDIR']?.trim() || process.cwd(),
    env: {
      ...env,
      CISNE_DEPLOY_VERSION: manifest.version,
      CISNE_DEPLOY_COMMIT_SHA: manifest.commitSha,
      CISNE_DEPLOY_ARTIFACT_DIGEST: manifest.artifactDigest,
      CISNE_DEPLOY_BUILD_RUN_ID: manifest.buildRunId,
    },
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
  });

  if (child.error) {
    return { ok: false, detail: `deploy adapter failed to start: ${child.error.message}` };
  }

  const output = child.stderr?.trim() || child.stdout?.trim() || `exit ${child.status}`;
  if (child.status !== 0) {
    return { ok: false, detail: `deploy adapter failed: ${output}` };
  }

  return {
    ok: true,
    detail: `external deploy adapter completed: ${output}`,
  };
}

#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeployManifest } from '../cd-types';
import { runCdPromotion } from '../cd-pipeline';
import { runProductionDeployAdapter } from '../production-deploy-adapter';

async function main(): Promise<void> {
  const target = process.argv.includes('--production') ? 'production' : 'hml';
  const manifestPath = resolve(process.cwd(), 'artifacts/cd/deploy-manifest.json');
  let sourceManifest: DeployManifest | undefined;
  if (existsSync(manifestPath)) {
    sourceManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DeployManifest;
  }

  const result = await runCdPromotion({
    manifestInput: {
      version: sourceManifest?.version ?? process.env['npm_package_version'] ?? '0.0.0',
      commitSha:
        sourceManifest?.commitSha ??
        process.env['CD_COMMIT_SHA'] ??
        process.env['GITHUB_SHA'] ??
        'local',
      buildRunId:
        sourceManifest?.buildRunId ??
        process.env['CD_BUILD_RUN_ID'] ??
        process.env['GITHUB_RUN_ID'] ??
        'local',
      timestamp: sourceManifest?.timestamp ?? new Date().toISOString(),
      artifactPaths: ['apps/api/dist', 'apps/web/dist', 'packages/database/dist'],
    },
    targetEnvironment: target,
    sourceManifest,
    env: process.env,
    deps: {
      runMigrations: async () => {
        const { spawnSync } = await import('node:child_process');
        const migrate = spawnSync('pnpm', ['--filter', '@cisne/database', 'migrate'], {
          stdio: 'pipe',
          encoding: 'utf8',
          shell: process.platform === 'win32',
          env: process.env,
        });
        return {
          ok: migrate.status === 0,
          detail: migrate.stderr?.trim() || migrate.stdout?.trim() || `exit ${migrate.status}`,
        };
      },
      checkHealth: async (baseUrl) => {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/health/ready`);
        return { ok: response.ok, detail: `status=${response.status}` };
      },
      runSmoke: async () => {
        const { spawnSync } = await import('node:child_process');
        const smoke = spawnSync('pnpm', ['--filter', '@cisne/api', 'hml:smoke'], {
          stdio: 'pipe',
          encoding: 'utf8',
          shell: process.platform === 'win32',
          env: process.env,
        });
        return {
          ok: smoke.status === 0,
          detail: smoke.stderr?.trim() || smoke.stdout?.trim() || `exit ${smoke.status}`,
        };
      },
      deployProduction: async (manifest) => runProductionDeployAdapter(process.env, manifest),
    },
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'PASS') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[cd-promote] fatal', error);
  process.exitCode = 1;
});

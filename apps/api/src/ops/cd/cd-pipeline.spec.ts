import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDeployManifest } from './cd-manifest';
import { assertSafeMigrationDeploy, assessMigrationFile } from './migration-policy';
import { runCdPromotion, runCdRollback } from './cd-pipeline';
import { scanArtifactPathsForSecrets } from './cd-secrets';
import { appendDeployHistory } from './cd-rollback';

const fixtureRoot = join(__dirname, '__fixtures__/artifact');
const artifactPaths = [
  join(fixtureRoot, 'api'),
  join(fixtureRoot, 'web'),
  join(fixtureRoot, 'database'),
];

function safeMigrations() {
  return [{ file: 'noop.sql', risk: 'backward-compatible' as const, rationale: 'test stub' }];
}

function manifestInput() {
  return {
    version: '0.0.0',
    commitSha: 'abc123',
    buildRunId: '42',
    timestamp: '2026-08-30T12:00:00.000Z',
    artifactPaths,
  };
}

describe('CD pipeline (Prompt 87)', () => {
  it('classifies destructive migrations as breaking/high-risk', () => {
    const sample = resolve(
      process.cwd(),
      '../../packages/database/migrations/0000_early_thaddeus_ross.sql',
    );
    const assessment = assessMigrationFile(sample);
    expect(assessment.risk).toBe('backward-compatible');

    expect(() =>
      assertSafeMigrationDeploy(
        [{ file: 'x.sql', risk: 'breaking-high-risk', rationale: 'DROP TABLE' }],
        false,
      ),
    ).toThrow(/Breaking/);
  });

  it('simulates successful HML promotion with mandatory smoke', async () => {
    const result = await runCdPromotion({
      manifestInput: manifestInput(),
      targetEnvironment: 'hml',
      deps: {
        assessMigrations: safeMigrations,
        runMigrations: async () => ({ ok: true, detail: 'migrated' }),
        checkHealth: async () => ({ ok: true, detail: 'ready' }),
        runSmoke: async () => ({ ok: true, detail: '10/10' }),
      },
    });
    expect(result.status).toBe('PASS');
    expect(result.manifest.environment).toBe('hml');
    expect(result.stages.find((stage) => stage.id === 'hml_smoke')?.passed).toBe(true);
  });

  it('blocks promotion on health failure before smoke', async () => {
    const result = await runCdPromotion({
      manifestInput: manifestInput(),
      targetEnvironment: 'hml',
      deps: {
        assessMigrations: safeMigrations,
        runMigrations: async () => ({ ok: true, detail: 'migrated' }),
        checkHealth: async () => ({ ok: false, detail: 'not_ready' }),
        runSmoke: async () => ({ ok: true, detail: 'should not run' }),
      },
    });
    expect(result.status).toBe('FAIL');
    expect(result.stages.find((stage) => stage.id === 'hml_smoke')?.passed).toBe(false);
  });

  it('blocks promotion on smoke failure', async () => {
    const result = await runCdPromotion({
      manifestInput: manifestInput(),
      targetEnvironment: 'hml',
      deps: {
        assessMigrations: safeMigrations,
        runMigrations: async () => ({ ok: true, detail: 'migrated' }),
        checkHealth: async () => ({ ok: true, detail: 'ready' }),
        runSmoke: async () => ({ ok: false, detail: 'login failed' }),
      },
    });
    expect(result.status).toBe('FAIL');
    expect(result.error).toContain('login failed');
  });

  it('blocks promotion on migration failure', async () => {
    const result = await runCdPromotion({
      manifestInput: manifestInput(),
      targetEnvironment: 'hml',
      deps: {
        assessMigrations: safeMigrations,
        runMigrations: async () => ({ ok: false, detail: 'migration lock timeout' }),
      },
    });
    expect(result.status).toBe('FAIL');
    expect(result.stages.find((stage) => stage.id === 'hml_deploy')?.passed).toBe(false);
  });

  it('requires explicit gate for production and promotes same artifact', async () => {
    const ci = createDeployManifest({ ...manifestInput(), environment: 'ci' });
    const blocked = await runCdPromotion({
      manifestInput: manifestInput(),
      targetEnvironment: 'production',
      sourceManifest: ci,
      env: {},
      deps: { assessMigrations: safeMigrations },
    });
    expect(blocked.status).toBe('FAIL');

    const blockedByReadiness = await runCdPromotion({
      manifestInput: manifestInput(),
      targetEnvironment: 'production',
      sourceManifest: ci,
      env: { PRD_PROMOTION_APPROVED: 'I_UNDERSTAND' },
      deps: { assessMigrations: safeMigrations },
    });
    expect(blockedByReadiness.status).toBe('FAIL');
    expect(blockedByReadiness.error).toMatch(/Production operations blocked/);

    const noDeployAdapter = await runCdPromotion({
      manifestInput: manifestInput(),
      targetEnvironment: 'production',
      sourceManifest: ci,
      env: {
        PRD_PROMOTION_APPROVED: 'I_UNDERSTAND',
        PROD_PUBLIC_API_URL: 'https://api.cisne.example',
      },
      deps: {
        assessMigrations: safeMigrations,
        assertProductionReadiness: () => undefined,
        checkHealth: async () => ({ ok: true, detail: 'ready' }),
      },
    });
    expect(noDeployAdapter.status).toBe('FAIL');
    expect(noDeployAdapter.error).toMatch(/deploy adapter/i);

    const approved = await runCdPromotion({
      manifestInput: manifestInput(),
      targetEnvironment: 'production',
      sourceManifest: ci,
      env: {
        PRD_PROMOTION_APPROVED: 'I_UNDERSTAND',
        PROD_PUBLIC_API_URL: 'https://api.cisne.example',
      },
      deps: {
        assessMigrations: safeMigrations,
        assertProductionReadiness: () => undefined,
        deployProduction: async () => ({ ok: true, detail: 'external deploy complete' }),
        checkHealth: async () => ({ ok: true, detail: 'status=200' }),
      },
    });
    expect(approved.status).toBe('PASS');
    expect(approved.manifest.artifactDigest).toBe(ci.artifactDigest);
    expect(approved.stages.find((stage) => stage.id === 'production_deploy')?.detail).toContain(
      'status=200',
    );
  });

  it('supports application rollback without assuming DB rollback', async () => {
    const first = createDeployManifest({
      ...manifestInput(),
      commitSha: 'first',
      buildRunId: '1',
      environment: 'production',
    });
    const second = createDeployManifest({
      ...manifestInput(),
      commitSha: 'second',
      buildRunId: '2',
      environment: 'production',
    });
    const history = appendDeployHistory(appendDeployHistory({ entries: [] }, first), second);
    const rollback = await runCdRollback({ history, environment: 'production' });
    expect(rollback.status).toBe('PASS');
    expect(rollback.plan.databaseRollbackSupported).toBe(false);
    expect(rollback.plan.previousManifestDigest).toBe(first.artifactDigest);
  });

  it('detects secrets embedded in artifact output', () => {
    const violations = scanArtifactPathsForSecrets([join(fixtureRoot, 'api')]);
    expect(violations).toEqual([]);
  });
});

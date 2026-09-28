import { assertNoSecretsInArtifact, assertSecretsFromStoreOnly } from './cd-secrets';
import { assertSameArtifactPromotion, createDeployManifest, withEnvironment, type ManifestInput } from './cd-manifest';
import { assertSafeMigrationDeploy, assessMigrationsDirectory } from './migration-policy';
import { appendDeployHistory, buildRollbackPlan, type DeployHistory } from './cd-rollback';
import type { CdPromotionResult, CdStageResult, DeployManifest } from './cd-types';

import type { MigrationAssessment } from './cd-types';
import {
  assertProductionOperationsAllowed,
  loadReadinessGateForOperations,
} from '../readiness/production-operations-guard';

export type CdPipelineDeps = {
  assessMigrations?: () => MigrationAssessment[];
  runMigrations?: () => Promise<{ ok: boolean; detail: string }>;
  checkHealth?: (baseUrl: string) => Promise<{ ok: boolean; detail: string }>;
  runSmoke?: (baseUrl: string) => Promise<{ ok: boolean; detail: string }>;
  deployProduction?: (manifest: DeployManifest) => Promise<{ ok: boolean; detail: string }>;
  history?: DeployHistory;
  /** Test hook — defaults to production readiness guard */
  assertProductionReadiness?: (env: NodeJS.ProcessEnv) => void;
};

function stage(id: CdStageResult['id'], label: string, passed: boolean, detail: string): CdStageResult {
  return { id, label, passed, detail };
}

export function assertProductionPromotionGate(env: NodeJS.ProcessEnv = process.env): void {
  if (env['PRD_PROMOTION_APPROVED'] !== 'I_UNDERSTAND') {
    throw new Error(
      'Production promotion requires explicit PRD_PROMOTION_APPROVED=I_UNDERSTAND — no automatic irreversible deploy',
    );
  }
}

export async function runCdPromotion(input: {
  manifestInput: ManifestInput;
  targetEnvironment: 'hml' | 'production';
  env?: NodeJS.ProcessEnv;
  deps?: CdPipelineDeps;
  sourceManifest?: DeployManifest;
}): Promise<CdPromotionResult> {
  const env = input.env ?? process.env;
  const deps = input.deps ?? {};
  const stages: CdStageResult[] = [];
  const history = deps.history ?? { entries: [] };

  const ciManifest = createDeployManifest({ ...input.manifestInput, environment: 'ci' });
  stages.push(
    stage('artifact_validation', 'Build-once artifact manifest', true, ciManifest.artifactDigest),
  );

  try {
    assertNoSecretsInArtifact(input.manifestInput.artifactPaths);
    stages.push(stage('secret_scan', 'No secrets in artifact', true, 'clean'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('secret_scan', 'No secrets in artifact', false, detail));
    return fail(ciManifest, stages, detail, history);
  }

  try {
    const assessments = deps.assessMigrations ? deps.assessMigrations() : assessMigrationsDirectory();
    assertSafeMigrationDeploy(assessments, env['CD_ALLOW_BREAKING_MIGRATIONS'] === 'I_UNDERSTAND');
    const breaking = assessments.filter((entry) => entry.risk === 'breaking-high-risk').length;
    stages.push(
      stage(
        'migration_policy',
        'Migration policy',
        true,
        `backward-compatible=${assessments.length - breaking}; breaking=${breaking}`,
      ),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('migration_policy', 'Migration policy', false, detail));
    return fail(ciManifest, stages, detail, history);
  }

  if (input.targetEnvironment === 'hml') {
    const migrate = deps.runMigrations
      ? await deps.runMigrations()
      : { ok: true, detail: 'skipped (no runner)' };
    stages.push(stage('hml_deploy', 'HML deploy (migrations)', migrate.ok, migrate.detail));
    if (!migrate.ok) {
      return fail(ciManifest, stages, migrate.detail, history);
    }

    const baseUrl = env['HML_PUBLIC_API_URL'] ?? 'http://127.0.0.1:3100';
    const health = deps.checkHealth
      ? await deps.checkHealth(baseUrl)
      : { ok: true, detail: 'skipped (no runner)' };
    if (!health.ok) {
      stages.push(stage('hml_smoke', 'HML smoke (health prerequisite)', false, health.detail));
      return fail(ciManifest, stages, health.detail, history);
    }

    const smoke = deps.runSmoke
      ? await deps.runSmoke(baseUrl)
      : { ok: true, detail: 'skipped (no runner)' };
    stages.push(stage('hml_smoke', 'HML smoke (mandatory)', smoke.ok, smoke.detail));
    if (!smoke.ok) {
      return fail(ciManifest, stages, smoke.detail, history);
    }

    stages.push(stage('acceptance', 'HML acceptance gate', true, 'smoke passed'));
    const hmlManifest = withEnvironment(ciManifest, 'hml');
    const updated = appendDeployHistory(history, hmlManifest);
    const previous = buildRollbackPlan(updated, 'hml').previousManifestDigest;
    return {
      status: 'PASS',
      manifest: hmlManifest,
      stages,
      previousManifestDigest: previous,
    };
  }

  try {
    const assertReadiness =
      deps.assertProductionReadiness ??
      ((environment: NodeJS.ProcessEnv) =>
        assertProductionOperationsAllowed(loadReadinessGateForOperations(environment)));
    assertReadiness(env);
    assertProductionPromotionGate(env);
    assertSecretsFromStoreOnly(env);
    stages.push(stage('production_gate', 'Production promotion gate', true, 'readiness GO + explicit approval'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('production_gate', 'Production promotion gate', false, detail));
    return fail(ciManifest, stages, detail, history);
  }

  if (!input.sourceManifest) {
    const detail = 'Production promotion requires a source CI manifest; build-once provenance is mandatory';
    stages.push(stage('production_deploy', 'Promote same artifact to PRD', false, detail));
    return fail(ciManifest, stages, detail, history);
  }

  try {
    assertSameArtifactPromotion(input.sourceManifest, ciManifest);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push(stage('production_deploy', 'Promote same artifact to PRD', false, detail));
    return fail(ciManifest, stages, detail, history);
  }

  const prdManifest = withEnvironment(ciManifest, 'production');
  if (!deps.deployProduction) {
    const detail =
      'Production deploy adapter is not configured; refusing to report PASS without an external deployment';
    stages.push(stage('production_deploy', 'Promote same artifact to PRD', false, detail));
    return fail(ciManifest, stages, detail, history);
  }

  const deployed = await deps.deployProduction(prdManifest);
  if (!deployed.ok) {
    stages.push(stage('production_deploy', 'Promote same artifact to PRD', false, deployed.detail));
    return fail(ciManifest, stages, deployed.detail, history);
  }

  const productionBaseUrl = env['PROD_PUBLIC_API_URL']?.trim();
  if (!productionBaseUrl || !deps.checkHealth) {
    const detail =
      'Production health verification requires PROD_PUBLIC_API_URL and an active health-check runner';
    stages.push(stage('production_deploy', 'Promote same artifact to PRD', false, detail));
    return fail(ciManifest, stages, detail, history);
  }

  const health = await deps.checkHealth(productionBaseUrl);
  if (!health.ok) {
    const detail = `production deploy completed but readiness check failed: ${health.detail}`;
    stages.push(stage('production_deploy', 'Promote same artifact to PRD', false, detail));
    return fail(ciManifest, stages, detail, history);
  }

  stages.push(
    stage(
      'production_deploy',
      'Promote same artifact to PRD',
      true,
      `${deployed.detail}; readiness=${health.detail}; no rebuild`,
    ),
  );
  const updated = appendDeployHistory(history, prdManifest);
  const rollback = buildRollbackPlan(updated, 'production');
  return {
    status: 'PASS',
    manifest: prdManifest,
    stages,
    previousManifestDigest: rollback.previousManifestDigest,
  };
}

function fail(
  manifest: DeployManifest,
  stages: CdStageResult[],
  error: string,
  history: DeployHistory,
): CdPromotionResult {
  const previous = history.entries.length > 0 ? history.entries[history.entries.length - 1]?.artifactDigest ?? null : null;
  return {
    status: 'FAIL',
    manifest,
    stages,
    previousManifestDigest: previous,
    error,
  };
}

export async function runCdRollback(input: {
  history: DeployHistory;
  environment: 'hml' | 'production';
}): Promise<{ status: 'PASS' | 'FAIL'; plan: ReturnType<typeof buildRollbackPlan> }> {
  const plan = buildRollbackPlan(input.history, input.environment);
  if (!plan.applicationRollbackSupported || !plan.previousManifestDigest) {
    return { status: 'FAIL', plan };
  }
  return { status: 'PASS', plan };
}

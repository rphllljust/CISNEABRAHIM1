import { assertNoUnauthorizedPilotFlags, listPilotEnvFlags } from './pilot-flags';
import {
  loadFeedbackRegistry,
  openPilotBlockers,
  summarizeFeedbackByCategory,
} from './pilot-feedback';
import { evaluateObservationThresholds, hasMetMinObservationDays, loadPilotExitCriteria } from './pilot-exit';
import { buildPilotObservation, type PilotMetricsInput } from './pilot-observation';
import {
  assertPilotEnvironment,
  assertPilotNotFullRollout,
  loadPilotScope,
  summarizePilotScope,
} from './pilot-scope';
import type { PilotPhase, PilotStatusReport } from './pilot-types';

export function runPilotStatusCheck(input: {
  env?: NodeJS.ProcessEnv;
  metrics: PilotMetricsInput;
  feedbackPath?: string;
  pilotStartedAt?: string;
  now?: Date;
}): PilotStatusReport {
  const env = input.env ?? process.env;
  assertPilotEnvironment(env);
  assertPilotNotFullRollout(env);
  assertNoUnauthorizedPilotFlags(env);

  const scope = loadPilotScope(env);
  const exitCriteria = loadPilotExitCriteria(env);
  const observation = buildPilotObservation(input.metrics);
  const registry = loadFeedbackRegistry(input.feedbackPath ?? env['PILOT_FEEDBACK_FILE'] ?? '.pilot/feedback.json');
  const feedbackSummary = summarizeFeedbackByCategory(registry);
  const openBlockers = openPilotBlockers(registry);

  const threshold = evaluateObservationThresholds(observation, exitCriteria);
  const exitCriteriaMet = [...threshold.met];
  const exitCriteriaFailed = [...threshold.failed];

  if (
    input.pilotStartedAt &&
    hasMetMinObservationDays(input.pilotStartedAt, exitCriteria.minObservationDays, input.now)
  ) {
    exitCriteriaMet.push('min_observation_days');
  } else {
    exitCriteriaFailed.push('min_observation_days');
  }

  if (openBlockers.length <= exitCriteria.maxOpenBlockers) {
    exitCriteriaMet.push('no_open_blockers');
  } else {
    exitCriteriaFailed.push(`open_blockers=${openBlockers.length}`);
  }

  const criticalOpen = registry.items.filter(
    (item) => item.status === 'OPEN' && item.severity === 'CRITICAL',
  ).length;
  if (criticalOpen <= exitCriteria.maxCriticalOpen) {
    exitCriteriaMet.push('no_open_critical');
  } else {
    exitCriteriaFailed.push(`open_critical=${criticalOpen}`);
  }

  let phase: PilotPhase = 'ACTIVE';
  const hardFailures = exitCriteriaFailed.filter((entry) => entry !== 'min_observation_days');
  if (openBlockers.length > 0 || hardFailures.length > 0) {
    phase = 'BLOCKED';
  } else if (exitCriteriaFailed.length === 0) {
    phase = 'EXIT_READY';
  }

  return {
    phase,
    scope,
    observation,
    feedbackSummary,
    openBlockers,
    exitCriteria,
    exitCriteriaMet,
    exitCriteriaFailed,
    featureFlags: listPilotEnvFlags(env),
  };
}

export function formatPilotStatusSummary(report: PilotStatusReport): string {
  return `phase=${report.phase}; scope=${summarizePilotScope(report.scope)}; blockers=${report.openBlockers.length}`;
}

import { describe, expect, it } from 'vitest';
import {
  createFeedbackItem,
  openPilotBlockers,
  registerFeedback,
  summarizeFeedbackByCategory,
} from './pilot-feedback';
import { assertNoUnauthorizedPilotFlags, isPilotEnvFlagEnabled } from './pilot-flags';
import { evaluateObservationThresholds, hasMetMinObservationDays } from './pilot-exit';
import { buildPilotObservation, httpBaselineFromPrompt82 } from './pilot-observation';
import { formatPilotStatusSummary, runPilotStatusCheck } from './pilot-runner';
import { assertPilotNotFullRollout, loadPilotScope } from './pilot-scope';

function pilotEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CISNE_ENV: 'pilot',
    PILOT_PROGRAM_ENABLED: 'true',
    PILOT_MAX_USERS: '5',
    PILOT_MAX_ACTIVE_SERVICE_ORDERS: '10',
    PILOT_ALLOWED_ARCHETYPES: 'RENTAL,TRANSPORT',
    PILOT_ALLOWED_UNIT_IDS: 'unit-pilot-a',
    PILOT_VOLUME_CAP_PER_WEEK: '15',
    PILOT_MIN_OBSERVATION_DAYS: '14',
    PILOT_STARTED_AT: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function healthyMetrics() {
  return {
    httpRequests: 1000,
    httpErrors: 2,
    httpLatencyP95Ms: 450,
    dbQueries: 5000,
    dbErrors: 0,
    dbPoolWaiting: 0,
    workerPending: 1,
    outboxFailed: 0,
    serviceOrdersOverdue: 0,
    billingAgingRecords: 0,
    openSupportTickets: 0,
  };
}

describe('controlled pilot (Prompt 90)', () => {
  it('defines limited scope defaults from Prompt 89 UAT archetypes', () => {
    const scope = loadPilotScope(pilotEnv());
    expect(scope.maxUsers).toBeLessThanOrEqual(10);
    expect(scope.allowedArchetypes).toContain('RENTAL');
    expect(scope.volumeCapPerWeek).toBe(15);
  });

  it('blocks full legacy migration during pilot', () => {
    expect(() => assertPilotNotFullRollout(pilotEnv({ PILOT_MIGRATE_ALL_LEGACY_DATA: 'true' }))).toThrow(
      /must not migrate entire legacy/,
    );
  });

  it('does not enable feature flags without infra justification', () => {
    expect(isPilotEnvFlagEnabled('EXTENDED_SERVICES', pilotEnv({ PILOT_FLAG_EXTENDED_SERVICES: 'true' }))).toBe(
      false,
    );
    expect(() =>
      assertNoUnauthorizedPilotFlags(pilotEnv({ PILOT_FLAG_EXTENDED_SERVICES: 'true' })),
    ).toThrow(/PILOT_INFRA_EXTENDED/);
  });

  it('separates feedback categories without mixing bug and feature', () => {
    let registry = { items: [] as ReturnType<typeof createFeedbackItem>[] };
    registry = registerFeedback(
      registry,
      createFeedbackItem({ category: 'bug', severity: 'MAJOR', summary: 'allocation overlap UI' }),
    );
    registry = registerFeedback(
      registry,
      createFeedbackItem({ category: 'new_feature', severity: 'MINOR', summary: 'export CSV extra column' }),
    );
    const summary = summarizeFeedbackByCategory(registry);
    expect(summary.bug).toBe(1);
    expect(summary.new_feature).toBe(1);
    expect(summary.ux_improvement).toBe(0);
  });

  it('treats BLOCKER feedback as pilot exit blocker', () => {
    const registry = registerFeedback(
      { items: [] },
      createFeedbackItem({ category: 'bug', severity: 'BLOCKER', summary: 'billing total mismatch' }),
    );
    expect(openPilotBlockers(registry)).toHaveLength(1);
  });

  it('evaluates observation thresholds for errors latency worker and billing', () => {
    const observation = buildPilotObservation(healthyMetrics());
    const result = evaluateObservationThresholds(observation, {
      minObservationDays: 14,
      maxHttpErrorRate: 0.02,
      maxHttpLatencyP95Ms: 2000,
      maxOpenBlockers: 0,
      maxCriticalOpen: 0,
    });
    expect(result.failed).toEqual([]);
    expect(result.met).toContain('billing_aging_zero');
  });

  it('reports EXIT_READY when criteria met and no blockers', () => {
    const report = runPilotStatusCheck({
      env: pilotEnv(),
      metrics: healthyMetrics(),
      pilotStartedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(report.phase).toBe('EXIT_READY');
    expect(formatPilotStatusSummary(report)).toContain('phase=EXIT_READY');
  });

  it('reports BLOCKED when allocation conflicts exceed threshold', () => {
    const blocked = runPilotStatusCheck({
      env: pilotEnv(),
      metrics: { ...healthyMetrics(), allocationConflictSignals: 2 },
      pilotStartedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(blocked.phase).toBe('BLOCKED');
    expect(blocked.exitCriteriaFailed).toContain('allocation_conflicts=2');
  });

  it('reports BLOCKED when worker/outbox failures exceed threshold', () => {
    const blocked = runPilotStatusCheck({
      env: pilotEnv(),
      metrics: { ...healthyMetrics(), outboxFailed: 5 },
      pilotStartedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(blocked.phase).toBe('BLOCKED');
    expect(blocked.exitCriteriaFailed).toContain('outbox_failed=5');
  });

  it('stays ACTIVE when observation window not elapsed', () => {
    const active = runPilotStatusCheck({
      env: pilotEnv(),
      metrics: healthyMetrics(),
      pilotStartedAt: '2026-08-29T00:00:00.000Z',
      now: new Date('2026-08-30T00:00:00.000Z'),
    });
    expect(active.phase).toBe('ACTIVE');
    expect(active.exitCriteriaFailed).toContain('min_observation_days');
  });

  it('requires minimum observation window before exit', () => {
    expect(hasMetMinObservationDays('2026-08-29T00:00:00.000Z', 14, new Date('2026-08-30T00:00:00.000Z'))).toBe(
      false,
    );
    expect(hasMetMinObservationDays('2026-08-01T00:00:00.000Z', 14, new Date('2026-08-30T00:00:00.000Z'))).toBe(
      true,
    );
  });

  it('uses the recorded Prompt 82 max smoke p95 and zero error rate', () => {
    const baseline = httpBaselineFromPrompt82();
    expect(baseline.httpErrorRate).toBe(0);
    expect(baseline.httpLatencyP95Ms).toBe(200);
    expect(baseline.source).toContain('PROMPT_82_SMOKE_P95_MS');
  });
});

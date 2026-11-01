import { describe, expect, it } from 'vitest';
import {
  buildTechnicalAlertDefinitions,
  evaluateTechnicalAlertConditions,
  TechnicalAlertStateTracker,
} from './technical-alert.engine';
import { loadTechnicalAlertPolicy } from './technical-alert-policy';
import {
  TECHNICAL_ALERT_SEVERITIES,
  TECHNICAL_ALERT_STATUSES,
  TECHNICAL_ALERT_TYPES,
  type TechnicalAlertConditionInput,
} from './technical-alert.types';

function baseInput(overrides: Partial<TechnicalAlertConditionInput> = {}): TechnicalAlertConditionInput {
  return {
    httpErrorRate: 0,
    httpRequestCount: 100,
    httpLatencyP95Ms: 100,
    httpLatencyP99Ms: 200,
    dbPoolWaiting: 0,
    dbPoolTotal: 10,
    dbPoolIdle: 5,
    workerPending: 0,
    workerInFlight: 0,
    workerProcessed: 10,
    workerLastActivityAt: new Date().toISOString(),
    outboxPending: 0,
    outboxFailed: 0,
    storageFailures: 0,
    erpFailures: 0,
    trackingFailures: 0,
    erpIntegrationConfigured: false,
    trackingIntegrationConfigured: false,
    notificationFailures: 0,
    backupStatus: 'ok',
    diskUsagePercent: 50,
    ...overrides,
  };
}

describe('evaluateTechnicalAlertConditions', () => {
  const policy = loadTechnicalAlertPolicy({
    ...process.env,
    TECH_ALERT_MIN_HTTP_REQUESTS: '10',
    TECH_ALERT_ERROR_RATE_THRESHOLD: '0.1',
    TECH_ALERT_P99_THRESHOLD_MS: '500',
    TECH_ALERT_DB_POOL_WAITING_THRESHOLD: '2',
    TECH_ALERT_OUTBOX_PENDING_THRESHOLD: '10',
  });

  it('does not breach error rate with insufficient samples', () => {
    const results = evaluateTechnicalAlertConditions(
      baseInput({ httpRequestCount: 5, httpErrorRate: 0.9 }),
      policy,
    );
    const alert = results.find((entry) => entry.alertType === TECHNICAL_ALERT_TYPES.HighErrorRate);
    expect(alert?.breached).toBe(false);
  });

  it('classifies p99 latency as warning not critical for moderate breach', () => {
    const results = evaluateTechnicalAlertConditions(
      baseInput({ httpLatencyP99Ms: 600 }),
      policy,
    );
    const alert = results.find((entry) => entry.alertType === TECHNICAL_ALERT_TYPES.HighLatencyP99);
    expect(alert?.breached).toBe(true);
    expect(alert?.severity).toBe(TECHNICAL_ALERT_SEVERITIES.Warning);
  });

  it('fires a critical alert on orphan invoices or dead financial handoff jobs, and clears on recovery', () => {
    const definitions = buildTechnicalAlertDefinitions(policy);
    const tracker = new TechnicalAlertStateTracker();
    const now = new Date('2026-10-31T12:00:00.000Z');
    const broken = evaluateTechnicalAlertConditions(baseInput({
      billingReceivableOrphans: 2,
      receivableHandoffDead: 1,
    }), policy);
    const active = tracker.evaluate({ now, conditions: broken, definitions });
    const alert = active.find(x => x.alertType === TECHNICAL_ALERT_TYPES.BillingReceivableHandoffFailure);
    expect(alert?.severity).toBe(TECHNICAL_ALERT_SEVERITIES.Critical);
    expect(alert?.observedValue).toContain('orphan_finalized=2');
    expect(alert?.observedValue).toContain('dead_or_failed_handoffs=1');
    expect(alert?.runbook).toBeDefined();

    const healthy = evaluateTechnicalAlertConditions(baseInput({
      billingReceivableOrphans: 0,
      receivableHandoffDead: 0,
    }), policy);
    const after = tracker.evaluate({ now: new Date(now.getTime() + 1000), conditions: healthy, definitions });
    expect(after.some(x => x.alertType === TECHNICAL_ALERT_TYPES.BillingReceivableHandoffFailure)).toBe(false);
    expect(tracker.getResolvedSince(now.toISOString()).some(x =>
      x.alertType === TECHNICAL_ALERT_TYPES.BillingReceivableHandoffFailure
    )).toBe(true);
  });

  it('fires backup failure immediately without duration window', () => {
    const definitions = buildTechnicalAlertDefinitions(policy);
    const tracker = new TechnicalAlertStateTracker();
    const now = new Date('2026-08-30T12:00:00.000Z');

    const conditions = evaluateTechnicalAlertConditions(
      baseInput({ backupStatus: 'failed' }),
      policy,
    );
    const firing = tracker.evaluate({ now, conditions, definitions });
    expect(firing.some((entry) => entry.alertType === TECHNICAL_ALERT_TYPES.BackupFailure)).toBe(
      true,
    );
    expect(firing[0]?.severity).toBe(TECHNICAL_ALERT_SEVERITIES.Critical);
    expect(firing[0]?.runbook).toBeDefined();
  });

  it('does not breach ERP failures when ACL adapter is unconfigured', () => {
    const results = evaluateTechnicalAlertConditions(
      baseInput({ erpFailures: 99, erpIntegrationConfigured: false }),
      policy,
    );
    const alert = results.find((entry) => entry.alertType === TECHNICAL_ALERT_TYPES.ErpFailures);
    expect(alert?.breached).toBe(false);
    expect(alert?.observedValue).toBe('adapter_unconfigured');
  });

  it('breaches ERP failures only when ACL adapter is configured', () => {
    const results = evaluateTechnicalAlertConditions(
      baseInput({ erpFailures: 5, erpIntegrationConfigured: true }),
      policy,
    );
    const alert = results.find((entry) => entry.alertType === TECHNICAL_ALERT_TYPES.ErpFailures);
    expect(alert?.breached).toBe(true);
  });
});

describe('TechnicalAlertStateTracker', () => {
  const policy = {
    ...loadTechnicalAlertPolicy({
      ...process.env,
      TECH_ALERT_OUTBOX_PENDING_THRESHOLD: '5',
      TECH_ALERT_OUTBOX_DURATION_MS: '120000',
    }),
  };
  const definitions = buildTechnicalAlertDefinitions(policy);
  const tracker = new TechnicalAlertStateTracker();

  it('requires threshold plus duration before firing', () => {
    const start = new Date('2026-08-30T12:00:00.000Z');
    const conditions = evaluateTechnicalAlertConditions(
      baseInput({ outboxPending: 20 }),
      policy,
    );

    const first = tracker.evaluate({ now: start, conditions, definitions });
    expect(first).toHaveLength(0);

    const mid = tracker.evaluate({
      now: new Date(start.getTime() + 60_000),
      conditions,
      definitions,
    });
    expect(mid).toHaveLength(0);

    const fired = tracker.evaluate({
      now: new Date(start.getTime() + 120_000),
      conditions,
      definitions,
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]?.alertType).toBe(TECHNICAL_ALERT_TYPES.OutboxBacklog);
    expect(fired[0]?.status).toBe(TECHNICAL_ALERT_STATUSES.Firing);
  });

  it('resolves after condition clears', () => {
    const trackerLocal = new TechnicalAlertStateTracker();
    const start = new Date('2026-08-30T12:00:00.000Z');
    const hot = evaluateTechnicalAlertConditions(baseInput({ outboxPending: 20 }), policy);
    trackerLocal.evaluate({ now: start, conditions: hot, definitions });
    trackerLocal.evaluate({
      now: new Date(start.getTime() + 120_000),
      conditions: hot,
      definitions,
    });

    const cool = evaluateTechnicalAlertConditions(baseInput({ outboxPending: 0 }), policy);
    trackerLocal.evaluate({
      now: new Date(start.getTime() + 180_000),
      conditions: cool,
      definitions,
    });

    const resolved = trackerLocal.getResolvedSince(start.toISOString());
    expect(resolved.some((entry) => entry.status === TECHNICAL_ALERT_STATUSES.Resolved)).toBe(
      true,
    );
  });

  it('ignores isolated latency spike when duration not met', () => {
    const trackerLocal = new TechnicalAlertStateTracker();
    const policyLocal = loadTechnicalAlertPolicy({
      ...process.env,
      TECH_ALERT_P95_THRESHOLD_MS: '200',
      TECH_ALERT_P95_DURATION_MS: '180000',
    });
    const defs = buildTechnicalAlertDefinitions(policyLocal);
    const start = new Date('2026-08-30T12:00:00.000Z');

    const spike = evaluateTechnicalAlertConditions(baseInput({ httpLatencyP95Ms: 900 }), policyLocal);
    trackerLocal.evaluate({ now: start, conditions: spike, definitions: defs });
    const stillQuiet = trackerLocal.evaluate({
      now: new Date(start.getTime() + 30_000),
      conditions: evaluateTechnicalAlertConditions(baseInput({ httpLatencyP95Ms: 100 }), policyLocal),
      definitions: defs,
    });
    expect(stillQuiet).toHaveLength(0);
  });
});

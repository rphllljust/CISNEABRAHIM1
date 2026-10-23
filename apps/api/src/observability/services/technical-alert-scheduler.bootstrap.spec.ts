import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TechnicalAlertSchedulerBootstrap } from './technical-alert-scheduler.bootstrap';

const originalEnabled = process.env['TECHNICAL_ALERT_SCAN_ENABLED'];
const originalInterval = process.env['TECHNICAL_ALERT_SCAN_INTERVAL_MS'];

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('TechnicalAlertSchedulerBootstrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env['TECHNICAL_ALERT_SCAN_INTERVAL_MS'] = '10000';
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnabled === undefined) delete process.env['TECHNICAL_ALERT_SCAN_ENABLED'];
    else process.env['TECHNICAL_ALERT_SCAN_ENABLED'] = originalEnabled;
    if (originalInterval === undefined) delete process.env['TECHNICAL_ALERT_SCAN_INTERVAL_MS'];
    else process.env['TECHNICAL_ALERT_SCAN_INTERVAL_MS'] = originalInterval;
  });

  it('does not evaluate when scheduler is disabled', async () => {
    process.env['TECHNICAL_ALERT_SCAN_ENABLED'] = 'false';
    const alerts = { evaluate: vi.fn() };
    const log = logger();
    const scheduler = new TechnicalAlertSchedulerBootstrap(alerts as never, log as never);

    scheduler.onModuleInit();
    await vi.runOnlyPendingTimersAsync();

    expect(alerts.evaluate).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      'Technical alert scheduler disabled',
      expect.objectContaining({ component: 'technical-alert-scheduler' }),
    );
  });

  it('logs new firing, severity escalation and resolution without repeating steady state', async () => {
    process.env['TECHNICAL_ALERT_SCAN_ENABLED'] = 'true';
    const alerts = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          evaluatedAt: '2026-10-23T14:00:00.000Z',
          firing: [{
            alertType: 'HIGH_ERROR_RATE',
            status: 'FIRING',
            severity: 'WARNING',
            title: 'Alta taxa de erro HTTP',
            message: 'Taxa de erro HTTP acima do limiar.',
            observedValue: '0.10',
            firingSince: '2026-10-23T13:59:00.000Z',
            resolvedAt: null,
          }],
          recentlyResolved: [],
        })
        .mockResolvedValueOnce({
          evaluatedAt: '2026-10-23T14:00:10.000Z',
          firing: [{
            alertType: 'HIGH_ERROR_RATE',
            status: 'FIRING',
            severity: 'WARNING',
            title: 'Alta taxa de erro HTTP',
            message: 'Taxa de erro HTTP acima do limiar.',
            observedValue: '0.11',
            firingSince: '2026-10-23T13:59:00.000Z',
            resolvedAt: null,
          }],
          recentlyResolved: [],
        })
        .mockResolvedValueOnce({
          evaluatedAt: '2026-10-23T14:00:20.000Z',
          firing: [{
            alertType: 'HIGH_ERROR_RATE',
            status: 'FIRING',
            severity: 'CRITICAL',
            title: 'Alta taxa de erro HTTP',
            message: 'Taxa de erro HTTP acima do limiar.',
            observedValue: '0.25',
            firingSince: '2026-10-23T13:59:00.000Z',
            resolvedAt: null,
          }],
          recentlyResolved: [],
        })
        .mockResolvedValueOnce({
          evaluatedAt: '2026-10-23T14:00:30.000Z',
          firing: [],
          recentlyResolved: [{
            alertType: 'HIGH_ERROR_RATE',
            status: 'RESOLVED',
            severity: 'INFO',
            title: 'HIGH_ERROR_RATE resolved',
            message: 'Condição normalizada.',
            observedValue: '',
            firingSince: null,
            resolvedAt: '2026-10-23T14:00:30.000Z',
          }],
        }),
    };
    const log = logger();
    const scheduler = new TechnicalAlertSchedulerBootstrap(alerts as never, log as never);

    scheduler.onModuleInit();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(alerts.evaluate).toHaveBeenCalledTimes(4);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      'Technical alert firing',
      'TECHNICAL_ALERT_CRITICAL',
      expect.objectContaining({
        alertType: 'HIGH_ERROR_RATE',
        severity: 'CRITICAL',
        previousSeverity: 'WARNING',
      }),
    );
    expect(log.info).toHaveBeenCalledWith(
      'Technical alert resolved',
      expect.objectContaining({ alertType: 'HIGH_ERROR_RATE' }),
    );

    scheduler.onModuleDestroy();
  });

  it('does not overlap evaluations', async () => {
    process.env['TECHNICAL_ALERT_SCAN_ENABLED'] = 'true';
    let resolveEvaluation!: (value: unknown) => void;
    const alerts = {
      evaluate: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveEvaluation = resolve;
          }),
      ),
    };
    const log = logger();
    const scheduler = new TechnicalAlertSchedulerBootstrap(alerts as never, log as never);

    scheduler.onModuleInit();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(alerts.evaluate).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      'Technical alert scan skipped because previous evaluation is still running',
      expect.objectContaining({ reason: 'interval' }),
    );

    resolveEvaluation({ evaluatedAt: new Date().toISOString(), firing: [], recentlyResolved: [] });
    await Promise.resolve();
    scheduler.onModuleDestroy();
  });
});

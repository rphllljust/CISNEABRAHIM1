import { describe, expect, it, vi } from 'vitest';
import { BusinessAlertScanService } from '../../../alerts/services/business-alert-scan.service';
import {
  TECHNICAL_ALERT_SEVERITIES,
  TECHNICAL_ALERT_STATUSES,
  TECHNICAL_ALERT_TYPES,
  type TechnicalAlertSnapshot,
} from '../../../observability/alerts/technical-alert.types';
import { StructuredLoggerService } from '../../../observability/logging/structured-logger.service';
import { TechnicalAlertService } from '../../../observability/services/technical-alert.service';
import type { JobHandlerContext } from '../domain/job-handler.types';
import { OperationalAlertScanJobHandler } from './operational-alert-scan.handler';

function snapshot(
  overrides: Partial<TechnicalAlertSnapshot> = {},
): TechnicalAlertSnapshot {
  return {
    alertType: TECHNICAL_ALERT_TYPES.BackupFailure,
    status: TECHNICAL_ALERT_STATUSES.Firing,
    severity: TECHNICAL_ALERT_SEVERITIES.Critical,
    title: 'Backup failure',
    message: 'backup failed',
    observedValue: 'failed',
    firingSince: '2026-10-23T12:00:00.000Z',
    resolvedAt: null,
    runbook: {
      meaning: 'backup failed',
      possibleCauses: ['storage'],
      firstChecks: ['status'],
      safeAction: 'retry backup',
      escalation: 'page operator',
    },
    ...overrides,
  };
}

function context(): JobHandlerContext {
  return {
    jobId: 'job-1',
    jobKind: 'OPERATIONAL_ALERT_SCAN',
    payload: {},
    attemptCount: 1,
    correlationId: 'corr-1',
    signal: new AbortController().signal,
  };
}

describe('OperationalAlertScanJobHandler', () => {
  it('evaluates business and technical alerts and logs a new critical transition once', async () => {
    const scanService = {
      runScan: vi.fn().mockResolvedValue({ created: 1, touched: 2, resolved: 3 }),
    } as unknown as BusinessAlertScanService;
    const critical = snapshot();
    const technicalAlerts = {
      evaluate: vi.fn().mockResolvedValue({
        evaluatedAt: '2026-10-23T12:00:00.000Z',
        firing: [critical],
        recentlyResolved: [],
      }),
    } as unknown as TechnicalAlertService;
    const structuredLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    } as unknown as StructuredLoggerService;

    const handler = new OperationalAlertScanJobHandler(
      scanService,
      technicalAlerts,
      structuredLogger,
    );

    await handler.handle(context());
    await handler.handle(context());

    expect(scanService.runScan).toHaveBeenCalledTimes(2);
    expect(technicalAlerts.evaluate).toHaveBeenCalledTimes(2);
    expect(structuredLogger.error).toHaveBeenCalledTimes(1);
    expect(structuredLogger.error).toHaveBeenCalledWith(
      'technical_alert_firing',
      TECHNICAL_ALERT_TYPES.BackupFailure,
      expect.objectContaining({
        observedValue: 'failed',
        safeAction: 'retry backup',
      }),
    );
  });

  it('logs resolved technical transitions', async () => {
    const scanService = {
      runScan: vi.fn().mockResolvedValue({ created: 0, touched: 0, resolved: 0 }),
    } as unknown as BusinessAlertScanService;
    const resolved = snapshot({
      status: TECHNICAL_ALERT_STATUSES.Resolved,
      firingSince: null,
      resolvedAt: '2026-10-23T12:05:00.000Z',
    });
    const technicalAlerts = {
      evaluate: vi.fn().mockResolvedValue({
        evaluatedAt: '2026-10-23T12:05:00.000Z',
        firing: [],
        recentlyResolved: [resolved],
      }),
    } as unknown as TechnicalAlertService;
    const structuredLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    } as unknown as StructuredLoggerService;

    const handler = new OperationalAlertScanJobHandler(
      scanService,
      technicalAlerts,
      structuredLogger,
    );

    await handler.handle(context());

    expect(structuredLogger.info).toHaveBeenCalledWith(
      'technical_alert_resolved',
      expect.objectContaining({
        alertType: TECHNICAL_ALERT_TYPES.BackupFailure,
        resolvedAt: '2026-10-23T12:05:00.000Z',
      }),
    );
  });
});

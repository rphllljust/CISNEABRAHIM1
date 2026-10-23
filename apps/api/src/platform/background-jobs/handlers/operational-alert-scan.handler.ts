import { Injectable, Logger } from '@nestjs/common';
import { BusinessAlertScanService } from '../../../alerts/services/business-alert-scan.service';
import {
  TECHNICAL_ALERT_SEVERITIES,
  type TechnicalAlertSnapshot,
} from '../../../observability/alerts/technical-alert.types';
import { StructuredLoggerService } from '../../../observability/logging/structured-logger.service';
import {
  TechnicalAlertService,
  type TechnicalAlertsResponse,
} from '../../../observability/services/technical-alert.service';
import { BACKGROUND_JOB_KINDS } from '../domain/background-job-kind';
import type { BackgroundJobHandler, JobHandlerContext } from '../domain/job-handler.types';

@Injectable()
export class OperationalAlertScanJobHandler implements BackgroundJobHandler {
  readonly jobKind = BACKGROUND_JOB_KINDS.OperationalAlertScan;
  private readonly logger = new Logger(OperationalAlertScanJobHandler.name);
  private activeTechnicalAlerts = new Set<string>();

  constructor(
    private readonly scanService: BusinessAlertScanService,
    private readonly technicalAlerts: TechnicalAlertService,
    private readonly structuredLogger: StructuredLoggerService,
  ) {}

  async handle(_context: JobHandlerContext): Promise<void> {
    const [business, technical] = await Promise.all([
      this.scanService.runScan(),
      this.technicalAlerts.evaluate(),
    ]);

    this.logTechnicalTransitions(technical);
    this.logger.log(
      `Operational alert scan job finished created=${business.created} touched=${business.touched} resolved=${business.resolved} technicalFiring=${technical.firing.length} technicalResolved=${technical.recentlyResolved.length}`,
    );
  }

  private logTechnicalTransitions(result: TechnicalAlertsResponse): void {
    const current = new Set(result.firing.map((alert) => alert.alertType));

    for (const alert of result.firing) {
      if (this.activeTechnicalAlerts.has(alert.alertType)) {
        continue;
      }
      this.logFiring(alert);
    }

    for (const alert of result.recentlyResolved) {
      this.structuredLogger.info('technical_alert_resolved', {
        alertType: alert.alertType,
        severity: alert.severity,
        title: alert.title,
        observedValue: alert.observedValue,
        resolvedAt: alert.resolvedAt,
      });
    }

    this.activeTechnicalAlerts = current;
  }

  private logFiring(alert: TechnicalAlertSnapshot): void {
    const metadata = {
      alertType: alert.alertType,
      severity: alert.severity,
      title: alert.title,
      observedValue: alert.observedValue,
      firingSince: alert.firingSince,
      safeAction: alert.runbook?.safeAction,
      escalation: alert.runbook?.escalation,
    };

    if (alert.severity === TECHNICAL_ALERT_SEVERITIES.Critical) {
      this.structuredLogger.error('technical_alert_firing', alert.alertType, metadata);
      return;
    }
    if (alert.severity === TECHNICAL_ALERT_SEVERITIES.Warning) {
      this.structuredLogger.warn('technical_alert_firing', metadata);
      return;
    }
    this.structuredLogger.info('technical_alert_firing', metadata);
  }
}

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TECHNICAL_ALERT_SEVERITIES } from '../alerts/technical-alert.types';
import type { TechnicalAlertSnapshot } from '../alerts/technical-alert.types';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import { TechnicalAlertService } from './technical-alert.service';

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 10_000;

function scanEnabled(): boolean {
  return process.env['TECHNICAL_ALERT_SCAN_ENABLED'] === 'true';
}

function scanIntervalMs(): number {
  const parsed = Number.parseInt(
    process.env['TECHNICAL_ALERT_SCAN_INTERVAL_MS'] ?? String(DEFAULT_INTERVAL_MS),
    10,
  );
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
  return Math.max(parsed, MIN_INTERVAL_MS);
}

@Injectable()
export class TechnicalAlertSchedulerBootstrap implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private evaluating = false;
  private readonly activeSeverities = new Map<string, string>();

  constructor(
    private readonly alerts: TechnicalAlertService,
    private readonly logger: StructuredLoggerService,
  ) {}

  onModuleInit(): void {
    if (!scanEnabled()) {
      this.logger.info('Technical alert scheduler disabled', {
        component: 'technical-alert-scheduler',
      });
      return;
    }

    void this.scan('bootstrap');
    this.timer = setInterval(() => {
      void this.scan('interval');
    }, scanIntervalMs());
    this.timer.unref?.();

    this.logger.info('Technical alert scheduler started', {
      component: 'technical-alert-scheduler',
      intervalMs: scanIntervalMs(),
    });
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async scan(reason: 'bootstrap' | 'interval'): Promise<void> {
    if (this.evaluating) {
      this.logger.warn('Technical alert scan skipped because previous evaluation is still running', {
        component: 'technical-alert-scheduler',
        reason,
      });
      return;
    }

    this.evaluating = true;
    try {
      const result = await this.alerts.evaluate();
      const current = new Map(result.firing.map((alert) => [alert.alertType, alert.severity]));

      for (const alert of result.firing) {
        const previousSeverity = this.activeSeverities.get(alert.alertType);
        if (previousSeverity !== alert.severity) {
          this.logFiring(alert, reason, previousSeverity ?? null);
        }
      }

      for (const alert of result.recentlyResolved) {
        this.logger.info('Technical alert resolved', {
          component: 'technical-alert-scheduler',
          reason,
          alertType: alert.alertType,
          resolvedAt: alert.resolvedAt,
        });
      }

      this.activeSeverities.clear();
      for (const [alertType, severity] of current) {
        this.activeSeverities.set(alertType, severity);
      }
    } catch (error) {
      this.logger.error('Technical alert evaluation failed', 'TECHNICAL_ALERT_EVALUATION_FAILED', {
        component: 'technical-alert-scheduler',
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.evaluating = false;
    }
  }

  private logFiring(
    alert: TechnicalAlertSnapshot,
    reason: 'bootstrap' | 'interval',
    previousSeverity: string | null,
  ): void {
    const metadata = {
      component: 'technical-alert-scheduler',
      reason,
      alertType: alert.alertType,
      severity: alert.severity,
      previousSeverity,
      observedValue: alert.observedValue,
      firingSince: alert.firingSince,
      runbook: alert.runbook,
    };

    if (alert.severity === TECHNICAL_ALERT_SEVERITIES.Critical) {
      this.logger.error('Technical alert firing', 'TECHNICAL_ALERT_CRITICAL', metadata);
      return;
    }
    if (alert.severity === TECHNICAL_ALERT_SEVERITIES.Warning) {
      this.logger.warn('Technical alert firing', metadata);
      return;
    }
    this.logger.info('Technical alert firing', metadata);
  }
}

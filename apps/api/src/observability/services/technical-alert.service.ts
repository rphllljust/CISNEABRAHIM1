import { Injectable } from '@nestjs/common';
import { loadIntegrationCapabilitySnapshot } from '../../integrations/acl/config/integration-capability.config';
import {
  buildTechnicalAlertDefinitions,
  evaluateTechnicalAlertConditions,
  TechnicalAlertStateTracker,
} from '../alerts/technical-alert.engine';
import { loadTechnicalAlertPolicy } from '../alerts/technical-alert-policy';
import type {
  TechnicalAlertConditionInput,
  TechnicalAlertSnapshot,
} from '../alerts/technical-alert.types';
import { MetricsRegistryService } from '../metrics/metrics-registry.service';
import { ObservabilityMetricsService } from './observability-metrics.service';
import { PlatformMetricsCollectorService } from './platform-metrics-collector.service';

export type TechnicalAlertsResponse = {
  evaluatedAt: string;
  firing: TechnicalAlertSnapshot[];
  recentlyResolved: TechnicalAlertSnapshot[];
};

@Injectable()
export class TechnicalAlertService {
  private readonly policy = loadTechnicalAlertPolicy();
  private readonly definitions = buildTechnicalAlertDefinitions(this.policy);
  private readonly state = new TechnicalAlertStateTracker();
  private lastEvaluationAt: string | null = null;

  constructor(
    private readonly metricsService: ObservabilityMetricsService,
    private readonly platform: PlatformMetricsCollectorService,
    private readonly registry: MetricsRegistryService,
  ) {}

  async evaluate(now: Date = new Date()): Promise<TechnicalAlertsResponse> {
    const [metrics, disk] = await Promise.all([
      this.metricsService.collect(),
      this.platform.collectDiskUsage(),
    ]);
    const backup = this.platform.collectBackupStatus();
    const conditionInput = this.buildConditionInput(metrics, backup, disk.usagePercent);
    const conditions = evaluateTechnicalAlertConditions(conditionInput, this.policy);
    const firing = this.state.evaluate({ now, conditions, definitions: this.definitions });
    const recentlyResolved = this.state.getResolvedSince(this.lastEvaluationAt);
    this.lastEvaluationAt = now.toISOString();

    return {
      evaluatedAt: now.toISOString(),
      firing,
      recentlyResolved,
    };
  }

  private buildConditionInput(
    metrics: Awaited<ReturnType<ObservabilityMetricsService['collect']>>,
    backup: ReturnType<PlatformMetricsCollectorService['collectBackupStatus']>,
    diskUsagePercent: number | null,
  ): TechnicalAlertConditionInput {
    const http = metrics.technical.http;
    const httpErrorRate = http.total > 0 ? http.errors / http.total : null;
    const integrationCapabilities = loadIntegrationCapabilitySnapshot();

    return {
      httpErrorRate,
      httpRequestCount: http.total,
      httpLatencyP95Ms: http.latencyMs.p95,
      httpLatencyP99Ms: http.latencyMs.p99,
      dbPoolWaiting: metrics.technical.db.pool.waiting,
      dbPoolTotal: metrics.technical.db.pool.total,
      dbPoolIdle: metrics.technical.db.pool.idle,
      workerPending: metrics.technical.backlog.workerPending,
      workerInFlight: metrics.technical.worker.inFlight,
      workerProcessed: metrics.technical.worker.processed,
      workerLastActivityAt: this.registry.getWorkerLastActivityAt(),
      outboxPending: metrics.technical.backlog.outboxPending,
      outboxFailed: metrics.technical.backlog.outboxFailed,
      receivableHandoffDead: metrics.technical.backlog.receivableHandoffDead,
      billingReceivableOrphans: metrics.technical.backlog.billingReceivableOrphans,
      storageFailures: metrics.technical.failures.storageFailures,
      erpFailures: metrics.technical.backlog.erpFailures,
      trackingFailures: metrics.technical.backlog.trackingFailures,
      erpIntegrationConfigured: integrationCapabilities.erp.configured,
      trackingIntegrationConfigured: integrationCapabilities.tracking.configured,
      notificationFailures: Math.max(
        metrics.technical.backlog.notificationFailures,
        metrics.technical.failures.notificationFailures,
      ),
      backupStatus: backup.status,
      diskUsagePercent,
    };
  }
}

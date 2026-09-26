import { Injectable, Logger, Optional } from '@nestjs/common';
import { statfs } from 'node:fs/promises';
import type { Pool } from 'pg';
import { readBackupStatusSnapshot } from '../../ops/backup/backup-status-reader';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { OUTBOX_EVENT_STATUSES } from '../../platform/outbox/domain/outbox-status';
import { BACKGROUND_JOB_STATUSES } from '../../platform/background-jobs/domain/background-job-kind';
import { loadTechnicalAlertPolicy } from '../alerts/technical-alert-policy';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import { MetricsRegistryService } from '../metrics/metrics-registry.service';

export type PlatformBacklogSnapshot = {
  workerPending: number;
  outboxPending: number;
  outboxFailed: number;
  notificationFailures: number;
  integrationFailures: number;
  erpFailures: number;
  trackingFailures: number;
};

export type BackupStatusSnapshot = {
  status: 'unknown' | 'ok' | 'failed';
  checkedAt: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  artifactCount: number | null;
};

export type DiskUsageSnapshot = {
  path: string | null;
  usagePercent: number | null;
};

/**
 * Falha de coleta de metrica de plataforma.
 *
 * Invariante (mesmo contrato do BusinessMetricsCollectorService): uma metrica que NAO pode ser
 * medida nunca e publicada como `0`. `0` e um valor legitimo ("medido, zero") e por isso
 * indistinguivel de "nao medido" — publicar 0 em falha desarma silenciosamente os alertas
 * tecnicos (OUTBOX_BACKLOG, ERP_FAILURES, TRACKING_FAILURES, NOTIFICATION_FAILURES, WORKER_STALLED),
 * que decidem exatamente a partir destes contadores. A falha sobe como erro tipado.
 */
export class PlatformMetricsCollectionError extends Error {
  constructor(
    readonly metric: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PlatformMetricsCollectionError';
  }
}

type CollectionDiagnostic = {
  metric: string;
  message: string;
  collectedAt: string;
};

@Injectable()
export class PlatformMetricsCollectorService {
  private readonly logger = new Logger(PlatformMetricsCollectorService.name);
  private readonly alertPolicy = loadTechnicalAlertPolicy();
  private lastCollectionError: CollectionDiagnostic | null = null;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly metrics: MetricsRegistryService,
    @Optional() private readonly structuredLogger?: StructuredLoggerService,
  ) {}

  /** Diagnostico da ultima falha de coleta (health/signal). null = ultima coleta sem erro. */
  getLastCollectionError(): CollectionDiagnostic | null {
    return this.lastCollectionError;
  }

  async collectBacklogs(): Promise<PlatformBacklogSnapshot> {
    const pool = this.pool();
    if (!pool) {
      const message = 'DATABASE_NOT_CONFIGURED';
      this.recordFailure('backlog', message, new Error(message));
      throw new PlatformMetricsCollectionError('backlog', message);
    }

    const [
      workerPending,
      outboxPending,
      outboxFailed,
      notificationFailures,
      integrationFailures,
      erpFailures,
      trackingFailures,
    ] = await Promise.all([
      this.count(
        pool,
        'workerPending',
        `SELECT COUNT(*)::text AS count FROM plt.background_jobs WHERE status = $1`,
        [BACKGROUND_JOB_STATUSES.Pending],
      ),
      this.count(
        pool,
        'outboxPending',
        `SELECT COUNT(*)::text AS count FROM evt.outbox_events WHERE status = $1`,
        [OUTBOX_EVENT_STATUSES.Pending],
      ),
      this.count(
        pool,
        'outboxFailed',
        `SELECT COUNT(*)::text AS count FROM evt.outbox_events WHERE status = $1`,
        [OUTBOX_EVENT_STATUSES.Failed],
      ),
      this.count(
        pool,
        'notificationFailures',
        `SELECT COUNT(*)::text AS count FROM ntf.delivery_attempts WHERE status = 'FAILED'`,
      ),
      this.count(
        pool,
        'integrationFailures',
        `SELECT COUNT(*)::text AS count FROM int.integration_inbox WHERE status = 'FAILED'`,
      ),
      this.countIntegrationFailures(pool, 'erpFailures', this.alertPolicy.erpProviderPatterns),
      this.countIntegrationFailures(
        pool,
        'trackingFailures',
        this.alertPolicy.trackingProviderPatterns,
      ),
    ]);

    this.lastCollectionError = null;
    return {
      workerPending,
      outboxPending,
      outboxFailed,
      notificationFailures,
      integrationFailures,
      erpFailures,
      trackingFailures,
    };
  }

  collectBackupStatus(): BackupStatusSnapshot {
    return readBackupStatusSnapshot(process.env);
  }

  async collectDiskUsage(): Promise<DiskUsageSnapshot> {
    const path = this.alertPolicy.objectStoragePath;
    if (!path) {
      return { path: null, usagePercent: null };
    }
    try {
      const stats = await statfs(path);
      const total = stats.bsize * stats.blocks;
      const available = stats.bsize * stats.bavail;
      if (total <= 0) {
        return { path, usagePercent: null };
      }
      const used = total - available;
      return { path, usagePercent: (used / total) * 100 };
    } catch {
      return { path, usagePercent: null };
    }
  }

  async collectDbPoolSnapshot(): Promise<{
    configured: boolean;
    total: number | null;
    idle: number | null;
    waiting: number | null;
  }> {
    const pool = this.pool();
    if (!pool) {
      return { configured: false, total: null, idle: null, waiting: null };
    }
    return {
      configured: true,
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
  }

  getRuntimeFailureCounters() {
    return this.metrics.getFailureCounters();
  }

  private pool(): Pool | null {
    return this.databaseService.getConnection()?.pool ?? null;
  }

  private async countIntegrationFailures(
    pool: Pool,
    metric: string,
    patterns: string[],
  ): Promise<number> {
    if (patterns.length === 0) {
      return 0;
    }
    const clauses = patterns.map((_, index) => `provider ILIKE $${index + 2}`);
    const sql = `SELECT COUNT(*)::text AS count
      FROM int.integration_inbox
      WHERE status = $1 AND (${clauses.join(' OR ')})`;
    return this.count(pool, metric, sql, ['FAILED', ...patterns.map((pattern) => `%${pattern}%`)]);
  }

  private async count(
    pool: Pool,
    metric: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<number> {
    try {
      const result = await pool.query<{ count: string }>(sql, params);
      return Number.parseInt(result.rows[0]?.count ?? '0', 10);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordFailure(metric, message, error);
      throw new PlatformMetricsCollectionError(metric, message, { cause: error });
    }
  }

  private recordFailure(metric: string, message: string, _error: unknown): void {
    const collectedAt = new Date().toISOString();
    this.lastCollectionError = { metric, message, collectedAt };
    this.structuredLogger?.operation({
      level: 'error',
      message: 'platform_metric_collection_failed',
      operation: `platform:${metric}`,
      result: 'failure',
      errorCode: message,
      metadata: { metric, collectedAt },
    });
    this.logger.error(`Platform metric collection failed metric=${metric} error=${message}`);
  }
}

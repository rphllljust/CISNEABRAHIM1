import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { TERMINAL_SERVICE_ORDER_STATUSES } from '../../service-orders/domain/service-order.state-machine';
import { StructuredLoggerService } from '../logging/structured-logger.service';

export type BusinessMetricsSnapshot = {
  serviceOrdersOverdue: number;
  measurementsAging: number;
  billingAging: number;
};

export class BusinessMetricsCollectionError extends Error {
  constructor(
    readonly metric: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BusinessMetricsCollectionError';
  }
}

type CollectionDiagnostic = {
  metric: string;
  message: string;
  collectedAt: string;
};

@Injectable()
export class BusinessMetricsCollectorService {
  private readonly logger = new Logger(BusinessMetricsCollectorService.name);
  private lastCollectionError: CollectionDiagnostic | null = null;

  constructor(
    private readonly databaseService: DatabaseService,
    @Optional() private readonly structuredLogger?: StructuredLoggerService,
  ) {}

  /** Diagnóstico da última falha de coleta (health/signal). null = última coleta sem erro. */
  getLastCollectionError(): CollectionDiagnostic | null {
    return this.lastCollectionError;
  }

  async collect(): Promise<BusinessMetricsSnapshot> {
    const pool = this.pool();
    if (!pool) {
      const message = 'DATABASE_NOT_CONFIGURED';
      this.recordFailure('business', message, new Error(message));
      throw new BusinessMetricsCollectionError('business', message);
    }

    const terminalStatuses = Array.from(TERMINAL_SERVICE_ORDER_STATUSES)
      .map((status) => `'${status}'`)
      .join(', ');

    // serviceOrdersOverdue: usa a definição canônica de deadline (so.deadline_for),
    // nunca a coluna inexistente rpt.read_service_orders.deadline.
    const [serviceOrdersOverdue, measurementsAging, billingAging] = await Promise.all([
      this.executeCount(
        'serviceOrdersOverdue',
        pool,
        `SELECT COUNT(*)::text AS count
         FROM rpt.read_service_orders so
         WHERE so.status NOT IN (${terminalStatuses})
           AND so.deadline_for(so.id) IS NOT NULL
           AND so.deadline_for(so.id) <= NOW()`,
      ),
      this.executeCount(
        'measurementsAging',
        pool,
        `SELECT COUNT(*)::text AS count
         FROM rpt.read_measurements m
         WHERE m.status IN ('SUBMITTED', 'UNDER_REVIEW')
           AND m.submitted_at < NOW() - interval '7 days'`,
      ),
      this.executeCount(
        'billingAging',
        pool,
        `SELECT COUNT(*)::text AS count
         FROM rpt.read_billing_records br
         WHERE br.status = 'PREPARED'
           AND br.prepared_at < NOW() - interval '7 days'`,
      ),
    ]);

    this.lastCollectionError = null;
    return { serviceOrdersOverdue, measurementsAging, billingAging };
  }

  private pool(): Pool | null {
    return this.databaseService.getConnection()?.pool ?? null;
  }

  private async executeCount(metric: string, pool: Pool, sql: string): Promise<number> {
    try {
      const result = await pool.query<{ count: string }>(sql);
      return Number.parseInt(result.rows[0]?.count ?? '0', 10);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordFailure(metric, message, error);
      throw new BusinessMetricsCollectionError(metric, message, { cause: error });
    }
  }

  private recordFailure(metric: string, message: string, _error: unknown): void {
    const collectedAt = new Date().toISOString();
    this.lastCollectionError = { metric, message, collectedAt };
    this.structuredLogger?.operation({
      level: 'error',
      message: 'business_metric_collection_failed',
      operation: `business:${metric}`,
      result: 'failure',
      errorCode: message,
      metadata: { metric, collectedAt },
    });
    this.logger.error(`Business metric collection failed metric=${metric} error=${message}`);
  }
}

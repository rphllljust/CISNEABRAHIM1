import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { TERMINAL_SERVICE_ORDER_STATUSES } from '../../service-orders/domain/service-order.state-machine';

export type BusinessMetricsSnapshot = {
  serviceOrdersOverdue: number;
  measurementsAging: number;
  billingAging: number;
};

@Injectable()
export class BusinessMetricsCollectorService {
  constructor(private readonly databaseService: DatabaseService) {}

  async collect(): Promise<BusinessMetricsSnapshot> {
    const pool = this.pool();
    if (!pool) {
      return {
        serviceOrdersOverdue: 0,
        measurementsAging: 0,
        billingAging: 0,
      };
    }

    const terminalStatuses = Array.from(TERMINAL_SERVICE_ORDER_STATUSES)
      .map((status) => `'${status}'`)
      .join(', ');

    const [serviceOrdersOverdue, measurementsAging, billingAging] = await Promise.all([
      this.count(pool, `SELECT COUNT(*)::text AS count
        FROM rpt.read_service_orders so
        WHERE so.status NOT IN (${terminalStatuses})
          AND so.deadline_for(so.id) IS NOT NULL
          AND so.deadline_for(so.id) <= NOW()`),
      this.count(pool, `SELECT COUNT(*)::text AS count
        FROM rpt.read_measurements
        WHERE status IN ('SUBMITTED', 'UNDER_REVIEW')
          AND submitted_at < NOW() - interval '7 days'`),
      this.count(pool, `SELECT COUNT(*)::text AS count
        FROM rpt.read_billing_records
        WHERE status IN ('PREPARED', 'AWAITING_PAYMENT')
          AND prepared_at < NOW() - interval '7 days'`),
    ]);

    return { serviceOrdersOverdue, measurementsAging, billingAging };
  }

  private pool(): Pool | null {
    return this.databaseService.getConnection()?.pool ?? null;
  }

  private async count(pool: Pool, sql: string): Promise<number> {
    try {
      const result = await pool.query<{ count: string }>(sql);
      return Number.parseInt(result.rows[0]?.count ?? '0', 10);
    } catch {
      return 0;
    }
  }
}

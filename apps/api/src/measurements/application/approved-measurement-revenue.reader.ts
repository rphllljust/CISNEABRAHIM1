import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  resolveApprovedMeasurementRevenueEvidence,
  type ApprovedMeasurementRevenueEvidence,
  type ApprovedMeasurementRevenueRow,
} from '../domain/approved-measurement-revenue';

/**
 * Published, read-only Measurement projection for the Operations Cost-to-Serve
 * consumer. Measurement owns msr tables; the consumer never reads their
 * persistence directly. Access to a specific OS/cost is checked by the caller's
 * PDP BEFORE this projection is queried.
 *
 * No assumption is made that measurement approval equals acceptance, invoicing,
 * cash receipt, or journal recognition.
 */
@Injectable()
export class ApprovedMeasurementRevenueReader {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) throw new Error('DATABASE_URL is not configured.');
    return connection.pool;
  }

  async readForServiceOrder(
    serviceOrderId: string,
    client?: PoolClient,
  ): Promise<ApprovedMeasurementRevenueEvidence> {
    const sql = `SELECT NULLIF(UPPER(TRIM(mi.pricing_line_snapshot->>'currencyCode')), '') AS currency_code,
              SUM(mi.line_amount)::text AS total_revenue,
              COUNT(*) FILTER (WHERE mi.line_amount IS NULL)::integer AS missing_amount_count
         FROM msr.measurements m
         INNER JOIN msr.measurement_items mi ON mi.measurement_id = m.id
        WHERE m.service_order_id = $1
          AND m.status = 'APPROVED'::msr.measurement_status
        GROUP BY 1
        ORDER BY 1`;
    const result = client
      ? await client.query<ApprovedMeasurementRevenueRow>(sql, [serviceOrderId])
      : await this.pool().query<ApprovedMeasurementRevenueRow>(sql, [serviceOrderId]);
    return resolveApprovedMeasurementRevenueEvidence(result.rows);
  }
}

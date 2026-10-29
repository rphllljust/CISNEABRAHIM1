import type { Pool, PoolClient } from 'pg';

/**
 * Transactional participation boundary for billing (ADR-003).
 * Only measurements module reads or locks msr.* rows.
 */
export type MeasurementForBillingRow = {
  id: string;
  service_order_id: string;
  status: string;
  row_version: number;
  commercial_reference_snapshot: Record<string, unknown>;
};

export type MeasurementItemForBillingRow = {
  id: string;
  line_number: number;
  source_execution_entry_id: string | null;
  unit_code: string;
  measured_quantity: string;
  unit_price: string | null;
  line_amount: string | null;
  pricing_line_snapshot: Record<string, unknown>;
};

export async function lockMeasurementForBilling(
  client: PoolClient,
  measurementId: string,
): Promise<void> {
  await client.query(`SELECT id FROM msr.measurements WHERE id = $1 FOR UPDATE`, [measurementId]);
}

export async function findMeasurementForBilling(
  pool: Pool,
  measurementId: string,
  serviceOrderId: string,
): Promise<MeasurementForBillingRow | null> {
  const result = await pool.query<MeasurementForBillingRow>(
    `SELECT id, service_order_id, status::text AS status, commercial_reference_snapshot
     FROM msr.measurements
     WHERE id = $1 AND service_order_id = $2`,
    [measurementId, serviceOrderId],
  );
  return result.rows[0] ?? null;
}

export async function listMeasurementItemsForBilling(
  pool: Pool,
  measurementId: string,
): Promise<MeasurementItemForBillingRow[]> {
  const result = await pool.query<MeasurementItemForBillingRow>(
    `SELECT id, line_number, source_execution_entry_id, unit_code,
            measured_quantity::text AS measured_quantity,
            unit_price::text AS unit_price,
            line_amount::text AS line_amount,
            pricing_line_snapshot
     FROM msr.measurement_items
     WHERE measurement_id = $1
     ORDER BY line_number ASC`,
    [measurementId],
  );
  return result.rows;
}
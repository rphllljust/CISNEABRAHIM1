import type { Pool } from 'pg';

/**
 * Fatos do Operations Control Center da OS.
 *
 * Nenhuma tabela nova e nenhuma duplicacao: tudo vem dos dominios existentes por UMA consulta com
 * subconsultas escalares (nunca uma consulta por bloco). Os estados de medicao e faturamento sao
 * lidos dos read models cross-context (`rpt.read_measurements`, `rpt.read_billing_records`) porque
 * cada modulo dono continua sendo a fonte da sua propria state machine.
 */
export type ServiceOrderControlCenterFacts = {
  planned_resource_count: number;
  active_allocation_count: number;
  execution_entry_count: number;
  execution_evidence_count: number;
  execution_occurrence_count: number;
  executed_quantity_total: string | null;
  measurement_count: number;
  measurement_status: string | null;
  measurement_created_at: string | null;
  billing_count: number;
  billing_status: string | null;
  billing_created_at: string | null;
  billing_total_amount: string | null;
  billing_currency_code: string | null;
};

export async function queryServiceOrderControlCenterFacts(
  pool: Pool,
  serviceOrderId: string,
): Promise<ServiceOrderControlCenterFacts | null> {
  const result = await pool.query<ServiceOrderControlCenterFacts>(
    `SELECT
       (SELECT COUNT(*)::int FROM so.planned_resources pr
         WHERE pr.service_order_id = $1) AS planned_resource_count,
       (SELECT COUNT(*)::int FROM res.resource_allocations ra
         WHERE ra.service_order_id = $1 AND ra.status = 'ACTIVE'::res.resource_allocation_status)
         AS active_allocation_count,
       (SELECT COUNT(*)::int FROM so.execution_entries ee
         WHERE ee.service_order_id = $1) AS execution_entry_count,
       (SELECT COUNT(*)::int FROM so.execution_evidence ev
         WHERE ev.service_order_id = $1) AS execution_evidence_count,
       (SELECT COUNT(*)::int FROM so.execution_occurrences eo
         WHERE eo.service_order_id = $1) AS execution_occurrence_count,
       (SELECT COALESCE(SUM(ee.quantity_value), 0)::text FROM so.execution_entries ee
         WHERE ee.service_order_id = $1 AND ee.quantity_value IS NOT NULL) AS executed_quantity_total,
       (SELECT COUNT(*)::int FROM rpt.read_measurements m
         WHERE m.service_order_id = $1) AS measurement_count,
       (SELECT m.status::text FROM rpt.read_measurements m
         WHERE m.service_order_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 1)
         AS measurement_status,
       (SELECT m.created_at FROM rpt.read_measurements m
         WHERE m.service_order_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 1)
         AS measurement_created_at,
       (SELECT COUNT(*)::int FROM rpt.read_billing_records b
         WHERE b.service_order_id = $1) AS billing_count,
       (SELECT b.status::text FROM rpt.read_billing_records b
         WHERE b.service_order_id = $1 ORDER BY b.created_at DESC, b.id DESC LIMIT 1)
         AS billing_status,
       (SELECT b.created_at FROM rpt.read_billing_records b
         WHERE b.service_order_id = $1 ORDER BY b.created_at DESC, b.id DESC LIMIT 1)
         AS billing_created_at,
       (SELECT b.total_amount::text FROM rpt.read_billing_records b
         WHERE b.service_order_id = $1 ORDER BY b.created_at DESC, b.id DESC LIMIT 1)
         AS billing_total_amount,
       (SELECT b.currency_code FROM rpt.read_billing_records b
         WHERE b.service_order_id = $1 ORDER BY b.created_at DESC, b.id DESC LIMIT 1)
         AS billing_currency_code`,
    [serviceOrderId],
  );
  return result.rows[0] ?? null;
}

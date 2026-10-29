import type { Pool, PoolClient } from 'pg';
import {
  deriveAcceptanceState,
  resolveAcceptancePolicy,
} from '../domain/acceptance-policy';

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
): Promise<{ row_version: number; status: string } | null> {
  const result = await client.query<{ row_version: number; status: string }>(
    `SELECT row_version, status::text AS status
       FROM msr.measurements WHERE id = $1 FOR UPDATE`,
    [measurementId],
  );
  return result.rows[0] ?? null;
}

export async function findMeasurementForBilling(
  pool: Pool,
  measurementId: string,
  serviceOrderId: string,
): Promise<MeasurementForBillingRow | null> {
  const result = await pool.query<MeasurementForBillingRow>(
    `SELECT id, service_order_id, status::text AS status, row_version, commercial_reference_snapshot
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
/**
 * Evaluate the SAME customer-acceptance policy used by the Measurement Workbench.
 * Billing invokes this inside its preparation transaction, AFTER acquiring the
 * measurement FOR UPDATE lock. Foreign-key acquisition of KEY SHARE by acceptance
 * inserts serializes concurrent decisions against that lock.
 *
 * For contractual entitlements, which do not require an approved measurement, use
 * the latest measurement of the OS (the same selection as the Workbench). Missing
 * evidence or a missing required decision fail closed; do not use a cached
 * eligibility projection as the command's authority.
 */
export async function customerAcceptanceBlockForBilling(
  client: PoolClient,
  serviceOrderId: string,
  measurementId: string | null,
): Promise<
  | 'CUSTOMER_ACCEPTANCE_PENDING'
  | 'CUSTOMER_ACCEPTANCE_REJECTED'
  | 'CUSTOMER_ACCEPTANCE_EVIDENCE_MISSING'
  | null
> {
  const commercial = await client.query<{
    contract_snapshot: Record<string, unknown> | null;
    service_snapshot: Record<string, unknown> | null;
    client_purchase_order_requirement: string | null;
  }>(
    `SELECT so.contract_snapshot, so.service_snapshot,
            c.purchase_order_requirement AS client_purchase_order_requirement
       FROM so.service_orders so
       LEFT JOIN rpt.read_clients c ON c.id = so.client_id
      WHERE so.id = $1`,
    [serviceOrderId],
  );
  const context = commercial.rows[0];
  if (!context) return 'CUSTOMER_ACCEPTANCE_PENDING';

  const resolved = resolveAcceptancePolicy({
    contractSnapshot: context.contract_snapshot,
    serviceSnapshot: context.service_snapshot,
    clientPurchaseOrderRequirement: context.client_purchase_order_requirement,
  });
  if (resolved.policy === 'NOT_REQUIRED') return null;

  let selectedMeasurementId = measurementId;
  if (!selectedMeasurementId) {
    const latest = await client.query<{ id: string }>(
      `SELECT id FROM msr.measurements
        WHERE service_order_id = $1
        ORDER BY created_at DESC
        LIMIT 1 FOR UPDATE`,
      [serviceOrderId],
    );
    selectedMeasurementId = latest.rows[0]?.id ?? null;
  }
  if (!selectedMeasurementId) return 'CUSTOMER_ACCEPTANCE_PENDING';

  const decisions = await client.query<{
    id: string;
    cycle_number: number;
    result: string;
    observation: string;
    rejection_reason: string | null;
    evidence_id: string | null;
    signature_id: string | null;
    customer_signer_name: string | null;
    accepted_by_identity_id: string;
    occurred_at: string;
  }>(
    `SELECT id, cycle_number, result::text AS result, observation,
            rejection_reason, evidence_id, signature_id, customer_signer_name,
            accepted_by_identity_id, occurred_at
       FROM msr.customer_acceptances
      WHERE measurement_id = $1 AND service_order_id = $2
      ORDER BY cycle_number DESC
      LIMIT 1`,
    [selectedMeasurementId, serviceOrderId],
  );
  const latest = decisions.rows[0];
  const state = deriveAcceptanceState({
    policy: resolved.policy,
    latestAcceptance: latest
      ? {
          id: latest.id,
          cycleNumber: latest.cycle_number,
          result: latest.result,
          observation: latest.observation,
          rejectionReason: latest.rejection_reason,
          evidenceId: latest.evidence_id,
          signatureId: latest.signature_id,
          customerSignerName: latest.customer_signer_name,
          acceptedByIdentityId: latest.accepted_by_identity_id,
          occurredAt: latest.occurred_at,
        }
      : null,
  });
  return state.blockingReason as
    | 'CUSTOMER_ACCEPTANCE_PENDING'
    | 'CUSTOMER_ACCEPTANCE_REJECTED'
    | 'CUSTOMER_ACCEPTANCE_EVIDENCE_MISSING'
    | null;
}

import { Pool, type PoolClient } from 'pg';
import {
  SYNTHETIC_SEED_DISPLAY_PREFIX,
  SYNTHETIC_SEED_NAMESPACE,
} from './synthetic-seed-constants';
import { syntheticExternalRef, syntheticInternalCode } from './deterministic-synthetic-identifiers';

type DbClient = Pool | PoolClient;

export type SyntheticScenarioCompensationResult = {
  scenarioKey: string;
  clientRemoved: boolean;
  catalogArtifactsRemoved: number;
  assetsRemoved: number;
};

async function deleteBillingForServiceOrders(client: DbClient, serviceOrderIds: string[]): Promise<void> {
  if (serviceOrderIds.length === 0) {
    return;
  }
  // The HML harness composes Finance: issuing a synthetic document creates a
  // real receivable. Remove only titles tied to these synthetic OS identities
  // before deleting their Billing origins; installments cascade. A settlement
  // keeps its FK and deliberately prevents silent erasure of economic history.
  await client.query(
    `DELETE FROM fin.receivables WHERE origin_service_order_id = ANY($1::uuid[])`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM bil.billing_document_items
     WHERE billing_document_id IN (
       SELECT bd.id FROM bil.billing_documents bd
       INNER JOIN bil.billing_records br ON br.id = bd.billing_record_id
       WHERE br.service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM bil.billing_document_history_events
     WHERE billing_document_id IN (
       SELECT bd.id FROM bil.billing_documents bd
       INNER JOIN bil.billing_records br ON br.id = bd.billing_record_id
       WHERE br.service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM bil.billing_document_command_idempotency
     WHERE billing_document_id IN (
       SELECT bd.id FROM bil.billing_documents bd
       INNER JOIN bil.billing_records br ON br.id = bd.billing_record_id
       WHERE br.service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM bil.billing_documents
     WHERE billing_record_id IN (
       SELECT id FROM bil.billing_records WHERE service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  // The Commercial domain records a PO balance consumption at Billing prepare.
  // It uses an intentionally RESTRICTED FK to the Billing record. Remove only
  // entries whose originating Billing record AND PO belong to this same
  // synthetic client's graph, before removing Billing records. An unrelated
  // PO remains protected by RESTRICT instead of being deleted opportunistically.
  // This executes inside the scenario compensation transaction; settled
  // receivables are checked earlier and prevent the whole cleanup.
  await client.query(
    `DELETE FROM com.purchase_order_consumption_entries ce
      USING bil.billing_records br, com.purchase_orders po
      WHERE ce.billing_record_id = br.id
        AND ce.purchase_order_id = po.id
        AND br.service_order_id = ANY($1::uuid[])
        AND po.client_id = br.client_id`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM bil.billing_items
     WHERE billing_record_id IN (
       SELECT id FROM bil.billing_records WHERE service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM bil.billing_history_events
     WHERE billing_record_id IN (
       SELECT id FROM bil.billing_records WHERE service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM bil.billing_command_idempotency WHERE service_order_id = ANY($1::uuid[])`,
    [serviceOrderIds],
  );
  await client.query(`DELETE FROM bil.billing_records WHERE service_order_id = ANY($1::uuid[])`, [
    serviceOrderIds,
  ]);
}

async function deleteMeasurementsForServiceOrders(client: DbClient, serviceOrderIds: string[]): Promise<void> {
  if (serviceOrderIds.length === 0) {
    return;
  }
  // 0108 keeps acceptance and billing-readiness facts under RESTRICT FKs.
  // Only the isolated synthetic OS graph may be compensated; production
  // economic history is never removed by this harness.
  for (const table of [
    'msr.customer_acceptances',
    'msr.billing_eligibility_evaluations',
    'msr.revenue_leakage_positions',
    'msr.measurement_variances',
  ]) {
    await client.query(`DELETE FROM ${table} WHERE service_order_id = ANY($1::uuid[])`, [
      serviceOrderIds,
    ]);
  }
  await client.query(
    `DELETE FROM msr.measurement_history_events
     WHERE measurement_id IN (
       SELECT id FROM msr.measurements WHERE service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM msr.measurement_adjustments
     WHERE measurement_id IN (
       SELECT id FROM msr.measurements WHERE service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM msr.measurement_items
     WHERE measurement_id IN (
       SELECT id FROM msr.measurements WHERE service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM msr.measurement_command_idempotency
     WHERE measurement_id IN (
       SELECT id FROM msr.measurements WHERE service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(`DELETE FROM msr.measurements WHERE service_order_id = ANY($1::uuid[])`, [
    serviceOrderIds,
  ]);
}

async function deleteExecutionForServiceOrders(client: DbClient, serviceOrderIds: string[]): Promise<void> {
  if (serviceOrderIds.length === 0) {
    return;
  }
  // 0107 persists real dispatch, actuals, closure and measurement-basis facts
  // with RESTRICT FKs. Remove descendants before evidence and legacy entries.
  // Measurements (including basis-linked items) are already compensated.
  for (const table of [
    'so.measurement_basis',
    'so.execution_closures',
    'so.execution_actuals',
    'so.execution_meter_readings',
    'so.execution_fuel_records',
    'so.execution_signatures',
    'so.execution_events',
    'so.execution_situations',
    'so.service_order_dispatches',
    'so.operational_cost_entries',
  ]) {
    await client.query(`DELETE FROM ${table} WHERE service_order_id = ANY($1::uuid[])`, [
      serviceOrderIds,
    ]);
  }
  await client.query(
    `DELETE FROM so.execution_entry_history_events
     WHERE execution_entry_id IN (
       SELECT id FROM so.execution_entries WHERE service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM so.execution_evidence WHERE service_order_id = ANY($1::uuid[])`,
    [serviceOrderIds],
  );
  await client.query(
    `DELETE FROM so.execution_occurrences WHERE service_order_id = ANY($1::uuid[])`,
    [serviceOrderIds],
  );
  await client.query(`DELETE FROM so.execution_entries WHERE service_order_id = ANY($1::uuid[])`, [
    serviceOrderIds,
  ]);
  await client.query(
    `DELETE FROM so.execution_command_idempotency WHERE service_order_id = ANY($1::uuid[])`,
    [serviceOrderIds],
  );
}

async function deletePlanningForServiceOrders(client: DbClient, serviceOrderIds: string[]): Promise<void> {
  if (serviceOrderIds.length === 0) {
    return;
  }
  await client.query(
    `DELETE FROM res.resource_allocation_history_events
     WHERE resource_allocation_id IN (
       SELECT id FROM res.resource_allocations WHERE service_order_id = ANY($1::uuid[])
     )`,
    [serviceOrderIds],
  );
  await client.query(`DELETE FROM res.resource_allocations WHERE service_order_id = ANY($1::uuid[])`, [
    serviceOrderIds,
  ]);
  await client.query(`DELETE FROM so.planned_resources WHERE service_order_id = ANY($1::uuid[])`, [
    serviceOrderIds,
  ]);
  await client.query(`DELETE FROM so.service_order_history_events WHERE service_order_id = ANY($1::uuid[])`, [
    serviceOrderIds,
  ]);
  await client.query(`DELETE FROM so.service_orders WHERE id = ANY($1::uuid[])`, [serviceOrderIds]);
}

async function deleteServiceRequestsForClient(client: DbClient, clientId: string): Promise<void> {
  await client.query(
    `DELETE FROM sr.service_request_history_events
     WHERE service_request_id IN (SELECT id FROM sr.service_requests WHERE client_id = $1::uuid)`,
    [clientId],
  );
  await client.query(
    `DELETE FROM sr.service_request_document_links
     WHERE service_request_id IN (SELECT id FROM sr.service_requests WHERE client_id = $1::uuid)`,
    [clientId],
  );
  await client.query(`DELETE FROM sr.service_requests WHERE client_id = $1::uuid`, [clientId]);
}

async function deleteCommercialForClient(client: DbClient, clientId: string): Promise<void> {
  await client.query(
    `DELETE FROM com.proposal_document_links
     WHERE proposal_version_id IN (
       SELECT pv.id FROM com.proposal_versions pv
       INNER JOIN com.proposals p ON p.id = pv.proposal_id
       WHERE p.client_id = $1::uuid
     )`,
    [clientId],
  );
  await client.query(
    `DELETE FROM com.proposal_items
     WHERE proposal_version_id IN (
       SELECT pv.id FROM com.proposal_versions pv
       INNER JOIN com.proposals p ON p.id = pv.proposal_id
       WHERE p.client_id = $1::uuid
     )`,
    [clientId],
  );
  await client.query(
    `DELETE FROM com.proposal_versions
     WHERE proposal_id IN (SELECT id FROM com.proposals WHERE client_id = $1::uuid)`,
    [clientId],
  );
  await client.query(`DELETE FROM com.proposals WHERE client_id = $1::uuid`, [clientId]);

  await client.query(
    `DELETE FROM com.purchase_order_items
     WHERE purchase_order_id IN (SELECT id FROM com.purchase_orders WHERE client_id = $1::uuid)`,
    [clientId],
  );
  await client.query(`DELETE FROM com.purchase_orders WHERE client_id = $1::uuid`, [clientId]);
}

/** Deletes only contracts attached to the synthetic client being compensated. */
async function deleteContractsForClient(client: DbClient, clientId: string): Promise<void> {
  // Contract descendants have RESTRICT FKs; preserve atomic rollback on failure.
  for (const table of [
    'com.contract_history_events',
    'com.contract_document_links',
    'com.contract_items',
  ]) {
    await client.query(
      `DELETE FROM ${table} WHERE contract_id IN (
         SELECT id FROM com.contracts WHERE client_id = $1::uuid
       )`,
      [clientId],
    );
  }
  await client.query('DELETE FROM com.contracts WHERE client_id = $1::uuid', [clientId]);
}

async function deleteClientGraph(client: DbClient, clientId: string): Promise<void> {
  const serviceOrders = await client.query<{ id: string }>(
    `SELECT id FROM so.service_orders WHERE client_id = $1::uuid`,
    [clientId],
  );
  const serviceOrderIds = serviceOrders.rows.map((row) => row.id);

  await deleteBillingForServiceOrders(client, serviceOrderIds);
  await deleteMeasurementsForServiceOrders(client, serviceOrderIds);
  await deleteExecutionForServiceOrders(client, serviceOrderIds);
  await client.query(
    `UPDATE so.service_orders SET service_request_id = NULL WHERE client_id = $1::uuid`,
    [clientId],
  );
  await deleteServiceRequestsForClient(client, clientId);
  await deletePlanningForServiceOrders(client, serviceOrderIds);
  await deleteContractsForClient(client, clientId);
  await deleteCommercialForClient(client, clientId);

  await client.query(`DELETE FROM pty.client_addresses WHERE client_id = $1::uuid`, [clientId]);
  await client.query(`DELETE FROM pty.client_contacts WHERE client_id = $1::uuid`, [clientId]);
  await client.query(`DELETE FROM pty.clients WHERE id = $1::uuid`, [clientId]);
}

function scenarioSuffix(scenarioKey: string): string {
  return scenarioKey.toUpperCase().replace(/[^A-Z0-9]+/g, '-');
}

async function deleteScenarioCatalogArtifacts(client: DbClient, scenarioKey: string): Promise<number> {
  const suffix = scenarioSuffix(scenarioKey);
  const synServiceCode = syntheticInternalCode('SYN-SRV', scenarioKey);
  const synCategoryCode = `SYN-CAT-${suffix}`;
  const uatServicePattern = `%${suffix}%`;

  const defs = await client.query<{ id: string }>(
    `SELECT d.id
     FROM cat.service_definitions d
     WHERE (d.code = $1
        OR (d.code LIKE 'UAT-SRV-%' AND d.code LIKE $2)
        OR d.code LIKE 'UAT-SRV-' || $3)
       AND NOT EXISTS (
         SELECT 1
         FROM cat.service_definition_versions v
         WHERE v.service_definition_id = d.id
           AND v.status IN ('ACTIVE', 'RETIRED')
       )`,
    [synServiceCode, `%${suffix}%`, suffix],
  );

  for (const def of defs.rows) {
    await client.query(`DELETE FROM cat.service_evidence_requirements WHERE service_definition_version_id IN (
      SELECT id FROM cat.service_definition_versions WHERE service_definition_id = $1::uuid
    )`, [def.id]);
    await client.query(`DELETE FROM cat.service_resource_requirements WHERE service_definition_version_id IN (
      SELECT id FROM cat.service_definition_versions WHERE service_definition_id = $1::uuid
    )`, [def.id]);
    await client.query(`DELETE FROM cat.service_pricing_models WHERE service_definition_version_id IN (
      SELECT id FROM cat.service_definition_versions WHERE service_definition_id = $1::uuid
    )`, [def.id]);
    await client.query(`DELETE FROM cat.service_allowed_units WHERE service_definition_version_id IN (
      SELECT id FROM cat.service_definition_versions WHERE service_definition_id = $1::uuid
    )`, [def.id]);
    await client.query(`DELETE FROM cat.service_legal_classifications WHERE service_definition_version_id IN (
      SELECT id FROM cat.service_definition_versions WHERE service_definition_id = $1::uuid
    )`, [def.id]);
    await client.query(`DELETE FROM cat.service_definition_versions WHERE service_definition_id = $1::uuid`, [
      def.id,
    ]);
    await client.query(`DELETE FROM cat.service_definitions WHERE id = $1::uuid`, [def.id]);
  }

  await client.query(
    `DELETE FROM cat.service_categories c
     WHERE c.code = $1
       AND NOT EXISTS (
         SELECT 1 FROM cat.service_definition_versions v WHERE v.category_id = c.id
       )`,
    [synCategoryCode],
  );
  await client.query(
    `DELETE FROM cat.service_categories c
     WHERE c.code LIKE 'UAT-%' AND c.code LIKE $1
       AND NOT EXISTS (
         SELECT 1 FROM cat.service_definition_versions v WHERE v.category_id = c.id
       )`,
    [uatServicePattern],
  );

  return defs.rows.length;
}

async function deleteScenarioAssets(client: DbClient, scenarioKey: string): Promise<number> {
  const suffix = scenarioSuffix(scenarioKey);
  const assetFilter = [`SYN-%${suffix}%`, `%${suffix}%`, `%-${suffix}`];
  await client.query(
    `DELETE FROM ast.vehicle_profiles
     WHERE asset_id IN (
       SELECT id FROM ast.physical_assets
       WHERE asset_code LIKE $1 OR asset_code LIKE $2 OR asset_code LIKE $3
     )`,
    assetFilter,
  );
  const assets = await client.query(
    `DELETE FROM ast.physical_assets
     WHERE asset_code LIKE $1 OR asset_code LIKE $2 OR asset_code LIKE $3`,
    assetFilter,
  );
  return assets.rowCount ?? 0;
}

/**
 * Removes namespace-scoped artifacts for one deterministic scenario key.
 * Does not touch clients or operational rows outside the scenario namespace.
 */
export async function compensateSyntheticScenario(
  client: DbClient,
  scenarioKey: string,
): Promise<SyntheticScenarioCompensationResult> {
  // A Pool does not pin successive query() calls to one connection.
  // Use one dedicated client so BEGIN, deletes and ROLLBACK are atomic.
  const connection = client instanceof Pool ? await client.connect() : client;
  let evictWith: Error | undefined;
  try {
    await connection.query('BEGIN');
    const externalRef = syntheticExternalRef(scenarioKey);
      const clientRow = await connection.query<{ id: string }>(
        `SELECT id FROM pty.clients WHERE external_erp_id = $1 LIMIT 1`,
        [externalRef],
      );
      const clientId = clientRow.rows[0]?.id;
      let clientRemoved = false;
      if (clientId) {
        await deleteClientGraph(connection, clientId);
        clientRemoved = true;
      }
      const catalogArtifactsRemoved = await deleteScenarioCatalogArtifacts(connection, scenarioKey);
      const assetsRemoved = await deleteScenarioAssets(connection, scenarioKey);
      await connection.query('COMMIT');
      return {
        scenarioKey,
        clientRemoved,
        catalogArtifactsRemoved,
        assetsRemoved,
      };
  } catch (error) {
    // Preserve the original transaction failure even if rollback also fails;
    // evict a potentially broken connection instead of returning it to the pool.
    try {
      await connection.query('ROLLBACK');
    } catch (rollbackError) {
      evictWith = rollbackError instanceof Error
        ? rollbackError
        : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    if (client instanceof Pool) {
      connection.release(evictWith);
    }
  }
}

export async function findSyntheticNamespaceClientId(
  client: DbClient,
  scenarioKey: string,
): Promise<string | null> {
  const externalRef = syntheticExternalRef(scenarioKey);
  const result = await client.query<{ id: string }>(
    `SELECT id FROM pty.clients WHERE external_erp_id = $1 LIMIT 1`,
    [externalRef],
  );
  return result.rows[0]?.id ?? null;
}

/** Clients in namespace without external ref are not compensated here. */
export function isSyntheticNamespaceExternalRef(externalErpId: string | null | undefined): boolean {
  return typeof externalErpId === 'string' && externalErpId.startsWith(`${SYNTHETIC_SEED_NAMESPACE}:`);
}

export function isSyntheticDisplayName(legalName: string | null | undefined): boolean {
  return typeof legalName === 'string' && legalName.startsWith(SYNTHETIC_SEED_DISPLAY_PREFIX);
}

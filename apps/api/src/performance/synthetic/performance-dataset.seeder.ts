import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  hashPassword,
  insertGrant,
  insertScopeRef,
  truncateBillingTables,
  truncateClientTables,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import type { PerformanceDatasetConfig } from '../config/performance-dataset.config';
import { syntheticInternalCode, syntheticTaxId } from './synthetic-identifiers';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import { AUTH_TEST_PASSWORD } from '../../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../../auth/crypto/token-crypto';

export type SeededPerformanceDataset = {
  identityId: string;
  login: string;
  password: string;
  unitId: string;
  clientIds: string[];
  serviceOrderIds: string[];
  releasedServiceOrderIds: string[];
  preparedServiceOrderId: string;
  sampleMeasurementServiceOrderId: string;
  sampleBillingServiceOrderId: string;
};

const PERF_RESOURCE_TYPE_BY_PREFIX: Array<{ prefix: string; resourceType: string }> = [
  { prefix: 'client:', resourceType: AUTHZ_RESOURCE_TYPES.Client },
  { prefix: 'supplier:', resourceType: AUTHZ_RESOURCE_TYPES.Supplier },
  { prefix: 'procurement:', resourceType: AUTHZ_RESOURCE_TYPES.Procurement },
  { prefix: 'catalog:', resourceType: AUTHZ_RESOURCE_TYPES.CatalogService },
  { prefix: 'resources:', resourceType: AUTHZ_RESOURCE_TYPES.ResourcesAsset },
  { prefix: 'documents:', resourceType: AUTHZ_RESOURCE_TYPES.DocumentsDocument },
  { prefix: 'commercial:proposal', resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal },
  { prefix: 'commercial:purchase-order', resourceType: AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder },
  { prefix: 'requests:', resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest },
  { prefix: 'service-orders:', resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
  { prefix: 'measurements:', resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
  { prefix: 'billing:', resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
  { prefix: 'reports:', resourceType: AUTHZ_RESOURCE_TYPES.Platform },
  { prefix: 'search:', resourceType: AUTHZ_RESOURCE_TYPES.Platform },
  { prefix: 'dashboard:', resourceType: AUTHZ_RESOURCE_TYPES.Platform },
  { prefix: 'analytics:', resourceType: AUTHZ_RESOURCE_TYPES.Platform },
  { prefix: 'alerts:', resourceType: AUTHZ_RESOURCE_TYPES.Platform },
  { prefix: 'authz:', resourceType: AUTHZ_RESOURCE_TYPES.Platform },
  { prefix: 'platform:', resourceType: AUTHZ_RESOURCE_TYPES.Platform },
];

function resolveResourceType(action: string): string {
  const match = PERF_RESOURCE_TYPE_BY_PREFIX.find((entry) => action.startsWith(entry.prefix));
  return match?.resourceType ?? AUTHZ_RESOURCE_TYPES.Platform;
}

async function grantPerformanceActor(pool: Pool, identityId: string): Promise<void> {
  for (const action of Object.values(AUTHZ_ACTIONS)) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: resolveResourceType(action),
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

export async function seedPerformanceDataset(
  pool: Pool,
  config: PerformanceDatasetConfig,
): Promise<SeededPerformanceDataset> {
  await truncateBillingTables(pool);
  await pool.query('DELETE FROM msr.measurement_command_idempotency');
  await pool.query('DELETE FROM msr.measurement_history_events');
  await pool.query('DELETE FROM msr.measurement_adjustments');
  await pool.query('DELETE FROM msr.measurement_items');
  await pool.query('DELETE FROM msr.measurements');
  await truncateServiceOrderTables(pool);
  await truncateDocumentTables(pool);
  await truncateClientTables(pool);
  await truncateIdentityAndAuthorizationTables(pool);

  const identityId = randomUUID();
  const credentialId = randomUUID();
  const login = normalizeLoginIdentifier(`perf-${config.profile}-${randomUUID().slice(0, 8)}@cisne.invalid`);
  const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);

  await pool.query(`INSERT INTO identity.identities (id, status) VALUES ($1, 'active')`, [identityId]);
  await pool.query(
    `INSERT INTO identity.credentials (id, identity_id, login_identifier_normalized, password_hash)
     VALUES ($1, $2, $3, $4)`,
    [credentialId, identityId, login, passwordHash],
  );
  await insertScopeRef(pool, { scopeType: 'UNIT', refId: config.unitId });
  await grantPerformanceActor(pool, identityId);

  const clientIds: string[] = [];
  for (let index = 0; index < config.volumes.clients; index += 1) {
    const clientId = randomUUID();
    clientIds.push(clientId);
    await pool.query(
      `INSERT INTO pty.clients (id, legal_name, normalized_tax_id, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [clientId, `Synthetic Client ${index + 1}`, syntheticTaxId(10_000 + index)],
    );
    await insertScopeRef(pool, { scopeType: 'CLIENT', refId: clientId });
  }

  const serviceOrderIds: string[] = [];
  const releasedServiceOrderIds: string[] = [];
  let preparedServiceOrderId = '';

  const statuses = ['DRAFT', 'PREPARED', 'RELEASED', 'IN_EXECUTION', 'COMPLETED'] as const;
  for (let index = 0; index < config.volumes.serviceOrders; index += 1) {
    const serviceOrderId = randomUUID();
    const clientId = clientIds[index % clientIds.length]!;
    const status = statuses[index % statuses.length]!;
    const internalCode = syntheticInternalCode('SO', index);
    const orderNumber = syntheticInternalCode('ORD', index);

    await pool.query(
      `INSERT INTO so.service_orders (
         id, internal_code, order_number, unit_id, status, origin,
         client_id, description, created_by_identity_id, updated_by_identity_id,
         released_at, started_at, completed_at
       )
       VALUES (
         $1, $2, $3, $4, $5::so.service_order_status, 'AUTHORIZED_DIRECT',
         $6, $7, $8, $8,
         CASE WHEN $5 IN ('RELEASED', 'IN_EXECUTION', 'COMPLETED', 'PAUSED') THEN NOW() ELSE NULL END,
         CASE WHEN $5 IN ('IN_EXECUTION', 'COMPLETED', 'PAUSED') THEN NOW() ELSE NULL END,
         CASE WHEN $5 = 'COMPLETED' THEN NOW() ELSE NULL END
       )`,
      [
        serviceOrderId,
        internalCode,
        orderNumber,
        config.unitId,
        status,
        clientId,
        `Synthetic service order ${index + 1}`,
        identityId,
      ],
    );

    serviceOrderIds.push(serviceOrderId);
    if (status === 'RELEASED' || status === 'IN_EXECUTION') {
      releasedServiceOrderIds.push(serviceOrderId);
    }
    if (!preparedServiceOrderId && status === 'PREPARED') {
      preparedServiceOrderId = serviceOrderId;
    }
  }

  if (!preparedServiceOrderId && serviceOrderIds[0]) {
    preparedServiceOrderId = serviceOrderIds[0];
  }

  const entryBatchSize = 500;
  let entryIndex = 0;
  const executionEntryIds: string[] = [];
  while (entryIndex < config.volumes.executionEntries) {
    const batch = Math.min(entryBatchSize, config.volumes.executionEntries - entryIndex);
    const values: string[] = [];
    const params: unknown[] = [];
    for (let offset = 0; offset < batch; offset += 1) {
      const entryId = randomUUID();
      executionEntryIds.push(entryId);
      const serviceOrderId = serviceOrderIds[(entryIndex + offset) % serviceOrderIds.length]!;
      const base = params.length;
      params.push(entryId, serviceOrderId, identityId, entryIndex + offset + 1);
      values.push(
        `($${base + 1}, $${base + 2}, 'QUANTITY'::so.execution_entry_type, $${base + 3}, $${base + 4}, 'H', NOW())`,
      );
    }
    await pool.query(
      `INSERT INTO so.execution_entries (
         id, service_order_id, entry_type, actor_identity_id, quantity_value, quantity_unit_code, recorded_at
       )
       VALUES ${values.join(', ')}`,
      params,
    );
    entryIndex += batch;
  }

  for (let index = 0; index < config.volumes.documents; index += 1) {
    const documentId = randomUUID();
    const storedObjectId = randomUUID();
    await pool.query(
      `INSERT INTO doc.stored_objects (
         id, storage_key, sha256_hash, mime_type, byte_size, original_filename
       )
       VALUES ($1, $2, $3, 'application/pdf', 1024, $4)`,
      [
        storedObjectId,
        `perf/objects/${documentId}`,
        'a'.repeat(64),
        `perf-doc-${index + 1}.pdf`,
      ],
    );
    await pool.query(
      `INSERT INTO doc.documents (
         id, title, category_code, unit_id, current_version_number,
         created_by_identity_id, updated_by_identity_id
       )
       VALUES ($1, $2, 'CONTRACT', $3, 1, $4, $4)`,
      [documentId, `Synthetic Document ${index + 1}`, config.unitId, identityId],
    );
    await pool.query(
      `INSERT INTO doc.document_versions (
         id, document_id, version_number, stored_object_id, uploaded_by_identity_id
       )
       VALUES ($1, $2, 1, $3, $4)`,
      [randomUUID(), documentId, storedObjectId, identityId],
    );
  }

  const measurementServiceOrders = serviceOrderIds.slice(0, config.volumes.measurements);
  const measurementIds: string[] = [];
  for (let index = 0; index < measurementServiceOrders.length; index += 1) {
    const measurementId = randomUUID();
    const serviceOrderId = measurementServiceOrders[index]!;
    const executionEntryId = executionEntryIds[index % executionEntryIds.length]!;
    measurementIds.push(measurementId);
    await pool.query(
      `INSERT INTO msr.measurements (
         id, service_order_id, unit_id, status, created_by_identity_id, updated_by_identity_id
       )
       VALUES ($1, $2, $3, 'APPROVED', $4, $4)`,
      [measurementId, serviceOrderId, config.unitId, identityId],
    );
    await pool.query(
      `INSERT INTO msr.measurement_items (
         id, measurement_id, line_number, source_execution_entry_id, unit_code, actual_quantity, measured_quantity
       )
       VALUES ($1, $2, 1, $3, 'H', 1, 1)`,
      [randomUUID(), measurementId, executionEntryId],
    );
  }

  for (let index = 0; index < Math.min(config.volumes.billingRecords, measurementIds.length); index += 1) {
    const measurementId = measurementIds[index]!;
    const serviceOrderId = measurementServiceOrders[index]!;
    const clientId = clientIds[index % clientIds.length]!;
    await pool.query(
      `INSERT INTO bil.billing_records (
         id, service_order_id, measurement_id, client_id, unit_id,
         client_legal_name_snapshot, payment_terms, payment_terms_source,
         total_amount, prepared_by_identity_id, created_by_identity_id, updated_by_identity_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'NET30', 'DECLARED', 100.0000, $7, $7, $7)`,
      [
        randomUUID(),
        serviceOrderId,
        measurementId,
        clientId,
        config.unitId,
        `Synthetic Client ${index + 1}`,
        identityId,
      ],
    );
  }

  return {
    identityId,
    login,
    password: AUTH_TEST_PASSWORD,
    unitId: config.unitId,
    clientIds,
    serviceOrderIds,
    releasedServiceOrderIds,
    preparedServiceOrderId,
    sampleMeasurementServiceOrderId: measurementServiceOrders[0] ?? serviceOrderIds[0] ?? '',
    sampleBillingServiceOrderId: measurementServiceOrders[0] ?? serviceOrderIds[0] ?? '',
  };
}

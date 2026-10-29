import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  findStoredCommandIdempotency,
  storeCommandIdempotency,
} from '../../infrastructure/database/command-idempotency';
import { classifyRowVersion, isOptimisticVersionConflict } from '../../infrastructure/database/optimistic-lock';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import { OutboxDomainEventWriter } from '../../platform/outbox/services/outbox-domain-event.writer';
import {
  consumePurchaseOrderBalanceForBilling,
  releasePurchaseOrderBalanceForBillingVoid,
} from '../../commercial/application/purchase-order-billing-consumption';
import {
  findMeasurementForBilling,
  listMeasurementItemsForBilling,
  lockMeasurementForBilling,
} from '../../measurements/application/measurement-billing';
import { BILLING_COMMANDS, BILLING_HISTORY_EVENTS } from '../domain/billing';
import type {
  BillingCommandIdempotencyRow,
  BillingHistoryEventRow,
  BillingItemRow,
  BillingRecordRow,
  ClientAddressRow,
  ClientBillingSnapshotRow,
  MeasurementForBillingRow,
  MeasurementItemForBillingRow,
  PrepareBillingPersistenceInput,
  PrepareBillingPersistenceResult,
  PurchaseOrderTermsRow,
  VoidBillingPersistenceInput,
  VoidBillingPersistenceResult,
} from './billing.repository.types';

export type BillingWorklistQuery = {
  scopeClause: string;
  scopeParams: unknown[];
  documentScopeClause: string;
  documentScopeParams: unknown[];
  bucket?: string;
  search?: string;
  limit: number;
  offset: number;
};

export type BillingWorklistRow = {
  service_order_id: string;
  order_number: string;
  client_label: string | null;
  origin: string;
  service_order_status: string;
  service_order_version: number;
  service_order_completed_at: string | null;
  measurement_id: string | null;
  measurement_status: string | null;
  measurement_version: number | null;
  billing_record_id: string | null;
  billing_status: string | null;
  billing_version: number | null;
  amount: string | null;
  currency_code: string | null;
  bucket: string;
  exception_code: string | null;
  exception_detail: string | null;
  authoritative_terms: string | null;
  declared_terms: string | null;
  billing_document_id: string | null;
  billing_document_number: string | null;
  billing_document_status: string | null;
  billing_document_issued_at: string | null;
  can_read_document: boolean;
  receivable_id: string | null;
  receivable_unit_id: string | null;
  receivable_client_id: string | null;
  updated_at: string;
};

export type BillingWorklistCurrencySummary = {
  currencyCode: string;
  knownAmount: string | null;
  knownAmountCount: number;
  unknownAmountCount: number;
};

export type BillingWorklistSummary = {
  total: number;
  counts: Record<string, number>;
  amountsByCurrency: BillingWorklistCurrencySummary[];
};

const BILLING_COMMAND_IDEMPOTENCY_RETURNING = `
  id, billing_record_id, service_order_id, command_name, idempotency_key, response_payload, created_at
`;

const BILLING_RECORD_RETURNING = `
  id, service_order_id, measurement_id, entitlement_policy, client_id, unit_id, status::text AS status,
  proposal_id, purchase_order_id, contract_reference,
  client_legal_name_snapshot, client_tax_id_snapshot, billing_address_snapshot,
  commercial_reference_snapshot, currency_code, payment_terms,
  payment_terms_source::text AS payment_terms_source, payment_terms_authoritative,
  total_amount::text AS total_amount, prepared_at, prepared_by_identity_id,
  voided_at, voided_by_identity_id, void_reason, row_version,
  created_at, updated_at, created_by_identity_id, updated_by_identity_id
`;

const BILLING_ITEM_RETURNING = `
  id, billing_record_id, line_number, measurement_item_id, source_execution_entry_id,
  unit_code, quantity::text AS quantity, unit_price::text AS unit_price,
  line_amount::text AS line_amount, pricing_line_snapshot, line_label, created_at
`;

const CONTRACTUAL_AMOUNT_SQL = `CASE
  WHEN COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') = 'PERIODIC'
    THEN COALESCE(so.service_snapshot->>'periodicAmount', so.proposal_snapshot->>'periodicAmount', so.purchase_order_snapshot->>'periodicAmount')
  WHEN COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') = 'MILESTONE'
    THEN COALESCE(so.service_snapshot->>'milestoneAmount', so.proposal_snapshot->>'milestoneAmount', so.purchase_order_snapshot->>'milestoneAmount')
  ELSE COALESCE(so.proposal_snapshot->>'globalSalePrice', so.purchase_order_snapshot->>'totalAmount')
END`;

@Injectable()
export class BillingRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly outboxWriter: OutboxDomainEventWriter,
    @Optional() @Inject(FAULT_INJECTION_PORT) private readonly faultInjection?: FaultInjectionPort,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(billingRecordId: string): Promise<BillingRecordRow | null> {
    const result = await this.pool().query<BillingRecordRow>(
      `SELECT ${BILLING_RECORD_RETURNING} FROM bil.billing_records WHERE id = $1`,
      [billingRecordId],
    );
    return result.rows[0] ?? null;
  }

  async listWorklist(query: BillingWorklistQuery): Promise<{
    items: BillingWorklistRow[];
    summary: BillingWorklistSummary;
  }> {
    const params = [...query.scopeParams];
    const documentScopeOffset = params.length;
    const documentScopeClause = query.documentScopeClause.replace(
      /\$(\d+)/g,
      (_match, index: string) => `$${Number(index) + documentScopeOffset}`,
    );
    params.push(...query.documentScopeParams);
    const filters: string[] = [query.scopeClause];
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      filters.push(`(so.order_number ILIKE $${params.length} OR COALESCE(so.client_snapshot->>'tradeName', so.client_snapshot->>'legalName', br.client_legal_name_snapshot) ILIKE $${params.length})`);
    }
    const filterSql = filters.join(' AND ');
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;
    params.push(query.limit, query.offset);
    const bucketClause = query.bucket
      ? query.bucket === 'issued'
        ? `WHERE billing_document_status = 'FINALIZED'`
        : `WHERE bucket = $${params.length + 1}`
      : '';
    if (query.bucket && query.bucket !== 'issued') params.push(query.bucket);

    const result = await this.pool().query<{
      items: BillingWorklistRow[];
      total: string;
      counts: Record<string, string>;
      amounts_by_currency: Array<{ currencyCode: string; knownAmount: string | null; knownAmountCount: string; unknownAmountCount: string }>;
    }>(
      `WITH base AS MATERIALIZED (
         SELECT so.id AS service_order_id, so.order_number, so.client_snapshot, so.origin::text AS origin,
                so.status::text AS service_order_status, so.row_version AS service_order_version,
                so.completed_at AS service_order_completed_at, so.updated_at,
                COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') AS entitlement_policy,
                m.id AS measurement_id, m.status::text AS measurement_status, m.row_version AS measurement_version,
                br.id AS billing_record_id, br.status::text AS billing_status, br.row_version AS billing_version,
                CASE
                   WHEN br.id IS NOT NULL THEN br.currency_code
                   WHEN m.status = 'APPROVED'
                     AND item_totals.currency_count = 1
                     AND item_totals.invalid_currency_count = 0
                     AND (NULLIF(UPPER(TRIM(m.commercial_reference_snapshot->>'currencyCode')), '') IS NULL
                       OR UPPER(TRIM(m.commercial_reference_snapshot->>'currencyCode')) = item_totals.currency_code)
                     THEN item_totals.currency_code
                   WHEN COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') <> 'MEASUREMENT_APPROVED'
                     THEN COALESCE(NULLIF(so.proposal_snapshot->>'currencyCode', ''),
                                   NULLIF(so.purchase_order_snapshot->>'currencyCode', ''), 'BRL')
                   ELSE NULL
                 END AS currency_code,
                CASE WHEN br.status = 'PREPARED' THEN br.total_amount::text
                     WHEN m.status = 'APPROVED' AND item_totals.item_count > 0
                       AND item_totals.priced_count = item_totals.item_count THEN item_totals.amount::text
                     WHEN COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') <> 'MEASUREMENT_APPROVED'
                       AND (${CONTRACTUAL_AMOUNT_SQL}) ~ '^[0-9]+(\\.[0-9]{1,4})?$' THEN (${CONTRACTUAL_AMOUNT_SQL})
                     ELSE NULL END AS amount,
                COALESCE(NULLIF(trim(br.payment_terms_authoritative), ''),
                         NULLIF(trim(so.purchase_order_snapshot->>'paymentTerms'), ''),
                         NULLIF(trim(so.proposal_snapshot->>'paymentTerms'), ''),
                         NULLIF(trim(so.contract_snapshot->>'paymentTerms'), '')) AS authoritative_terms,
                br.payment_terms AS declared_terms,
                doc.id AS billing_document_id, doc.document_number AS billing_document_number,
                doc.status::text AS billing_document_status, doc.issued_at AS billing_document_issued_at,
                rec.id AS receivable_id, rec.unit_id AS receivable_unit_id, rec.client_id::text AS receivable_client_id,
                (${documentScopeClause}) AS can_read_document,
                CASE
                  WHEN doc.status = 'CANCELLED' THEN 'cancelled_document'
                  WHEN br.status = 'PREPARED' AND br.payment_terms_authoritative IS NOT NULL
                    AND lower(regexp_replace(trim(br.payment_terms), '\\s+', ' ', 'g')) <> lower(regexp_replace(trim(br.payment_terms_authoritative), '\\s+', ' ', 'g')) THEN 'terms_divergence'
                  WHEN br.status = 'PREPARED' AND NOT (${documentScopeClause}) THEN 'document_state_unknown'
                  WHEN doc.status = 'FINALIZED' THEN 'issued'
                  WHEN br.status = 'PREPARED' THEN 'prepared'
                  WHEN m.status = 'APPROVED' AND (item_totals.item_count = 0 OR item_totals.priced_count <> item_totals.item_count) THEN 'billing_basis_missing'
                  WHEN m.status = 'APPROVED' THEN 'ready'
                  WHEN COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') <> 'MEASUREMENT_APPROVED'
                    AND (${CONTRACTUAL_AMOUNT_SQL}) ~ '^[0-9]+(\\.[0-9]{1,4})?$' THEN 'ready'
                  WHEN COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') <> 'MEASUREMENT_APPROVED' THEN 'billing_basis_missing'
                  ELSE 'measurement_pending'
                END AS bucket,
                CASE
                  WHEN doc.status = 'CANCELLED' THEN 'BILLING_DOCUMENT_CANCELLED'
                  WHEN br.status = 'PREPARED' AND br.payment_terms_authoritative IS NOT NULL
                    AND lower(regexp_replace(trim(br.payment_terms), '\\s+', ' ', 'g')) <> lower(regexp_replace(trim(br.payment_terms_authoritative), '\\s+', ' ', 'g')) THEN 'COMMERCIAL_TERMS_DIVERGE'
                  WHEN COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') <> 'MEASUREMENT_APPROVED'
                    AND (${CONTRACTUAL_AMOUNT_SQL}) !~ '^[0-9]+(\\.[0-9]{1,4})?$' THEN 'BILLING_BASIS_MISSING'
                  WHEN m.status = 'APPROVED' AND (item_totals.item_count = 0 OR item_totals.priced_count <> item_totals.item_count) THEN 'BILLING_BASIS_MISSING'
                  WHEN m.id IS NULL AND br.status IS DISTINCT FROM 'PREPARED'
                    AND COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') = 'MEASUREMENT_APPROVED' THEN 'MEASUREMENT_MISSING'
                  WHEN m.status <> 'APPROVED' AND br.status IS DISTINCT FROM 'PREPARED'
                    AND COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') = 'MEASUREMENT_APPROVED' THEN 'MEASUREMENT_NOT_APPROVED'
                  ELSE NULL
                END AS exception_code,
                CASE
                  WHEN doc.status = 'CANCELLED' THEN COALESCE(doc.cancel_reason, 'Documento interno cancelado')
                  WHEN COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') <> 'MEASUREMENT_APPROVED'
                    AND (${CONTRACTUAL_AMOUNT_SQL}) !~ '^[0-9]+(\\.[0-9]{1,4})?$' THEN 'O snapshot comercial não contém uma base de faturamento válida para esta política.'
                  WHEN m.status = 'APPROVED' AND (item_totals.item_count = 0 OR item_totals.priced_count <> item_totals.item_count) THEN 'A medição aprovada não possui valores apuráveis em todos os itens.'
                  WHEN m.id IS NULL AND br.status IS DISTINCT FROM 'PREPARED'
                    AND COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') = 'MEASUREMENT_APPROVED' THEN 'A ordem concluída ainda não possui medição.'
                  WHEN m.status <> 'APPROVED' AND br.status IS DISTINCT FROM 'PREPARED'
                    AND COALESCE(so.service_snapshot->>'billingEntitlementPolicy', 'MEASUREMENT_APPROVED') = 'MEASUREMENT_APPROVED' THEN 'Medição em ' || m.status::text || '; aprovação necessária para preparar faturamento.'
                  WHEN br.status = 'PREPARED' AND br.payment_terms_authoritative IS NOT NULL
                    AND lower(regexp_replace(trim(br.payment_terms), '\\s+', ' ', 'g')) <> lower(regexp_replace(trim(br.payment_terms_authoritative), '\\s+', ' ', 'g')) THEN 'Condição informada diverge da condição comercial de origem.'
                  ELSE NULL
                END AS exception_detail,
                COALESCE(NULLIF(so.client_snapshot->>'tradeName', ''), NULLIF(so.client_snapshot->>'legalName', ''), br.client_legal_name_snapshot) AS client_label
         FROM so.service_orders so
         LEFT JOIN LATERAL (
           SELECT m0.* FROM msr.measurements m0
           WHERE m0.service_order_id = so.id ORDER BY m0.updated_at DESC, m0.id DESC LIMIT 1
         ) m ON TRUE
         LEFT JOIN LATERAL (
           SELECT br0.* FROM bil.billing_records br0
           WHERE br0.service_order_id = so.id ORDER BY br0.created_at DESC, br0.id DESC LIMIT 1
         ) br ON TRUE
         LEFT JOIN LATERAL (
           SELECT count(*) AS item_count, count(mi.line_amount) AS priced_count, sum(mi.line_amount) AS amount,
                  count(DISTINCT NULLIF(UPPER(TRIM(mi.pricing_line_snapshot->>'currencyCode')), '')) AS currency_count,
                  count(*) FILTER (WHERE NULLIF(UPPER(TRIM(mi.pricing_line_snapshot->>'currencyCode')), '') IS NULL
                     OR UPPER(TRIM(mi.pricing_line_snapshot->>'currencyCode')) !~ '^[A-Z]{3}
           FROM msr.measurement_items mi WHERE mi.measurement_id = m.id
         ) item_totals ON TRUE
         LEFT JOIN LATERAL (
           SELECT bd0.* FROM bil.billing_documents bd0
           WHERE bd0.billing_record_id = br.id AND (${documentScopeClause})
           ORDER BY bd0.version_number DESC, bd0.id DESC LIMIT 1
         ) doc ON TRUE
         LEFT JOIN LATERAL (
           SELECT r.id, r.unit_id, r.client_id FROM rpt.read_receivables r WHERE r.origin_billing_document_id = doc.id LIMIT 1
         ) rec ON TRUE
         WHERE so.status = 'COMPLETED' AND (${filterSql})
       ), filtered AS MATERIALIZED (
         SELECT * FROM base ${bucketClause}
       ), page AS (
         SELECT * FROM filtered ORDER BY
           CASE bucket WHEN 'cancelled_document' THEN 0 WHEN 'terms_divergence' THEN 1 WHEN 'measurement_pending' THEN 2 WHEN 'billing_basis_missing' THEN 2 WHEN 'document_state_unknown' THEN 2 WHEN 'ready' THEN 3 ELSE 4 END,
           updated_at ASC, service_order_id ASC
         LIMIT $${limitIndex} OFFSET $${offsetIndex}
       ), summary AS (
         SELECT count(*)::text AS total,
                jsonb_build_object(
                  'cancelled_document', count(*) FILTER (WHERE bucket = 'cancelled_document'),
                  'document_state_unknown', count(*) FILTER (WHERE bucket = 'document_state_unknown'),
                  'terms_divergence', count(*) FILTER (WHERE bucket = 'terms_divergence'),
                  'measurement_pending', count(*) FILTER (WHERE bucket = 'measurement_pending'),
                  'billing_basis_missing', count(*) FILTER (WHERE bucket = 'billing_basis_missing'),
                  'ready', count(*) FILTER (WHERE bucket = 'ready'),
                  'prepared', count(*) FILTER (WHERE bucket = 'prepared'),
                  'issued', count(*) FILTER (WHERE bucket = 'issued')
                ) AS counts
         FROM filtered
       ), currency_summary AS (
         SELECT currency_code AS "currencyCode",
                CASE WHEN count(amount) = 0 THEN NULL ELSE sum(amount::numeric)::text END AS "knownAmount",
                count(amount)::text AS "knownAmountCount",
                count(*) FILTER (WHERE amount IS NULL)::text AS "unknownAmountCount"
         FROM filtered WHERE currency_code IS NOT NULL GROUP BY currency_code ORDER BY currency_code
       )
       SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page)) FROM page), '[]'::jsonb) AS items,
              summary.total, summary.counts,
              COALESCE((SELECT jsonb_agg(to_jsonb(currency_summary)) FROM currency_summary), '[]'::jsonb) AS amounts_by_currency
       FROM summary`,
      params,
    );
    const row = result.rows[0];
    return {
      items: row?.items ?? [],
      summary: {
        total: Number(row?.total ?? 0),
        counts: Object.fromEntries(Object.entries(row?.counts ?? {}).map(([key, value]) => [key, Number(value)])),
        amountsByCurrency: (row?.amounts_by_currency ?? []).map((entry) => ({
          currencyCode: entry.currencyCode,
          knownAmount: entry.knownAmount,
          knownAmountCount: Number(entry.knownAmountCount),
          unknownAmountCount: Number(entry.unknownAmountCount),
        })),
      },
    };
  }

  async findPreparedByMeasurementId(measurementId: string): Promise<BillingRecordRow | null> {
    const result = await this.pool().query<BillingRecordRow>(
      `SELECT ${BILLING_RECORD_RETURNING}
       FROM bil.billing_records
       WHERE measurement_id = $1 AND status = 'PREPARED'
       LIMIT 1`,
      [measurementId],
    );
    return result.rows[0] ?? null;
  }

  async findByServiceOrderId(serviceOrderId: string): Promise<BillingRecordRow | null> {
    const result = await this.pool().query<BillingRecordRow>(
      `SELECT ${BILLING_RECORD_RETURNING}
       FROM bil.billing_records
       WHERE service_order_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  async listItems(billingRecordId: string): Promise<BillingItemRow[]> {
    const result = await this.pool().query<BillingItemRow>(
      `SELECT ${BILLING_ITEM_RETURNING}
       FROM bil.billing_items
       WHERE billing_record_id = $1
       ORDER BY line_number ASC`,
      [billingRecordId],
    );
    return result.rows;
  }

  async listHistoryEvents(billingRecordId: string): Promise<BillingHistoryEventRow[]> {
    const result = await this.pool().query<BillingHistoryEventRow>(
      `SELECT id, billing_record_id, event_type, payload, actor_identity_id, occurred_at
       FROM bil.billing_history_events
       WHERE billing_record_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [billingRecordId],
    );
    return result.rows;
  }

  async findMeasurementForBilling(
    measurementId: string,
    serviceOrderId: string,
  ): Promise<MeasurementForBillingRow | null> {
    return findMeasurementForBilling(this.pool(), measurementId, serviceOrderId);
  }

  async listMeasurementItemsForBilling(measurementId: string): Promise<MeasurementItemForBillingRow[]> {
    return listMeasurementItemsForBilling(this.pool(), measurementId);
  }

  async findClientBillingSnapshot(clientId: string): Promise<ClientBillingSnapshotRow | null> {
    const result = await this.pool().query<ClientBillingSnapshotRow>(
      `SELECT id, legal_name, normalized_tax_id AS tax_id
       FROM rpt.read_clients
       WHERE id = $1`,
      [clientId],
    );
    return result.rows[0] ?? null;
  }

  async listClientAddresses(clientId: string): Promise<ClientAddressRow[]> {
    const result = await this.pool().query<ClientAddressRow>(
      `SELECT purpose::text AS purpose, street, number, complement, district, city, state, postal_code, country
       FROM rpt.read_client_addresses
       WHERE client_id = $1
       ORDER BY CASE purpose::text WHEN 'billing' THEN 0 WHEN 'correspondence' THEN 1 ELSE 2 END`,
      [clientId],
    );
    return result.rows;
  }

  async findPurchaseOrderTerms(purchaseOrderId: string): Promise<PurchaseOrderTermsRow | null> {
    const result = await this.pool().query<PurchaseOrderTermsRow>(
      `SELECT id, payment_terms
       FROM rpt.read_purchase_orders
       WHERE id = $1`,
      [purchaseOrderId],
    );
    return result.rows[0] ?? null;
  }

  private async findBillingCommandIdempotency(
    client: PoolClient,
    serviceOrderId: string,
    commandName: string,
    idempotencyKey: string,
  ): Promise<BillingCommandIdempotencyRow | null> {
    return findStoredCommandIdempotency<BillingCommandIdempotencyRow>(client, {
      tableFqn: 'bil.billing_command_idempotency',
      scopeColumn: 'service_order_id',
      scopeValue: serviceOrderId,
      commandName,
      idempotencyKey,
      returning: BILLING_COMMAND_IDEMPOTENCY_RETURNING,
    });
  }

  async prepareBillingRecord(input: PrepareBillingPersistenceInput): Promise<PrepareBillingPersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const lockedMeasurement = input.measurementId
        ? await lockMeasurementForBilling(client, input.measurementId)
        : null;

      if (input.idempotencyKey) {
        const cached = await this.findBillingCommandIdempotency(
          client,
          input.serviceOrderId,
          BILLING_COMMANDS.Prepare,
          input.idempotencyKey,
        );
        if (cached?.billing_record_id) {
          const billingRecord = await this.findByIdWithClient(client, cached.billing_record_id);
          if (billingRecord) {
            await client.query('COMMIT');
            return { outcome: 'idempotent', billingRecord };
          }
        }
      }

      // A replay of the same committed command is returned above. A NEW
      // prepare cannot use item prices captured before another measurement
      // command changed approval, quantities, commercial value or version.
      if (input.measurementId && (
        !lockedMeasurement ||
        lockedMeasurement.status !== 'APPROVED' ||
        lockedMeasurement.row_version !== input.measurementVersion
      )) {
        await client.query('ROLLBACK');
        return { outcome: 'measurement_changed' };
      }

      const existing = input.measurementId
        ? await client.query(
            `SELECT id FROM bil.billing_records
             WHERE measurement_id = $1 AND status = 'PREPARED'
             LIMIT 1`,
            [input.measurementId],
          )
        : await client.query(
            `SELECT id FROM bil.billing_records
             WHERE service_order_id = $1 AND status = 'PREPARED'
             LIMIT 1`,
            [input.serviceOrderId],
          );
      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'already_exists' };
      }

      const inserted = await client.query<BillingRecordRow>(
        `INSERT INTO bil.billing_records (
           service_order_id, measurement_id, entitlement_policy, client_id, unit_id, status,
           proposal_id, purchase_order_id, contract_reference,
           client_legal_name_snapshot, client_tax_id_snapshot, billing_address_snapshot,
           commercial_reference_snapshot, currency_code, payment_terms,
           payment_terms_source, payment_terms_authoritative, total_amount,
           prepared_by_identity_id, created_by_identity_id, updated_by_identity_id
         ) VALUES (
           $1, $2, $3, $4, $5, 'PREPARED',
           $6, $7, $8,
           $9, $10, $11::jsonb,
           $12::jsonb, $13, $14,
           $15::bil.payment_terms_source, $16, $17,
           $18, $18, $18
         )
         RETURNING ${BILLING_RECORD_RETURNING}`,
        [
          input.serviceOrderId,
          input.measurementId,
          input.entitlementPolicy,
          input.clientId,
          input.unitId,
          input.proposalId,
          input.purchaseOrderId,
          input.contractReference,
          input.clientLegalNameSnapshot,
          input.clientTaxIdSnapshot,
          JSON.stringify(input.billingAddressSnapshot),
          JSON.stringify(input.commercialReferenceSnapshot),
          input.currencyCode,
          input.paymentTerms,
          input.paymentTermsSource,
          input.paymentTermsAuthoritative,
          input.totalAmount,
          input.actorIdentityId,
        ],
      );
      const billingRecord = inserted.rows[0]!;

      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.BillingPrepareAfterHeaderBeforeItems);
      for (const item of input.items) {
        await client.query(
          `INSERT INTO bil.billing_items (
             billing_record_id, line_number, measurement_item_id, source_execution_entry_id,
             unit_code, quantity, unit_price, line_amount, pricing_line_snapshot, line_label
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
          [
            billingRecord.id,
            item.lineNumber,
            item.measurementItemId,
            item.sourceExecutionEntryId,
            item.unitCode,
            item.quantity,
            item.unitPrice,
            item.lineAmount,
            JSON.stringify(item.pricingLineSnapshot),
            item.lineLabel,
          ],
        );
      }

      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.BillingPrepareAfterItemsBeforeHistory);
      await client.query(
        `INSERT INTO bil.billing_history_events (billing_record_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          billingRecord.id,
          BILLING_HISTORY_EVENTS.Prepared,
          JSON.stringify({ measurementId: input.measurementId, totalAmount: input.totalAmount, entitlementPolicy: input.entitlementPolicy }),
          input.actorIdentityId,
        ],
      );

      if (input.idempotencyKey) {
        await storeCommandIdempotency(client, {
          tableFqn: 'bil.billing_command_idempotency',
          columns: {
            billing_record_id: billingRecord.id,
            service_order_id: input.serviceOrderId,
            command_name: BILLING_COMMANDS.Prepare,
            idempotency_key: input.idempotencyKey,
            response_payload: { billingRecordId: billingRecord.id },
          },
          jsonPayloadColumns: ['response_payload'],
        });
      }

      await this.outboxWriter.appendBillingReady(client, {
        billingRecordId: billingRecord.id,
        serviceOrderId: input.serviceOrderId,
        measurementId: input.measurementId,
        unitId: input.unitId,
        totalAmount: input.totalAmount,
        preparedAt: billingRecord.prepared_at,
      });

      if (input.purchaseOrderId) {
        await consumePurchaseOrderBalanceForBilling(client, {
          purchaseOrderId: input.purchaseOrderId,
          billingRecordId: billingRecord.id,
          amount: input.totalAmount,
          actorIdentityId: input.actorIdentityId,
        });
      }

      await client.query('COMMIT');
      return { outcome: 'created', billingRecord };
    } catch (error) {
      await client.query('ROLLBACK');
      if (this.isPreparedBillingUniqueViolation(error)) {
        return { outcome: 'already_exists' };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async voidBillingRecord(input: VoidBillingPersistenceInput): Promise<VoidBillingPersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const locked = await client.query<BillingRecordRow>(
        `SELECT ${BILLING_RECORD_RETURNING}
         FROM bil.billing_records
         WHERE id = $1
         FOR UPDATE`,
        [input.billingRecordId],
      );
      const current = locked.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }

      if (input.idempotencyKey) {
        const cached = await this.findBillingCommandIdempotency(
          client,
          current.service_order_id,
          BILLING_COMMANDS.Void,
          input.idempotencyKey,
        );
        if (cached?.billing_record_id === input.billingRecordId) {
          const replay = await this.findByIdWithClient(client, cached.billing_record_id);
          if (replay?.status === 'VOIDED') {
            await client.query('COMMIT');
            return { outcome: 'idempotent', billingRecord: replay };
          }
        }
      }

      if (current.status !== 'PREPARED') {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }
      if (isOptimisticVersionConflict(classifyRowVersion(current, input.rowVersion))) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }

      const updated = await client.query<BillingRecordRow>(
        `UPDATE bil.billing_records
         SET status = 'VOIDED',
             voided_at = NOW(),
             voided_by_identity_id = $2,
             void_reason = $3,
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $2
         WHERE id = $1 AND row_version = $4
         RETURNING ${BILLING_RECORD_RETURNING}`,
        [input.billingRecordId, input.actorIdentityId, input.voidReason, input.rowVersion],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }

      await client.query(
        `INSERT INTO bil.billing_history_events (billing_record_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          input.billingRecordId,
          BILLING_HISTORY_EVENTS.Voided,
          JSON.stringify({ voidReason: input.voidReason }),
          input.actorIdentityId,
        ],
      );

      if (current.purchase_order_id && current.total_amount) {
        await releasePurchaseOrderBalanceForBillingVoid(client, {
          purchaseOrderId: current.purchase_order_id,
          billingRecordId: current.id,
          amount: current.total_amount,
          actorIdentityId: input.actorIdentityId,
        });
      }

      if (input.idempotencyKey) {
        await storeCommandIdempotency(client, {
          tableFqn: 'bil.billing_command_idempotency',
          columns: {
            billing_record_id: input.billingRecordId,
            service_order_id: current.service_order_id,
            command_name: BILLING_COMMANDS.Void,
            idempotency_key: input.idempotencyKey,
            response_payload: { billingRecordId: input.billingRecordId },
          },
          jsonPayloadColumns: ['response_payload'],
        });
      }

      await client.query('COMMIT');
      return { outcome: 'voided', billingRecord: updated.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async findByIdWithClient(
    client: PoolClient,
    billingRecordId: string,
  ): Promise<BillingRecordRow | null> {
    const result = await client.query<BillingRecordRow>(
      `SELECT ${BILLING_RECORD_RETURNING} FROM bil.billing_records WHERE id = $1`,
      [billingRecordId],
    );
    return result.rows[0] ?? null;
  }

  private isPreparedBillingUniqueViolation(error: unknown): boolean {
    const pgError = error as { code?: string; constraint?: string };
    return (
      pgError.code === '23505' &&
      (pgError.constraint?.includes('billing_records_measurement_prepared') ?? false) ||
        (pgError.constraint?.includes('billing_records_service_order_prepared') ?? false)
    );
  }
}
) AS invalid_currency_count,
                  max(NULLIF(UPPER(TRIM(mi.pricing_line_snapshot->>'currencyCode')), '')) AS currency_code
           FROM msr.measurement_items mi WHERE mi.measurement_id = m.id
         ) item_totals ON TRUE
         LEFT JOIN LATERAL (
           SELECT bd0.* FROM bil.billing_documents bd0
           WHERE bd0.billing_record_id = br.id AND (${documentScopeClause})
           ORDER BY bd0.version_number DESC, bd0.id DESC LIMIT 1
         ) doc ON TRUE
         LEFT JOIN LATERAL (
           SELECT r.id, r.unit_id, r.client_id FROM rpt.read_receivables r WHERE r.origin_billing_document_id = doc.id LIMIT 1
         ) rec ON TRUE
         WHERE so.status = 'COMPLETED' AND (${filterSql})
       ), filtered AS MATERIALIZED (
         SELECT * FROM base ${bucketClause}
       ), page AS (
         SELECT * FROM filtered ORDER BY
           CASE bucket WHEN 'cancelled_document' THEN 0 WHEN 'terms_divergence' THEN 1 WHEN 'measurement_pending' THEN 2 WHEN 'billing_basis_missing' THEN 2 WHEN 'document_state_unknown' THEN 2 WHEN 'ready' THEN 3 ELSE 4 END,
           updated_at ASC, service_order_id ASC
         LIMIT $${limitIndex} OFFSET $${offsetIndex}
       ), summary AS (
         SELECT count(*)::text AS total,
                jsonb_build_object(
                  'cancelled_document', count(*) FILTER (WHERE bucket = 'cancelled_document'),
                  'document_state_unknown', count(*) FILTER (WHERE bucket = 'document_state_unknown'),
                  'terms_divergence', count(*) FILTER (WHERE bucket = 'terms_divergence'),
                  'measurement_pending', count(*) FILTER (WHERE bucket = 'measurement_pending'),
                  'billing_basis_missing', count(*) FILTER (WHERE bucket = 'billing_basis_missing'),
                  'ready', count(*) FILTER (WHERE bucket = 'ready'),
                  'prepared', count(*) FILTER (WHERE bucket = 'prepared'),
                  'issued', count(*) FILTER (WHERE bucket = 'issued')
                ) AS counts
         FROM filtered
       ), currency_summary AS (
         SELECT currency_code AS "currencyCode",
                CASE WHEN count(amount) = 0 THEN NULL ELSE sum(amount::numeric)::text END AS "knownAmount",
                count(amount)::text AS "knownAmountCount",
                count(*) FILTER (WHERE amount IS NULL)::text AS "unknownAmountCount"
         FROM filtered WHERE currency_code IS NOT NULL GROUP BY currency_code ORDER BY currency_code
       )
       SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page)) FROM page), '[]'::jsonb) AS items,
              summary.total, summary.counts,
              COALESCE((SELECT jsonb_agg(to_jsonb(currency_summary)) FROM currency_summary), '[]'::jsonb) AS amounts_by_currency
       FROM summary`,
      params,
    );
    const row = result.rows[0];
    return {
      items: row?.items ?? [],
      summary: {
        total: Number(row?.total ?? 0),
        counts: Object.fromEntries(Object.entries(row?.counts ?? {}).map(([key, value]) => [key, Number(value)])),
        amountsByCurrency: (row?.amounts_by_currency ?? []).map((entry) => ({
          currencyCode: entry.currencyCode,
          knownAmount: entry.knownAmount,
          knownAmountCount: Number(entry.knownAmountCount),
          unknownAmountCount: Number(entry.unknownAmountCount),
        })),
      },
    };
  }

  async findPreparedByMeasurementId(measurementId: string): Promise<BillingRecordRow | null> {
    const result = await this.pool().query<BillingRecordRow>(
      `SELECT ${BILLING_RECORD_RETURNING}
       FROM bil.billing_records
       WHERE measurement_id = $1 AND status = 'PREPARED'
       LIMIT 1`,
      [measurementId],
    );
    return result.rows[0] ?? null;
  }

  async findByServiceOrderId(serviceOrderId: string): Promise<BillingRecordRow | null> {
    const result = await this.pool().query<BillingRecordRow>(
      `SELECT ${BILLING_RECORD_RETURNING}
       FROM bil.billing_records
       WHERE service_order_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  async listItems(billingRecordId: string): Promise<BillingItemRow[]> {
    const result = await this.pool().query<BillingItemRow>(
      `SELECT ${BILLING_ITEM_RETURNING}
       FROM bil.billing_items
       WHERE billing_record_id = $1
       ORDER BY line_number ASC`,
      [billingRecordId],
    );
    return result.rows;
  }

  async listHistoryEvents(billingRecordId: string): Promise<BillingHistoryEventRow[]> {
    const result = await this.pool().query<BillingHistoryEventRow>(
      `SELECT id, billing_record_id, event_type, payload, actor_identity_id, occurred_at
       FROM bil.billing_history_events
       WHERE billing_record_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [billingRecordId],
    );
    return result.rows;
  }

  async findMeasurementForBilling(
    measurementId: string,
    serviceOrderId: string,
  ): Promise<MeasurementForBillingRow | null> {
    return findMeasurementForBilling(this.pool(), measurementId, serviceOrderId);
  }

  async listMeasurementItemsForBilling(measurementId: string): Promise<MeasurementItemForBillingRow[]> {
    return listMeasurementItemsForBilling(this.pool(), measurementId);
  }

  async findClientBillingSnapshot(clientId: string): Promise<ClientBillingSnapshotRow | null> {
    const result = await this.pool().query<ClientBillingSnapshotRow>(
      `SELECT id, legal_name, normalized_tax_id AS tax_id
       FROM rpt.read_clients
       WHERE id = $1`,
      [clientId],
    );
    return result.rows[0] ?? null;
  }

  async listClientAddresses(clientId: string): Promise<ClientAddressRow[]> {
    const result = await this.pool().query<ClientAddressRow>(
      `SELECT purpose::text AS purpose, street, number, complement, district, city, state, postal_code, country
       FROM rpt.read_client_addresses
       WHERE client_id = $1
       ORDER BY CASE purpose::text WHEN 'billing' THEN 0 WHEN 'correspondence' THEN 1 ELSE 2 END`,
      [clientId],
    );
    return result.rows;
  }

  async findPurchaseOrderTerms(purchaseOrderId: string): Promise<PurchaseOrderTermsRow | null> {
    const result = await this.pool().query<PurchaseOrderTermsRow>(
      `SELECT id, payment_terms
       FROM rpt.read_purchase_orders
       WHERE id = $1`,
      [purchaseOrderId],
    );
    return result.rows[0] ?? null;
  }

  private async findBillingCommandIdempotency(
    client: PoolClient,
    serviceOrderId: string,
    commandName: string,
    idempotencyKey: string,
  ): Promise<BillingCommandIdempotencyRow | null> {
    return findStoredCommandIdempotency<BillingCommandIdempotencyRow>(client, {
      tableFqn: 'bil.billing_command_idempotency',
      scopeColumn: 'service_order_id',
      scopeValue: serviceOrderId,
      commandName,
      idempotencyKey,
      returning: BILLING_COMMAND_IDEMPOTENCY_RETURNING,
    });
  }

  async prepareBillingRecord(input: PrepareBillingPersistenceInput): Promise<PrepareBillingPersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const lockedMeasurement = input.measurementId
        ? await lockMeasurementForBilling(client, input.measurementId)
        : null;

      if (input.idempotencyKey) {
        const cached = await this.findBillingCommandIdempotency(
          client,
          input.serviceOrderId,
          BILLING_COMMANDS.Prepare,
          input.idempotencyKey,
        );
        if (cached?.billing_record_id) {
          const billingRecord = await this.findByIdWithClient(client, cached.billing_record_id);
          if (billingRecord) {
            await client.query('COMMIT');
            return { outcome: 'idempotent', billingRecord };
          }
        }
      }

      // A replay of the same committed command is returned above. A NEW
      // prepare cannot use item prices captured before another measurement
      // command changed approval, quantities, commercial value or version.
      if (input.measurementId && (
        !lockedMeasurement ||
        lockedMeasurement.status !== 'APPROVED' ||
        lockedMeasurement.row_version !== input.measurementVersion
      )) {
        await client.query('ROLLBACK');
        return { outcome: 'measurement_changed' };
      }

      const existing = input.measurementId
        ? await client.query(
            `SELECT id FROM bil.billing_records
             WHERE measurement_id = $1 AND status = 'PREPARED'
             LIMIT 1`,
            [input.measurementId],
          )
        : await client.query(
            `SELECT id FROM bil.billing_records
             WHERE service_order_id = $1 AND status = 'PREPARED'
             LIMIT 1`,
            [input.serviceOrderId],
          );
      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'already_exists' };
      }

      const inserted = await client.query<BillingRecordRow>(
        `INSERT INTO bil.billing_records (
           service_order_id, measurement_id, entitlement_policy, client_id, unit_id, status,
           proposal_id, purchase_order_id, contract_reference,
           client_legal_name_snapshot, client_tax_id_snapshot, billing_address_snapshot,
           commercial_reference_snapshot, currency_code, payment_terms,
           payment_terms_source, payment_terms_authoritative, total_amount,
           prepared_by_identity_id, created_by_identity_id, updated_by_identity_id
         ) VALUES (
           $1, $2, $3, $4, $5, 'PREPARED',
           $6, $7, $8,
           $9, $10, $11::jsonb,
           $12::jsonb, $13, $14,
           $15::bil.payment_terms_source, $16, $17,
           $18, $18, $18
         )
         RETURNING ${BILLING_RECORD_RETURNING}`,
        [
          input.serviceOrderId,
          input.measurementId,
          input.entitlementPolicy,
          input.clientId,
          input.unitId,
          input.proposalId,
          input.purchaseOrderId,
          input.contractReference,
          input.clientLegalNameSnapshot,
          input.clientTaxIdSnapshot,
          JSON.stringify(input.billingAddressSnapshot),
          JSON.stringify(input.commercialReferenceSnapshot),
          input.currencyCode,
          input.paymentTerms,
          input.paymentTermsSource,
          input.paymentTermsAuthoritative,
          input.totalAmount,
          input.actorIdentityId,
        ],
      );
      const billingRecord = inserted.rows[0]!;

      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.BillingPrepareAfterHeaderBeforeItems);
      for (const item of input.items) {
        await client.query(
          `INSERT INTO bil.billing_items (
             billing_record_id, line_number, measurement_item_id, source_execution_entry_id,
             unit_code, quantity, unit_price, line_amount, pricing_line_snapshot, line_label
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
          [
            billingRecord.id,
            item.lineNumber,
            item.measurementItemId,
            item.sourceExecutionEntryId,
            item.unitCode,
            item.quantity,
            item.unitPrice,
            item.lineAmount,
            JSON.stringify(item.pricingLineSnapshot),
            item.lineLabel,
          ],
        );
      }

      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.BillingPrepareAfterItemsBeforeHistory);
      await client.query(
        `INSERT INTO bil.billing_history_events (billing_record_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          billingRecord.id,
          BILLING_HISTORY_EVENTS.Prepared,
          JSON.stringify({ measurementId: input.measurementId, totalAmount: input.totalAmount, entitlementPolicy: input.entitlementPolicy }),
          input.actorIdentityId,
        ],
      );

      if (input.idempotencyKey) {
        await storeCommandIdempotency(client, {
          tableFqn: 'bil.billing_command_idempotency',
          columns: {
            billing_record_id: billingRecord.id,
            service_order_id: input.serviceOrderId,
            command_name: BILLING_COMMANDS.Prepare,
            idempotency_key: input.idempotencyKey,
            response_payload: { billingRecordId: billingRecord.id },
          },
          jsonPayloadColumns: ['response_payload'],
        });
      }

      await this.outboxWriter.appendBillingReady(client, {
        billingRecordId: billingRecord.id,
        serviceOrderId: input.serviceOrderId,
        measurementId: input.measurementId,
        unitId: input.unitId,
        totalAmount: input.totalAmount,
        preparedAt: billingRecord.prepared_at,
      });

      if (input.purchaseOrderId) {
        await consumePurchaseOrderBalanceForBilling(client, {
          purchaseOrderId: input.purchaseOrderId,
          billingRecordId: billingRecord.id,
          amount: input.totalAmount,
          actorIdentityId: input.actorIdentityId,
        });
      }

      await client.query('COMMIT');
      return { outcome: 'created', billingRecord };
    } catch (error) {
      await client.query('ROLLBACK');
      if (this.isPreparedBillingUniqueViolation(error)) {
        return { outcome: 'already_exists' };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async voidBillingRecord(input: VoidBillingPersistenceInput): Promise<VoidBillingPersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const locked = await client.query<BillingRecordRow>(
        `SELECT ${BILLING_RECORD_RETURNING}
         FROM bil.billing_records
         WHERE id = $1
         FOR UPDATE`,
        [input.billingRecordId],
      );
      const current = locked.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }

      if (input.idempotencyKey) {
        const cached = await this.findBillingCommandIdempotency(
          client,
          current.service_order_id,
          BILLING_COMMANDS.Void,
          input.idempotencyKey,
        );
        if (cached?.billing_record_id === input.billingRecordId) {
          const replay = await this.findByIdWithClient(client, cached.billing_record_id);
          if (replay?.status === 'VOIDED') {
            await client.query('COMMIT');
            return { outcome: 'idempotent', billingRecord: replay };
          }
        }
      }

      if (current.status !== 'PREPARED') {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }
      if (isOptimisticVersionConflict(classifyRowVersion(current, input.rowVersion))) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }

      const updated = await client.query<BillingRecordRow>(
        `UPDATE bil.billing_records
         SET status = 'VOIDED',
             voided_at = NOW(),
             voided_by_identity_id = $2,
             void_reason = $3,
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $2
         WHERE id = $1 AND row_version = $4
         RETURNING ${BILLING_RECORD_RETURNING}`,
        [input.billingRecordId, input.actorIdentityId, input.voidReason, input.rowVersion],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }

      await client.query(
        `INSERT INTO bil.billing_history_events (billing_record_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          input.billingRecordId,
          BILLING_HISTORY_EVENTS.Voided,
          JSON.stringify({ voidReason: input.voidReason }),
          input.actorIdentityId,
        ],
      );

      if (current.purchase_order_id && current.total_amount) {
        await releasePurchaseOrderBalanceForBillingVoid(client, {
          purchaseOrderId: current.purchase_order_id,
          billingRecordId: current.id,
          amount: current.total_amount,
          actorIdentityId: input.actorIdentityId,
        });
      }

      if (input.idempotencyKey) {
        await storeCommandIdempotency(client, {
          tableFqn: 'bil.billing_command_idempotency',
          columns: {
            billing_record_id: input.billingRecordId,
            service_order_id: current.service_order_id,
            command_name: BILLING_COMMANDS.Void,
            idempotency_key: input.idempotencyKey,
            response_payload: { billingRecordId: input.billingRecordId },
          },
          jsonPayloadColumns: ['response_payload'],
        });
      }

      await client.query('COMMIT');
      return { outcome: 'voided', billingRecord: updated.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async findByIdWithClient(
    client: PoolClient,
    billingRecordId: string,
  ): Promise<BillingRecordRow | null> {
    const result = await client.query<BillingRecordRow>(
      `SELECT ${BILLING_RECORD_RETURNING} FROM bil.billing_records WHERE id = $1`,
      [billingRecordId],
    );
    return result.rows[0] ?? null;
  }

  private isPreparedBillingUniqueViolation(error: unknown): boolean {
    const pgError = error as { code?: string; constraint?: string };
    return (
      pgError.code === '23505' &&
      (pgError.constraint?.includes('billing_records_measurement_prepared') ?? false) ||
        (pgError.constraint?.includes('billing_records_service_order_prepared') ?? false)
    );
  }
}

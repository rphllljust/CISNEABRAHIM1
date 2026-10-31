import {
  createIntegrationTestPool,
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertCatalogCategory,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateBillingTables,
  truncateCatalogTables,
  truncateClientTables,
  truncateCommercialPurchaseOrderTables,
  truncateCommercialProposalTables,
  truncateDocumentTables,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
  truncatePhysicalAssetTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { ensureTestDefaultIssuer } from '../test/ensure-test-issuer';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { CatalogModule } from '../catalog/catalog.module';
import { ServiceCatalogAccessService } from '../catalog/services/service-catalog-access.service';
import { ClientsModule } from '../clients/clients.module';
import { ADDRESS_PURPOSES, CONTACT_PURPOSES } from '../clients/domain/client-status';
import { ClientAccessService } from '../clients/services/client-access.service';
import { CommercialModule } from '../commercial/commercial.module';
import { PURCHASE_ORDER_PRICING_STRUCTURES, PURCHASE_ORDER_RULE_TYPES, type PurchaseOrderRuleType } from '../commercial/domain/purchase-order';
import { PurchaseOrdersAccessService } from '../commercial/services/purchase-orders-access.service';
import { DocumentsModule } from '../documents/documents.module';
import { ObjectStorageService } from '../documents/storage/object-storage.service';
import { BillingModule } from '../billing/billing.module';
import { BILLING_DOCUMENT_STATUSES } from '../billing/domain/billing-document';
import { FinanceModule } from '../finance/finance.module';
import { BillingDocumentRepository } from './repositories/billing-document.repository';
import { BillingReceivableHandoffJobHandler } from './jobs/billing-receivable-handoff.handler';
import { BackgroundJobsRepository } from '../platform/background-jobs/repositories/background-jobs.repository';
import { BACKGROUND_JOB_KINDS, BACKGROUND_JOB_STATUSES } from '../platform/background-jobs/domain/background-job-kind';
import { ReceivablesAccessService } from '../finance/services/receivables-access.service';
import { BILLING_ERROR_CODES } from '../billing/errors/billing-error-codes';
import { BillingAccessService } from '../billing/services/billing-access.service';
import { BillingDocumentAccessService } from '../billing/services/billing-document-access.service';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MeasurementsAccessService } from '../measurements/services/measurements-access.service';
import { ResourcesModule } from '../resources/resources.module';
import { SERVICE_ORDER_ORIGINS } from '../service-orders/domain/service-order';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { ServiceOrderExecutionAccessService } from '../service-orders/services/service-order-execution-access.service';
import { ServiceOrdersAccessService } from '../service-orders/services/service-orders-access.service';

const UNIT_A = 'unit-bil-doc-a';
const TEST_CNPJ = '11222333000181';
const ALT_TEST_CNPJ = '19131243000197';
let clientTaxIdCounter = 0;

const SAMPLE_EXECUTION_REQUIREMENTS = [
  { requirementType: 'OBSERVATION' as const, requirementLevel: 'REQUIRED' as const },
  { requirementType: 'QUANTITY' as const, requirementLevel: 'REQUIRED' as const },
];

async function grantBillingDocumentAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan,
    AUTHZ_ACTIONS.ServiceOrdersPlannedResourceRead,
    AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
    AUTHZ_ACTIONS.ServiceOrdersExecutionStart,
    AUTHZ_ACTIONS.ServiceOrdersExecutionComplete,
    AUTHZ_ACTIONS.ServiceOrdersExecutionRecord,
    AUTHZ_ACTIONS.MeasurementsMeasurementCreate,
    AUTHZ_ACTIONS.MeasurementsMeasurementRead,
    AUTHZ_ACTIONS.MeasurementsMeasurementUpdate,
    AUTHZ_ACTIONS.MeasurementsMeasurementSubmit,
    AUTHZ_ACTIONS.MeasurementsMeasurementReview,
    AUTHZ_ACTIONS.MeasurementsMeasurementApprove,
    AUTHZ_ACTIONS.MeasurementsMeasurementReject,
    AUTHZ_ACTIONS.BillingBillingRecordPrepare,
    AUTHZ_ACTIONS.BillingBillingRecordRead,
    AUTHZ_ACTIONS.BillingBillingRecordVoid,
    AUTHZ_ACTIONS.BillingBillingDocumentIssue,
    AUTHZ_ACTIONS.BillingBillingDocumentRead,
    AUTHZ_ACTIONS.BillingBillingDocumentCancel,
    AUTHZ_ACTIONS.BillingBillingDocumentReplace,
    AUTHZ_ACTIONS.BillingBillingDocumentDownload,
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServicePublish,
    AUTHZ_ACTIONS.CommercialPurchaseOrderCreate,
    AUTHZ_ACTIONS.CommercialPurchaseOrderRead,
    AUTHZ_ACTIONS.CommercialPurchaseOrderRegister,
  ];

  for (const action of actions) {
    const resourceType = action.startsWith('client:')
      ? AUTHZ_RESOURCE_TYPES.Client
      : action.startsWith('catalog:')
        ? AUTHZ_RESOURCE_TYPES.CatalogService
        : action.startsWith('commercial:')
          ? AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder
          : AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;

    await insertGrant(pool, {
      identityId,
      action,
      resourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Billing document PostgreSQL integration', () => {
  let pool: Pool;
  let billingAccess: BillingAccessService;
  let billingDocumentAccess: BillingDocumentAccessService;
  let receivablesAccess: ReceivablesAccessService;
  let billingDocumentsRepository: BillingDocumentRepository;
  let jobsRepository: BackgroundJobsRepository;
  let measurementsAccess: MeasurementsAccessService;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let executionAccess: ServiceOrderExecutionAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  let purchaseOrdersAccess: PurchaseOrdersAccessService;
  let objectStorage: ObjectStorageService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for billing document integration tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);
    process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-test';
    process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        AuthModule,
        AuditModule,
        AuthorizationModule,
        ClientsModule,
        CatalogModule,
        CommercialModule,
        DocumentsModule,
        ResourcesModule,
        ServiceOrdersModule,
        MeasurementsModule,
        BillingModule,
        FinanceModule,
      ],
    }).compile();

    billingAccess = module.get(BillingAccessService);
    billingDocumentAccess = module.get(BillingDocumentAccessService);
    receivablesAccess = module.get(ReceivablesAccessService);
    billingDocumentsRepository = module.get(BillingDocumentRepository);
    jobsRepository = module.get(BackgroundJobsRepository);
    measurementsAccess = module.get(MeasurementsAccessService);
    serviceOrdersAccess = module.get(ServiceOrdersAccessService);
    executionAccess = module.get(ServiceOrderExecutionAccessService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    purchaseOrdersAccess = module.get(PurchaseOrdersAccessService);
    objectStorage = module.get(ObjectStorageService);
    pool = createIntegrationTestPool(testDatabaseUrl);
  });

  beforeEach(async () => {
    clientTaxIdCounter = 0;
    await pool.query('TRUNCATE TABLE plt.background_jobs RESTART IDENTITY CASCADE');
    await truncateFinanceTables(pool);
    await truncateDocumentTables(pool);
    await truncateBillingTables(pool);
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateCommercialProposalTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await ensureTestDefaultIssuer(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor() {
    const login = normalizeLoginIdentifier(`bil-doc-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantBillingDocumentAdmin(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedPreparedBilling(
    actor: { identityId: string; sessionId: string },
    poNumber?: string,
    options?: {
      billingRules?: Array<{ ruleType: PurchaseOrderRuleType; ruleConfig?: Record<string, unknown> }>;
    },
  ) {
    const taxId = clientTaxIdCounter++ % 2 === 0 ? TEST_CNPJ : ALT_TEST_CNPJ;
    const client = await clientAccess.create(actor, {
      legalName: `Cliente Doc ${crypto.randomUUID()}`,
      tradeName: 'Cliente Doc',
      taxId,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
      addresses: [
        {
          purpose: ADDRESS_PURPOSES.Billing,
          street: 'Rua Faturamento',
          number: '100',
          city: 'Porto Velho',
          state: 'RO',
          postalCode: '76800000',
          country: 'BR',
        },
      ],
    });

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, { code: `CAT-${suffix}`, name: 'Serviços' });
    const draft = await catalogAccess.create(actor, {
      code: `DOC-SRV-${suffix}`,
      name: 'Serviço documento',
      categoryId: category.categoryId,
      archetype: 'CIVIL_WORK',
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '1000.0000', internalCost: '800.0000' }],
      resourceRequirements: [],
      laborRequirements: [],
      executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    const published = await catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);

    let purchaseOrderId: string | undefined;
    if (poNumber) {
      const purchaseOrder = await purchaseOrdersAccess.create(actor, {
        clientId: client.id,
        unitId: UNIT_A,
        poNumber,
        pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
        paymentTerms: '30 DDL',
        billingRules: options?.billingRules,
        items: [
          {
            lineNumber: 1,
            description: 'Serviço PO',
            serviceDefinitionId: published.serviceDefinitionId,
            serviceDefinitionVersionId: published.id,
            quantity: '1.0000',
            unitCode: 'SERVICE',
            unitPrice: '1000.0000',
            lineTotal: '1000.0000',
          },
        ],
      });
      const registered = await purchaseOrdersAccess.register(actor, purchaseOrder.purchaseOrder.id, {
        rowVersion: purchaseOrder.purchaseOrder.rowVersion,
      });
      purchaseOrderId = registered.purchaseOrder.id;
    }

    const created = await serviceOrdersAccess.create(actor, {
      origin: purchaseOrderId ? SERVICE_ORDER_ORIGINS.PurchaseOrder : SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      purchaseOrderId,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, { rowVersion: created.rowVersion });
    const released = await serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion });
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'Execução concluída.',
    });
    const afterObservation = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, afterObservation.id, {
      rowVersion: afterObservation.rowVersion,
      quantityValue: '1',
      unitCode: 'SERVICE',
    });
    const afterQuantity = await serviceOrdersAccess.getById(actor, started.id);
    const completed = await executionAccess.complete(actor, afterQuantity.id, {
      rowVersion: afterQuantity.rowVersion,
    });
    const measurement = await measurementsAccess.create(actor, completed.id);
    const submitted = await measurementsAccess.submit(actor, completed.id, measurement.id, {
      rowVersion: measurement.rowVersion,
    });
    const reviewed = await measurementsAccess.startReview(actor, completed.id, measurement.id, {
      rowVersion: submitted.rowVersion,
    });
    const login = normalizeLoginIdentifier(`bil-doc-rev-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: reviewerId } = await insertIdentity(pool, login, passwordHash);
    await grantBillingDocumentAdmin(pool, reviewerId, actor.identityId);
    const reviewer = { identityId: reviewerId, sessionId: 'sid-rev' };
    const approved = await measurementsAccess.approve(reviewer, completed.id, measurement.id, {
      rowVersion: reviewed.rowVersion,
    });
    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });
    return { client, completed, billing, poNumber };
  }

  it('issues NOTA FATURA with snapshots, amount and PO reference', async () => {
    const { actor } = await seedActor();
    const { completed, billing, client, poNumber } = await seedPreparedBilling(actor, `PO-DOC-${crypto.randomUUID().slice(0, 8)}`);

    const document = await billingDocumentAccess.issue(actor, completed.id, billing.id, {
      dueDate: '2026-09-30',
    });

    expect(document.status).toBe(BILLING_DOCUMENT_STATUSES.Finalized);
    expect(document.documentCategory).toBe('NOTA_FATURA');
    expect(document.totalAmount).toBe('1000.0000');
    expect(document.clientLegalNameSnapshot).toBe(client.legalName);
    expect(document.purchaseOrderNumberSnapshot).toBe(poNumber);
    expect(document.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(document.items).toHaveLength(1);
    expect(document.items[0]?.lineAmount).toBe('1000.0000');
  });


  it('MASTER 001-03: issues approved measurement billing into exactly one persisted receivable', async () => {
    const { actor } = await seedActor();
    const { completed, billing, client } = await seedPreparedBilling(actor);
    const idempotencyKey = `master-001-03-${crypto.randomUUID()}`;
    const dueDate = '2026-12-20';

    const document = await billingDocumentAccess.issue(actor, completed.id, billing.id, {
      idempotencyKey,
      dueDate,
    });
    expect(document.status).toBe(BILLING_DOCUMENT_STATUSES.Finalized);

    const receivables = await pool.query<{
      id: string;
      origin_billing_document_id: string;
      origin_billing_record_id: string;
      origin_service_order_id: string;
      origin_measurement_id: string;
      client_id: string;
      unit_id: string;
      principal: string;
      currency_code: string;
      lifecycle: string;
    }>(
      `SELECT id, origin_billing_document_id, origin_billing_record_id, origin_service_order_id,
              origin_measurement_id, client_id, unit_id, principal::text AS principal,
              currency_code, lifecycle
         FROM fin.receivables WHERE origin_billing_document_id = $1`,
      [document.id],
    );

    expect(receivables.rows).toHaveLength(1);
    const receivable = receivables.rows[0]!;
    expect(receivable.origin_billing_record_id).toBe(billing.id);
    expect(receivable.origin_service_order_id).toBe(completed.id);
    expect(receivable.origin_measurement_id).toBe(billing.measurementId);
    expect(receivable.client_id).toBe(client.id);
    expect(receivable.unit_id).toBe(UNIT_A);
    expect(receivable.currency_code).toBe(document.currencyCode);
    expect(Number(receivable.principal)).toBe(Number(document.totalAmount));
    expect(receivable.lifecycle).toBe('ACTIVE');

    // Idempotent retry must not duplicate document, receivable or financial principal.
    const replay = await billingDocumentAccess.issue(actor, completed.id, billing.id, {
      idempotencyKey,
      dueDate,
    });
    expect(replay.id).toBe(document.id);
    const afterRetry = await pool.query<{ total: string; principal: string }>(
      `SELECT COUNT(*)::text AS total, COALESCE(SUM(principal), 0)::text AS principal
         FROM fin.receivables WHERE origin_billing_record_id = $1`,
      [billing.id],
    );
    expect(afterRetry.rows[0]?.total).toBe('1');
    expect(Number(afterRetry.rows[0]?.principal)).toBe(Number(billing.totalAmount));
  });


  it('MASTER 001-03: an idempotent replay repairs a finalized document after Finance handoff failure', async () => {
    const { actor } = await seedActor();
    const { completed, billing } = await seedPreparedBilling(actor);
    const idempotencyKey = `master-001-03-recovery-${crypto.randomUUID()}`;

    // Inject the failure AFTER Billing commits its FINALIZED document, at the
    // published Finance port boundary. This does not alter production logic.
    const failedHandoff = vi
      .spyOn(receivablesAccess, 'openFromBilling')
      .mockRejectedValueOnce(new Error('SIMULATED_FINANCE_HANDOFF_UNAVAILABLE'));

    try {
      await expect(
        billingDocumentAccess.issue(actor, completed.id, billing.id, {
          idempotencyKey,
          dueDate: '2026-12-20',
        }),
      ).rejects.toBeTruthy();
    } finally {
      failedHandoff.mockRestore();
    }

    const persisted = await pool.query<{
      id: string;
      status: string;
      artifact_sha256: string;
    }>(
      `SELECT id, status::text AS status, artifact_sha256
         FROM bil.billing_documents WHERE billing_record_id = $1`,
      [billing.id],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]?.status).toBe('FINALIZED');
    expect(persisted.rows[0]?.artifact_sha256).toMatch(/^[a-f0-9]{64}$/);

    const beforeRecovery = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fin.receivables
         WHERE origin_billing_document_id = $1`,
      [persisted.rows[0]!.id],
    );
    expect(beforeRecovery.rows[0]?.count).toBe('0');

    // The same command and idempotency key must reuse the committed document
    // and complete the missing finance handoff exactly once.
    const recovered = await billingDocumentAccess.issue(actor, completed.id, billing.id, {
      idempotencyKey,
      dueDate: '2026-12-20',
    });
    expect(recovered.id).toBe(persisted.rows[0]?.id);
    expect(recovered.artifactSha256).toBe(persisted.rows[0]?.artifact_sha256);

    const again = await billingDocumentAccess.issue(actor, completed.id, billing.id, {
      idempotencyKey,
      dueDate: '2026-12-20',
    });
    expect(again.id).toBe(recovered.id);

    const repaired = await pool.query<{ count: string; total: string }>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(principal), 0)::text AS total
         FROM fin.receivables WHERE origin_billing_document_id = $1`,
      [recovered.id],
    );
    expect(repaired.rows[0]?.count).toBe('1');
    expect(Number(repaired.rows[0]?.total)).toBe(Number(billing.totalAmount));

    const pdf = await billingDocumentAccess.downloadPdf(
      actor, completed.id, billing.id, recovered.id,
    );
    expect(pdf.sha256).toBe(recovered.artifactSha256);
  });


  it('MASTER 001-03: worker recovers a committed billing document with no HTTP replay', async () => {
    const { actor } = await seedActor();
    const { completed, billing } = await seedPreparedBilling(actor);
    const key = `auto-recovery-${crypto.randomUUID()}`;
    const spy = vi.spyOn(receivablesAccess, 'openFromBilling')
      .mockRejectedValueOnce(new Error('SIMULATED_AFTER_DOCUMENT_COMMIT'));
    try {
      await expect(billingDocumentAccess.issue(actor, completed.id, billing.id, {
        idempotencyKey: key,
        dueDate: '2026-12-20',
      })).rejects.toBeTruthy();
    } finally {
      spy.mockRestore();
    }

    const documents = await pool.query<{ id: string; status: string }>(
      `SELECT id, status::text AS status FROM bil.billing_documents WHERE billing_record_id = $1`,
      [billing.id],
    );
    expect(documents.rows).toHaveLength(1);
    expect(documents.rows[0]?.status).toBe('FINALIZED');
    const billingDocumentId = documents.rows[0]!.id;
    const pending = await jobsRepository.findByIdempotencyKey(
      `billing-document:${billingDocumentId}:receivable-handoff`,
    );
    expect(pending?.status).toBe(BACKGROUND_JOB_STATUSES.Pending);
    expect(pending?.job_kind).toBe(BACKGROUND_JOB_KINDS.BillingReceivableHandoff);

    const handler = new BillingReceivableHandoffJobHandler(
      billingDocumentsRepository, receivablesAccess,
    );
    const context = {
      jobId: pending!.id,
      jobKind: BACKGROUND_JOB_KINDS.BillingReceivableHandoff,
      payload: pending!.payload,
      attemptCount: 1,
      correlationId: billingDocumentId,
      signal: new AbortController().signal,
    };
    await handler.handle(context);
    await handler.handle(context); // concurrent/at-least-once redelivery must be safe.

    const receivables = await pool.query<{ count: string; principal: string }>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(principal), 0)::text AS principal
         FROM fin.receivables WHERE origin_billing_document_id = $1`,
      [billingDocumentId],
    );
    expect(receivables.rows[0]?.count).toBe('1');
    expect(Number(receivables.rows[0]?.principal)).toBe(Number(billing.totalAmount));

    // The ordinary cancel path must not be resurrected by a delayed recovery.
    const issued = await billingDocumentAccess.getById(
      actor, completed.id, billing.id, billingDocumentId,
    );
    await billingDocumentAccess.cancel(actor, completed.id, billing.id, billingDocumentId, {
      rowVersion: issued.rowVersion,
      cancelReason: 'cancel after handoff',
    });
    await handler.handle(context);
    const status = await pool.query<{ lifecycle: string }>(
      `SELECT lifecycle::text AS lifecycle FROM fin.receivables
         WHERE origin_billing_document_id = $1`,
      [billingDocumentId],
    );
    expect(status.rows[0]?.lifecycle).toBe('CANCELLED');
  });

  it('MASTER 001-03: worker opening and API cancellation serialize across PostgreSQL connections', async () => {
    const { actor } = await seedActor();
    const { completed, billing } = await seedPreparedBilling(actor);
    const failOnce = vi.spyOn(receivablesAccess, 'openFromBilling')
      .mockRejectedValueOnce(new Error('SIMULATED_AFTER_DOCUMENT_COMMIT'));
    try {
      await expect(billingDocumentAccess.issue(actor, completed.id, billing.id, {
        idempotencyKey: `race-${crypto.randomUUID()}`,
      })).rejects.toBeTruthy();
    } finally {
      failOnce.mockRestore();
    }

    const documents = await pool.query<{ id: string }>(
      'SELECT id FROM bil.billing_documents WHERE billing_record_id = $1',
      [billing.id],
    );
    const documentId = documents.rows[0]!.id;
    const job = await jobsRepository.findByIdempotencyKey(
      `billing-document:${documentId}:receivable-handoff`,
    );
    expect(job).not.toBeNull();

    const handler = new BillingReceivableHandoffJobHandler(
      billingDocumentsRepository, receivablesAccess,
    );
    const originalOpen = receivablesAccess.openFromBilling.bind(receivablesAccess);
    let signalEntered!: () => void;
    let releaseOpen!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const proceed = new Promise<void>((resolve) => { releaseOpen = resolve; });
    const openSpy = vi.spyOn(receivablesAccess, 'openFromBilling')
      .mockImplementation(async (input) => {
        signalEntered();
        await proceed;
        return originalOpen(input);
      });

    const workerPromise = handler.handle({
      jobId: job!.id,
      jobKind: BACKGROUND_JOB_KINDS.BillingReceivableHandoff,
      payload: job!.payload,
      attemptCount: 1,
      correlationId: documentId,
      signal: new AbortController().signal,
    });
    try {
      await entered;
      // A second PostgreSQL connection cannot enter the document's critical
      // section while the worker is between FINALIZED read and Finance open.
      const probe = await pool.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS acquired',
        [`billing-receivable:${documentId}`],
      );
      expect(probe.rows[0]?.acquired).toBe(false);

      const current = await billingDocumentAccess.getById(
        actor, completed.id, billing.id, documentId,
      );
      const cancelPromise = billingDocumentAccess.cancel(
        actor, completed.id, billing.id, documentId, {
          rowVersion: current.rowVersion,
          cancelReason: 'cancel during in-flight worker handoff',
        },
      );
      releaseOpen();
      await workerPromise;
      await cancelPromise;

      const result = await pool.query<{ lifecycle: string }>(
        `SELECT lifecycle::text AS lifecycle FROM fin.receivables
         WHERE origin_billing_document_id = $1`,
        [documentId],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.lifecycle).toBe('CANCELLED');
    } finally {
      releaseOpen();
      openSpy.mockRestore();
      await workerPromise.catch(() => undefined);
    }
  });

  it('allocates unique numbers under concurrent issuance', async () => {
    const { actor } = await seedActor();
    const first = await seedPreparedBilling(actor);
    const second = await seedPreparedBilling(actor);

    const [docA, docB] = await Promise.all([
      billingDocumentAccess.issue(actor, first.completed.id, first.billing.id, {}),
      billingDocumentAccess.issue(actor, second.completed.id, second.billing.id, {}),
    ]);

    expect(docA.documentNumber).not.toBe(docB.documentNumber);
    const numbers = new Set([docA.documentNumber, docB.documentNumber]);
    expect(numbers.size).toBe(2);
  });

  it('rejects duplicate active document for same billing record', async () => {
    const { actor } = await seedActor();
    const { completed, billing } = await seedPreparedBilling(actor);
    await billingDocumentAccess.issue(actor, completed.id, billing.id, {});

    await expect(
      billingDocumentAccess.issue(actor, completed.id, billing.id, {}),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.BILLING_DOCUMENT_ALREADY_EXISTS });
  });

  it('preserves immutable finalized document and allows replacement', async () => {
    const { actor } = await seedActor();
    const { completed, billing } = await seedPreparedBilling(actor);
    const issued = await billingDocumentAccess.issue(actor, completed.id, billing.id, {});
    const originalHash = issued.artifactSha256;

    const replaced = await billingDocumentAccess.replace(actor, completed.id, billing.id, issued.id, {
      rowVersion: issued.rowVersion,
      replaceReason: 'Correção de vencimento.',
      dueDate: '2026-10-15',
    });

    const cancelled = await billingDocumentAccess.getById(actor, completed.id, billing.id, issued.id);
    expect(cancelled.status).toBe(BILLING_DOCUMENT_STATUSES.Cancelled);
    expect(cancelled.artifactSha256).toBe(originalHash);
    expect(replaced.versionNumber).toBe(2);
    expect(replaced.replacesDocumentId).toBe(issued.id);
    expect(replaced.dueDate).toBe('2026-10-15');
  });

  it('downloads deterministic PDF artifact', async () => {
    const { actor } = await seedActor();
    const { completed, billing } = await seedPreparedBilling(actor);
    const issued = await billingDocumentAccess.issue(actor, completed.id, billing.id, {});

    const artifact = await billingDocumentAccess.downloadPdf(actor, completed.id, billing.id, issued.id);
    expect(artifact.buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(artifact.sha256).toBe(issued.artifactSha256);
  });

  it('denies unauthorized document issue', async () => {
    const { actor } = await seedActor();
    const { completed, billing } = await seedPreparedBilling(actor);

    const login = normalizeLoginIdentifier(`bil-doc-deny-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await insertGrant(pool, {
      identityId,
      action: AUTHZ_ACTIONS.BillingBillingRecordRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actor.identityId,
    });

    await expect(
      billingDocumentAccess.issue({ identityId, sessionId: 'sid' }, completed.id, billing.id, {}),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.DENIED });
  });

  it('compensates when object storage upload fails', async () => {
    const { actor } = await seedActor();
    const { completed, billing } = await seedPreparedBilling(actor);
    const putSpy = vi.spyOn(objectStorage, 'putObject').mockRejectedValueOnce(new Error('STORAGE_FAIL'));

    await expect(
      billingDocumentAccess.issue(actor, completed.id, billing.id, {}),
    ).rejects.toBeTruthy();

    const active = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bil.billing_documents WHERE billing_record_id = $1`,
      [billing.id],
    );
    expect(active.rows[0]?.count).toBe('0');
    putSpy.mockRestore();
  });

  it('rejects document issue when purchase order requires XML attachment', async () => {
    const { actor } = await seedActor();
    const { completed, billing } = await seedPreparedBilling(actor, `PO-XML-${crypto.randomUUID().slice(0, 8)}`, {
      billingRules: [{ ruleType: PURCHASE_ORDER_RULE_TYPES.XmlRequired }],
    });

    await expect(
      billingDocumentAccess.issue(actor, completed.id, billing.id, {}),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.PURCHASE_ORDER_BILLING_RULE_VIOLATED });
  });
});

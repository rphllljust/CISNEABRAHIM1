import {
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
  truncateIdentityAndAuthorizationTables,
  truncatePhysicalAssetTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
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
import { PURCHASE_ORDER_PRICING_STRUCTURES } from '../commercial/domain/purchase-order';
import { PurchaseOrdersAccessService } from '../commercial/services/purchase-orders-access.service';
import { BillingModule } from '../billing/billing.module';
import { BILLING_RECORD_STATUSES } from '../billing/domain/billing';
import { BILLING_ERROR_CODES } from '../billing/errors/billing-error-codes';
import { BillingAccessService } from '../billing/services/billing-access.service';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MeasurementsAccessService } from '../measurements/services/measurements-access.service';
import { ResourcesModule } from '../resources/resources.module';
import { SERVICE_ORDER_ORIGINS } from '../service-orders/domain/service-order';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { ServiceOrderExecutionAccessService } from '../service-orders/services/service-order-execution-access.service';
import { ServiceOrdersAccessService } from '../service-orders/services/service-orders-access.service';

const UNIT_A = 'unit-bil-a';
const TEST_CNPJ = '11222333000181';

const SAMPLE_EXECUTION_REQUIREMENTS = [
  { requirementType: 'OBSERVATION' as const, requirementLevel: 'REQUIRED' as const },
  { requirementType: 'QUANTITY' as const, requirementLevel: 'REQUIRED' as const },
];

async function grantBillingAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
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
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServicePublish,
    AUTHZ_ACTIONS.CommercialPurchaseOrderCreate,
    AUTHZ_ACTIONS.CommercialPurchaseOrderRead,
    AUTHZ_ACTIONS.CommercialPurchaseOrderRegister,
    AUTHZ_ACTIONS.CommercialPurchaseOrderAuthorizeOverrun,
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

describe('Billing PostgreSQL integration', () => {
  let pool: Pool;
  let billingAccess: BillingAccessService;
  let measurementsAccess: MeasurementsAccessService;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let executionAccess: ServiceOrderExecutionAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  let purchaseOrdersAccess: PurchaseOrdersAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for billing integration tests.');
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
        ResourcesModule,
        ServiceOrdersModule,
        MeasurementsModule,
        BillingModule,
      ],
    }).compile();

    billingAccess = module.get(BillingAccessService);
    measurementsAccess = module.get(MeasurementsAccessService);
    serviceOrdersAccess = module.get(ServiceOrdersAccessService);
    executionAccess = module.get(ServiceOrderExecutionAccessService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    purchaseOrdersAccess = module.get(PurchaseOrdersAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateBillingTables(pool);
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateCommercialProposalTables(pool);
    await truncateDocumentTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor() {
    const login = normalizeLoginIdentifier(`bil-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantBillingAdmin(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedDraftMeasurement(actor: { identityId: string; sessionId: string }) {
    const client = await clientAccess.create(actor, {
      legalName: `Cliente Draft ${crypto.randomUUID()}`,
      tradeName: 'Cliente Draft',
      taxId: TEST_CNPJ,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, {
      code: `CAT-${suffix}`,
      name: 'Serviços',
    });
    const draft = await catalogAccess.create(actor, {
      code: `DRAFT-SRV-${suffix}`,
      name: 'Serviço draft',
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

    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
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
    return { completed, measurement };
  }

  async function seedApprovedMeasurement(actor: { identityId: string; sessionId: string }) {
    const client = await clientAccess.create(actor, {
      legalName: `Cliente Billing ${crypto.randomUUID()}`,
      tradeName: 'Cliente Billing',
      taxId: TEST_CNPJ,
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
    const category = await insertCatalogCategory(pool, {
      code: `CAT-${suffix}`,
      name: 'Serviços',
    });
    const draft = await catalogAccess.create(actor, {
      code: `BIL-SRV-${suffix}`,
      name: 'Serviço faturável',
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

    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
      description: 'OS para faturamento',
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

    const login = normalizeLoginIdentifier(`bil-reviewer-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: reviewerId } = await insertIdentity(pool, login, passwordHash);
    await grantBillingAdmin(pool, reviewerId, actor.identityId);
    const reviewer = { identityId: reviewerId, sessionId: 'sid-reviewer' };

    const approved = await measurementsAccess.approve(reviewer, completed.id, measurement.id, {
      rowVersion: reviewed.rowVersion,
    });

    return { client, completed, approved };
  }

  it('rejects billing preparation without approved measurement', async () => {
    const { actor } = await seedActor();
    const { completed, measurement } = await seedDraftMeasurement(actor);

    await expect(
      billingAccess.prepare(actor, completed.id, {
        measurementId: measurement.id,
        paymentTerms: '30 DDL',
      }),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.MEASUREMENT_NOT_APPROVED });
  });

  it('projects completed orders with incomplete measurement as an exception in one queue response', async () => {
    const { actor } = await seedActor();
    const { completed, measurement } = await seedDraftMeasurement(actor);

    const result = await billingAccess.listWorklist(actor, { limit: 20, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.page).toEqual({ count: 1, limit: 20, offset: 0, totalPages: 1, hasMore: false });
    expect(result.items).toEqual([
      expect.objectContaining({
        serviceOrderId: completed.id,
        measurementId: measurement.id,
        measurementStatus: 'DRAFT',
        bucket: 'measurement_pending',
        exceptionCode: 'MEASUREMENT_NOT_APPROVED',
        amount: null,
      }),
    ]);
    expect(result.summary.counts['measurement_pending']).toBe(1);
  });

  it('rejects measurement-required billing when no measurement is supplied', async () => {
    const { actor } = await seedActor();
    const { completed } = await seedDraftMeasurement(actor);

    await expect(
      billingAccess.prepare(actor, completed.id, {
        paymentTerms: '30 DDL',
      }),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.MEASUREMENT_NOT_FOUND });
  });

  it('prepares contractual billing without a measurement when the policy is fixed price', async () => {
    const { actor } = await seedActor();
    const { completed } = await seedDraftMeasurement(actor);

    await pool.query(
      `UPDATE so.service_orders
       SET service_snapshot = COALESCE(service_snapshot, '{}'::jsonb) || $2::jsonb,
           proposal_snapshot = $3::jsonb
       WHERE id = $1`,
      [
        completed.id,
        JSON.stringify({ billingEntitlementPolicy: 'FIXED_PRICE' }),
        JSON.stringify({ globalSalePrice: '1000.0000', currencyCode: 'BRL' }),
      ],
    );

    const worklist = await billingAccess.listWorklist(actor, { limit: 20, offset: 0 });
    expect(worklist.items).toEqual([
      expect.objectContaining({
        serviceOrderId: completed.id,
        measurementStatus: 'DRAFT',
        bucket: 'ready',
        amount: '1000.0000',
        currencyCode: 'BRL',
        exceptionCode: null,
      }),
    ]);

    const billing = await billingAccess.prepare(actor, completed.id, {
      paymentTerms: '30 DDL',
    });
    expect(billing.status).toBe(BILLING_RECORD_STATUSES.Prepared);
    expect(billing.measurementId).toBeNull();
    expect(billing.entitlementPolicy).toBe('FIXED_PRICE');
    expect(billing.items).toHaveLength(1);
    expect(billing.items[0]?.measurementItemId).toBeNull();
    expect(billing.totalAmount).toBe('1000');
  });

  it('prepares billing record from approved measurement with item-derived total', async () => {
    const { actor } = await seedActor();
    const { completed, approved, client } = await seedApprovedMeasurement(actor);

    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });

    await insertGrant(pool, {
      identityId: actor.identityId,
      action: AUTHZ_ACTIONS.BillingBillingDocumentRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actor.identityId,
    });

    expect(billing.status).toBe(BILLING_RECORD_STATUSES.Prepared);
    expect(billing.totalAmount).toBe('1000');
    expect(billing.items).toHaveLength(1);
    expect(billing.clientLegalNameSnapshot).toBe(client.legalName);
    expect(billing.clientTaxIdSnapshot).toBe(TEST_CNPJ);
    expect(billing.billingAddressSnapshot.city).toBe('Porto Velho');
    expect(billing.commercialReferenceSnapshot).toBeTruthy();
    const costSummary = (billing.commercialReferenceSnapshot as { costSummary?: { totalRevenue?: string } })
      .costSummary;
    expect(costSummary?.totalRevenue).toBe('1000');

    const worklist = await billingAccess.listWorklist(actor, { bucket: 'prepared', limit: 20, offset: 0 });
    expect(worklist.total).toBe(1);
    expect(worklist.items[0]).toEqual(expect.objectContaining({
      serviceOrderId: completed.id,
      billingRecordId: billing.id,
      billingVersion: billing.rowVersion,
      amount: '1000.0000',
      currencyCode: billing.currencyCode,
      bucket: 'prepared',
      nextAction: 'issue_internal_document',
    }));
  });

  it('rejects an approved measurement whose historic line has no verifiable currency', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);
    // Negative enterprise fixture: a legacy measurement with missing source
    // currency must not silently be interpreted as BRL at billing time.
    await pool.query(
      `UPDATE msr.measurement_items
          SET pricing_line_snapshot = pricing_line_snapshot - 'currencyCode'
        WHERE measurement_id = $1`,
      [approved.id],
    );
    await expect(
      billingAccess.prepare(actor, completed.id, {
        measurementId: approved.id, paymentTerms: '30 DDL',
      }),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.BILLING_CURRENCY_UNVERIFIED });
    const worklist = await billingAccess.listWorklist(actor, { limit: 20, offset: 0 });
    expect(worklist.items).toEqual([expect.objectContaining({
      serviceOrderId: completed.id,
      bucket: 'billing_basis_missing',
      exceptionCode: 'BILLING_CURRENCY_UNVERIFIED',
      amount: null,
      currencyCode: null,
    })]);
    const result = await pool.query<{ total: number }>(
      'SELECT COUNT(*)::integer AS total FROM bil.billing_records WHERE measurement_id = $1',
      [approved.id],
    );
    expect(result.rows[0]?.total).toBe(0);
  });

  it('preserves a verified non-default line currency in the prepared obligation', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);
    await pool.query(
      `UPDATE msr.measurement_items
          SET pricing_line_snapshot = pricing_line_snapshot || '{"currencyCode":"USD"}'::jsonb
        WHERE measurement_id = $1`,
      [approved.id],
    );
    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id, paymentTerms: '30 DDL',
    });
    expect(billing.currencyCode).toBe('USD');
    expect(billing.measurementId).toBe(approved.id);
  });

  it('rejects duplicate billing for the same measurement', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);

    await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });

    await expect(
      billingAccess.prepare(actor, completed.id, {
        measurementId: approved.id,
        paymentTerms: '30 DDL',
      }),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.BILLING_ALREADY_EXISTS });
  });

  it('rejects asserted total mismatch', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);

    await expect(
      billingAccess.prepare(actor, completed.id, {
        measurementId: approved.id,
        paymentTerms: '30 DDL',
        assertedTotalAmount: '5000.0000',
      }),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.BILLING_AMOUNT_MISMATCH });
  });

  it('detects PO payment terms mismatch', async () => {
    const { actor } = await seedActor();
    const client = await clientAccess.create(actor, {
      legalName: `Cliente PO ${crypto.randomUUID()}`,
      tradeName: 'Cliente PO',
      taxId: TEST_CNPJ,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, { code: `CAT-${suffix}`, name: 'Serviços' });
    const draft = await catalogAccess.create(actor, {
      code: `PO-SRV-${suffix}`,
      name: 'Serviço PO',
      categoryId: category.categoryId,
      archetype: 'RENTAL',
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '1000.0000' }],
      resourceRequirements: [],
      laborRequirements: [],
      executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    const published = await catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);

    const purchaseOrder = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: `PO-${suffix}`,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
      paymentTerms: '07 DDL',
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

    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.PurchaseOrder,
      unitId: UNIT_A,
      clientId: client.id,
      purchaseOrderId: registered.purchaseOrder.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, { rowVersion: created.rowVersion });
    const released = await serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion });
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'OK',
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
    const login = normalizeLoginIdentifier(`bil-po-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: reviewerId } = await insertIdentity(pool, login, passwordHash);
    await grantBillingAdmin(pool, reviewerId, actor.identityId);
    const reviewer = { identityId: reviewerId, sessionId: 'sid-po' };
    const approved = await measurementsAccess.approve(reviewer, completed.id, measurement.id, {
      rowVersion: reviewed.rowVersion,
    });

    await expect(
      billingAccess.prepare(actor, completed.id, {
        measurementId: approved.id,
        paymentTerms: 'À vista',
      }),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.COMMERCIAL_TERMS_MISMATCH });
  });

  it('preserves client snapshot after client update', async () => {
    const { actor } = await seedActor();
    const { completed, approved, client } = await seedApprovedMeasurement(actor);

    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });

    await pool.query(`UPDATE pty.clients SET legal_name = 'Nome Alterado' WHERE id = $1`, [client.id]);

    const reloaded = await billingAccess.getById(actor, completed.id, billing.id);
    expect(reloaded.clientLegalNameSnapshot).toBe(client.legalName);
    expect(reloaded.clientLegalNameSnapshot).not.toBe('Nome Alterado');
  });

  it('allows only one concurrent prepare transition', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);

    const results = await Promise.allSettled([
      billingAccess.prepare(actor, completed.id, {
        measurementId: approved.id,
        paymentTerms: '30 DDL',
      }),
      billingAccess.prepare(actor, completed.id, {
        measurementId: approved.id,
        paymentTerms: '30 DDL',
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('preserves traceable billing origin with OS, measurement and item linkage', async () => {
    const { actor } = await seedActor();
    const { completed, approved, client } = await seedApprovedMeasurement(actor);

    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });

    expect(billing.serviceOrderId).toBe(completed.id);
    expect(billing.measurementId).toBe(approved.id);
    expect(billing.clientId).toBe(client.id);
    expect(billing.items[0]?.measurementItemId).toBeTruthy();

    const origin = (
      billing.commercialReferenceSnapshot as {
        billingOrigin?: { serviceOrderId: string; measurementId: string; clientId: string };
      }
    ).billingOrigin;
    expect(origin?.serviceOrderId).toBe(completed.id);
    expect(origin?.measurementId).toBe(approved.id);
    expect(origin?.clientId).toBe(client.id);
  });

  it('replays prepare with the same idempotency key without duplicate records', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);
    const idempotencyKey = `prepare-replay-${crypto.randomUUID()}`;

    const first = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
      idempotencyKey,
    });
    const replayed = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
      idempotencyKey,
    });

    expect(replayed.id).toBe(first.id);
    expect(replayed.status).toBe(BILLING_RECORD_STATUSES.Prepared);

    const records = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bil.billing_records WHERE measurement_id = $1 AND status = 'PREPARED'`,
      [approved.id],
    );
    expect(records.rows[0]?.count).toBe('1');
  });

  it('allows concurrent prepare retries with the same idempotency key', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);
    const idempotencyKey = `prepare-concurrent-${crypto.randomUUID()}`;
    const payload = {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
      idempotencyKey,
    };

    const results = await Promise.allSettled([
      billingAccess.prepare(actor, completed.id, payload),
      billingAccess.prepare(actor, completed.id, payload),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);
    const ids = fulfilled.map((result) => (result as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(new Set(ids).size).toBe(1);

    const records = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bil.billing_records WHERE measurement_id = $1`,
      [approved.id],
    );
    expect(records.rows[0]?.count).toBe('1');
  });

  it('denies unauthorized billing read', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);
    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });

    const login = normalizeLoginIdentifier(`bil-deny-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await insertGrant(pool, {
      identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actor.identityId,
    });

    await expect(
      billingAccess.getById({ identityId, sessionId: 'sid' }, completed.id, billing.id),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.DENIED });
  });

  it('voids prepared billing record', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);
    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });

    const voided = await billingAccess.voidRecord(actor, completed.id, billing.id, {
      rowVersion: billing.rowVersion,
      voidReason: 'Erro operacional detectado.',
    });

    expect(voided.status).toBe(BILLING_RECORD_STATUSES.Voided);
    expect(voided.voidReason).toBe('Erro operacional detectado.');
  });

  it('replays void with the same idempotency key without double voiding', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);
    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });
    const idempotencyKey = `void-replay-${crypto.randomUUID()}`;

    const voided = await billingAccess.voidRecord(actor, completed.id, billing.id, {
      rowVersion: billing.rowVersion,
      voidReason: 'Cancelamento operacional.',
      idempotencyKey,
    });
    const replayed = await billingAccess.voidRecord(actor, completed.id, billing.id, {
      rowVersion: billing.rowVersion,
      voidReason: 'Cancelamento operacional.',
      idempotencyKey,
    });

    expect(replayed.id).toBe(voided.id);
    expect(replayed.status).toBe(BILLING_RECORD_STATUSES.Voided);

    const records = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bil.billing_records WHERE measurement_id = $1 AND status = 'VOIDED'`,
      [approved.id],
    );
    expect(records.rows[0]?.count).toBe('1');
  });

  it('rejects stale rowVersion on void without silent overwrite', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);
    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });

    await expect(
      billingAccess.voidRecord(actor, completed.id, billing.id, {
        rowVersion: billing.rowVersion + 1,
        voidReason: 'Tentativa inválida.',
      }),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.VERSION_CONFLICT });
  });

  it('allows concurrent void retries with the same idempotency key', async () => {
    const { actor } = await seedActor();
    const { completed, approved } = await seedApprovedMeasurement(actor);
    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });
    const idempotencyKey = `void-concurrent-${crypto.randomUUID()}`;
    const payload = {
      rowVersion: billing.rowVersion,
      voidReason: 'Cancelamento concorrente.',
      idempotencyKey,
    };

    const results = await Promise.allSettled([
      billingAccess.voidRecord(actor, completed.id, billing.id, payload),
      billingAccess.voidRecord(actor, completed.id, billing.id, payload),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);
    const ids = fulfilled.map((result) => (result as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(new Set(ids).size).toBe(1);

    const records = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bil.billing_records WHERE measurement_id = $1`,
      [approved.id],
    );
    expect(records.rows[0]?.count).toBe('1');
  });

  it('consumes and releases purchase order balance across prepare and void', async () => {
    const { actor } = await seedActor();
    const client = await clientAccess.create(actor, {
      legalName: `Cliente PO Balance ${crypto.randomUUID()}`,
      tradeName: 'Cliente PO Balance',
      taxId: TEST_CNPJ,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
      addresses: [
        {
          purpose: ADDRESS_PURPOSES.Billing,
          street: 'Rua PO',
          number: '1',
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
      code: `PO-BAL-${suffix}`,
      name: 'Serviço PO Balance',
      categoryId: category.categoryId,
      archetype: 'RENTAL',
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '1000.0000' }],
      resourceRequirements: [],
      laborRequirements: [],
      executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    const published = await catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);

    const purchaseOrder = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: `PO-BAL-${suffix}`,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
      paymentTerms: '30 DDL',
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

    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.PurchaseOrder,
      unitId: UNIT_A,
      clientId: client.id,
      purchaseOrderId: registered.purchaseOrder.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, { rowVersion: created.rowVersion });
    const released = await serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion });
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'OK',
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
    const login = normalizeLoginIdentifier(`bil-bal-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: reviewerId } = await insertIdentity(pool, login, passwordHash);
    await grantBillingAdmin(pool, reviewerId, actor.identityId);
    const reviewer = { identityId: reviewerId, sessionId: 'sid-bal' };
    const approved = await measurementsAccess.approve(reviewer, completed.id, measurement.id, {
      rowVersion: reviewed.rowVersion,
    });

    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });

    const consumed = await purchaseOrdersAccess.getById(actor, registered.purchaseOrder.id);
    expect(consumed.balance.consumedAmount).toBe('1000');
    expect(consumed.balance.availableBalance).toBe('0');

    await billingAccess.voidRecord(actor, completed.id, billing.id, {
      rowVersion: billing.rowVersion,
      voidReason: 'Libera saldo do PO.',
    });

    const releasedBalance = await purchaseOrdersAccess.getById(actor, registered.purchaseOrder.id);
    expect(releasedBalance.balance.consumedAmount).toBe('0');
    expect(releasedBalance.balance.availableBalance).toBe('1000');
  });

  it('rejects billing prepare when purchase order balance is insufficient', async () => {
    const { actor } = await seedActor();
    const client = await clientAccess.create(actor, {
      legalName: `Cliente PO Insuf ${crypto.randomUUID()}`,
      tradeName: 'Cliente PO Insuf',
      taxId: TEST_CNPJ,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
      addresses: [
        {
          purpose: ADDRESS_PURPOSES.Billing,
          street: 'Rua PO',
          number: '1',
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
      code: `PO-INS-${suffix}`,
      name: 'Serviço PO Insuf',
      categoryId: category.categoryId,
      archetype: 'RENTAL',
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '1000.0000' }],
      resourceRequirements: [],
      laborRequirements: [],
      executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    const published = await catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);

    const purchaseOrder = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: `PO-INS-${suffix}`,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
      paymentTerms: '30 DDL',
      items: [
        {
          lineNumber: 1,
          description: 'Serviço PO',
          serviceDefinitionId: published.serviceDefinitionId,
          serviceDefinitionVersionId: published.id,
          quantity: '1.0000',
          unitCode: 'SERVICE',
          unitPrice: '500.0000',
          lineTotal: '500.0000',
        },
      ],
    });
    const registered = await purchaseOrdersAccess.register(actor, purchaseOrder.purchaseOrder.id, {
      rowVersion: purchaseOrder.purchaseOrder.rowVersion,
    });

    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.PurchaseOrder,
      unitId: UNIT_A,
      clientId: client.id,
      purchaseOrderId: registered.purchaseOrder.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, { rowVersion: created.rowVersion });
    const released = await serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion });
    const started = await executionAccess.start(actor, released.id, { rowVersion: released.rowVersion });
    await executionAccess.recordObservation(actor, started.id, {
      rowVersion: started.rowVersion,
      text: 'OK',
    });
    const afterObservation = await serviceOrdersAccess.getById(actor, started.id);
    await executionAccess.recordQuantity(actor, afterObservation.id, {
      rowVersion: afterObservation.rowVersion,
      quantityValue: '2',
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
    const login = normalizeLoginIdentifier(`bil-ins-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: reviewerId } = await insertIdentity(pool, login, passwordHash);
    await grantBillingAdmin(pool, reviewerId, actor.identityId);
    const reviewer = { identityId: reviewerId, sessionId: 'sid-ins' };
    const approved = await measurementsAccess.approve(reviewer, completed.id, measurement.id, {
      rowVersion: reviewed.rowVersion,
    });

    await expect(
      billingAccess.prepare(actor, completed.id, {
        measurementId: approved.id,
        paymentTerms: '30 DDL',
      }),
    ).rejects.toMatchObject({ code: BILLING_ERROR_CODES.PURCHASE_ORDER_BALANCE_EXCEEDED });

    const poAfterFail = await purchaseOrdersAccess.getById(actor, registered.purchaseOrder.id);
    const overridden = await purchaseOrdersAccess.authorizeOverrun(actor, registered.purchaseOrder.id, {
      rowVersion: poAfterFail.purchaseOrder.rowVersion,
      amount: '500.0000',
      justification: 'Excedente comercial autorizado pela autoridade máxima.',
    });
    expect(overridden.balance.authorizedOverrunAmount).toBeTruthy();

    const billing = await billingAccess.prepare(actor, completed.id, {
      measurementId: approved.id,
      paymentTerms: '30 DDL',
    });
    expect(billing.status).toBe(BILLING_RECORD_STATUSES.Prepared);
  });
});

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
      ],
    }).compile();

    billingAccess = module.get(BillingAccessService);
    billingDocumentAccess = module.get(BillingDocumentAccessService);
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

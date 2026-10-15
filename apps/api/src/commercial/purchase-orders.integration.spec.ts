import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertCatalogCategory,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateCatalogTables,
  truncateClientTables,
  truncateCommercialPurchaseOrderTables,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
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
import { SECURITY_AUDIT_ACTIONS } from '../audit/types/security-audit.types';
import { CatalogModule } from '../catalog/catalog.module';
import { ClientsModule } from '../clients/clients.module';
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { ClientAccessService } from '../clients/services/client-access.service';
import { DocumentsModule } from '../documents/documents.module';
import { DOCUMENT_CATEGORIES } from '../documents/domain/document-categories';
import { minimalPdfBuffer } from '../documents/domain/file-validation';
import { DocumentsAccessService } from '../documents/services/documents-access.service';
import { ServiceCatalogAccessService } from '../catalog/services/service-catalog-access.service';
import { CommercialModule } from './commercial.module';
import { COMMERCIAL_ERROR_CODES } from './errors/commercial-error-codes';
import { CommercialHttpException } from './errors/commercial-http.exception';
import {
  PURCHASE_ORDER_DOCUMENT_LINK_PURPOSES,
  PURCHASE_ORDER_PRICING_STRUCTURES,
  PURCHASE_ORDER_RULE_TYPES,
  PURCHASE_ORDER_STATUSES,
} from './domain/purchase-order';
import { PurchaseOrdersAccessService } from './services/purchase-orders-access.service';

const UNIT_A = 'unit-po-a';
const UNIT_B = 'unit-po-b';
const TEST_CNPJ = '11222333000181';

// Fixture values — test-only, not domain constants
const FIXTURE_RC = '991487';
const FIXTURE_PO = '41926266';

async function grantPurchaseOrderAdmin(
  pool: Pool,
  identityId: string,
  grantedBy: string,
): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.CommercialPurchaseOrderCreate,
    AUTHZ_ACTIONS.CommercialPurchaseOrderRead,
    AUTHZ_ACTIONS.CommercialPurchaseOrderList,
    AUTHZ_ACTIONS.CommercialPurchaseOrderUpdate,
    AUTHZ_ACTIONS.CommercialPurchaseOrderRegister,
    AUTHZ_ACTIONS.CommercialPurchaseOrderCancel,
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServicePublish,
    AUTHZ_ACTIONS.DocumentsDocumentCreate,
    AUTHZ_ACTIONS.DocumentsDocumentRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: action.startsWith('client:')
        ? AUTHZ_RESOURCE_TYPES.Client
        : action.startsWith('catalog:')
          ? AUTHZ_RESOURCE_TYPES.CatalogService
          : action.startsWith('documents:')
            ? AUTHZ_RESOURCE_TYPES.DocumentsDocument
            : AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Commercial purchase orders PostgreSQL integration', () => {
  let pool: Pool;
  let purchaseOrdersAccess: PurchaseOrdersAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  let documentsAccess: DocumentsAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for purchase order integration tests.');
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
        DocumentsModule,
        CommercialModule,
      ],
    }).compile();

    purchaseOrdersAccess = module.get(PurchaseOrdersAccessService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    documentsAccess = module.get(DocumentsAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateDocumentTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor() {
    const login = normalizeLoginIdentifier(`po-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantPurchaseOrderAdmin(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedClient(actor: { identityId: string; sessionId: string }) {
    return clientAccess.create(actor, {
      legalName: `Cliente Teste ${crypto.randomUUID()}`,
      tradeName: 'Cliente Teste',
      taxId: TEST_CNPJ,
      contacts: [
        {
          name: 'Contato operacional',
          purpose: CONTACT_PURPOSES.Operational,
          phone: '69999990000',
        },
      ],
    });
  }

  async function seedPublishedRentalService(actor: { identityId: string; sessionId: string }) {
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, {
      code: `CAT-${suffix}`,
      name: 'Locação',
    });
    const draft = await catalogAccess.create(actor, {
      code: `SRV-${suffix}`,
      name: 'Serviço de locação',
      categoryId: category.categoryId,
      archetype: 'RENTAL',
      measurementMode: 'BY_QUANTITY',
      measurementBasis: 'UNIT',
      allowedUnits: [{ unitCode: 'UA', isDefault: true, sortOrder: 0 }],
      pricingModels: [
        { modelCode: 'NEGOTIATED_PO_PRICE', unitCode: 'UA', salePrice: '9351.0000' },
      ],
      resourceRequirements: [],
      laborRequirements: [],
      executionRequirements: [],
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    return catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);
  }

  it('publishes a full authorized, currency-separated portfolio summary independent of page size', async () => {
    const { actor } = await seedActor();
    const empty = await purchaseOrdersAccess.list(actor, { limit: 1, offset: 0 });
    expect(empty.items).toHaveLength(0);
    expect(empty.summary).toEqual({ recordCount: 0, currencies: [] });

    const brlClient = await seedClient(actor);
    await purchaseOrdersAccess.create(actor, {
      clientId: brlClient.id,
      unitId: UNIT_A,
      poNumber: `${FIXTURE_PO}-BRL`,
      currencyCode: 'BRL',
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '9351.2500',
    });
    await purchaseOrdersAccess.create(actor, {
      clientId: brlClient.id,
      unitId: UNIT_B,
      poNumber: `${FIXTURE_PO}-USD`,
      currencyCode: 'USD',
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '1200.5000',
    });

    const firstPage = await purchaseOrdersAccess.list(actor, { limit: 1, offset: 0 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.summary.recordCount).toBe(2);
    expect(firstPage.summary.currencies).toEqual([
      expect.objectContaining({
        currencyCode: 'BRL',
        recordCount: 1,
        authorizedAmount: '9351.2500',
        authorizedAmountUnavailableCount: 0,
        consumedAmount: '0.0000',
        availableBalance: '9351.2500',
        balanceUnavailableCount: 0,
      }),
      expect.objectContaining({
        currencyCode: 'USD',
        recordCount: 1,
        authorizedAmount: '1200.5000',
        authorizedAmountUnavailableCount: 0,
        consumedAmount: '0.0000',
        availableBalance: '1200.5000',
        balanceUnavailableCount: 0,
      }),
    ]);

    const unitScoped = await purchaseOrdersAccess.list(actor, {
      limit: 1,
      offset: 0,
      unitId: UNIT_A,
    });
    expect(unitScoped.summary.recordCount).toBe(1);
    expect(unitScoped.summary.currencies).toEqual([
      expect.objectContaining({ currencyCode: 'BRL', recordCount: 1 }),
    ]);
  });

  it('registers rental PO fixture with per-PO billing rules', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedRentalService(actor);

    const created = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: FIXTURE_PO,
      rcNumber: FIXTURE_RC,
      issueDate: '2026-08-01',
      paymentTerms: '07 DDL',
      paymentMethod: 'transferência',
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
      items: [
        {
          lineNumber: 1,
          description: 'Serviço de locação',
          quantity: '1.0000',
          unitCode: 'UA',
          unitPrice: '9351.0000',
          lineTotal: '9351.0000',
          serviceDefinitionId: publishedService.serviceDefinitionId,
          serviceDefinitionVersionId: publishedService.id,
        },
      ],
      billingRules: [
        { ruleType: PURCHASE_ORDER_RULE_TYPES.PoNumberRequiredOnInvoice },
        { ruleType: PURCHASE_ORDER_RULE_TYPES.BillingCutoff, ruleConfig: { cutoffDay: 7 } },
        { ruleType: PURCHASE_ORDER_RULE_TYPES.Recipient, ruleConfig: { recipient: 'faturamento@cliente.invalid' } },
      ],
    });

    expect(created.purchaseOrder.poNumber).toBe(FIXTURE_PO);
    expect(created.purchaseOrder.rcNumber).toBe(FIXTURE_RC);
    expect(created.billingRules).toHaveLength(3);

    const registered = await purchaseOrdersAccess.register(actor, created.purchaseOrder.id, {
      rowVersion: created.purchaseOrder.rowVersion,
    });

    expect(registered.purchaseOrder.status).toBe(PURCHASE_ORDER_STATUSES.Registered);
    expect(typeof registered.purchaseOrder.clientSnapshot?.legalName).toBe('string');
    expect(registered.purchaseOrder.clientSnapshot?.normalizedTaxId).toBe(TEST_CNPJ);
    expect(typeof registered.items[0]?.serviceSnapshot?.code).toBe('string');
  });

  it('rejects duplicate PO number for the same client', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);

    await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: FIXTURE_PO,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '100.0000',
    });

    await expect(
      purchaseOrdersAccess.create(actor, {
        clientId: client.id,
        unitId: UNIT_A,
        poNumber: FIXTURE_PO,
        pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
        totalAmount: '200.0000',
      }),
    ).rejects.toMatchObject({
      code: COMMERCIAL_ERROR_CODES.PURCHASE_ORDER_DUPLICATE,
    } satisfies Partial<CommercialHttpException>);
  });

  it('rejects stale row version updates and unauthorized access', async () => {
    const owner = await seedActor();
    const client = await seedClient(owner.actor);

    const created = await purchaseOrdersAccess.create(owner.actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: FIXTURE_PO,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '9351.0000',
    });

    await expect(
      purchaseOrdersAccess.updateDraft(owner.actor, created.purchaseOrder.id, {
        rowVersion: created.purchaseOrder.rowVersion + 1,
        paymentTerms: '15 DDL',
      }),
    ).rejects.toMatchObject({
      code: COMMERCIAL_ERROR_CODES.PURCHASE_ORDER_VERSION_CONFLICT,
    });

    const intruderLogin = normalizeLoginIdentifier(`po-x-${crypto.randomUUID()}@cisne.invalid`);
    const { identityId: intruderId } = await insertIdentity(
      pool,
      intruderLogin,
      await hashPassword(AUTH_TEST_PASSWORD),
    );
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
    await insertGrant(pool, {
      identityId: intruderId,
      action: AUTHZ_ACTIONS.CommercialPurchaseOrderRead,
      resourceType: AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: UNIT_B,
      grantedByIdentityId: intruderId,
    });

    await expect(
      purchaseOrdersAccess.getById({ identityId: intruderId, sessionId: 'sid' }, created.purchaseOrder.id),
    ).rejects.toMatchObject({ code: COMMERCIAL_ERROR_CODES.DENIED });
  });

  it('links documents and records audit on register', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);

    const created = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: FIXTURE_PO,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '9351.0000',
    });

    const document = await documentsAccess.createWithUpload(
      actor,
      {
        title: 'PO original',
        categoryCode: DOCUMENT_CATEGORIES.General,
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
      },
      { buffer: minimalPdfBuffer(), filename: 'po.pdf', mimetype: 'application/pdf' },
    );

    const linked = await purchaseOrdersAccess.linkDocument(actor, created.purchaseOrder.id, {
      documentId: document.document.id,
      linkPurpose: PURCHASE_ORDER_DOCUMENT_LINK_PURPOSES.Original,
    });
    expect(linked.documentLinks).toHaveLength(1);

    await purchaseOrdersAccess.register(actor, created.purchaseOrder.id, {
      rowVersion: linked.purchaseOrder.rowVersion,
    });

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events
       WHERE resource_id = $1 AND action = $2`,
      [created.purchaseOrder.id, SECURITY_AUDIT_ACTIONS.CommercialPurchaseOrderRegister],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('snapshots commercial commitment on register and persists line totals', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);

    const created = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: FIXTURE_PO,
      rcNumber: FIXTURE_RC,
      paymentTerms: '07 DDL',
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
      items: [
        {
          lineNumber: 1,
          description: 'Serviço de locação',
          quantity: '1.0000',
          unitCode: 'UA',
          unitPrice: '9351.0000',
          lineTotal: '9351.0000',
        },
      ],
    });

    const registered = await purchaseOrdersAccess.register(actor, created.purchaseOrder.id, {
      rowVersion: created.purchaseOrder.rowVersion,
    });

    expect(registered.purchaseOrder.itemsLineTotal).toBe('9351');
    expect(registered.purchaseOrder.commercialSnapshot).toMatchObject({
      poNumber: FIXTURE_PO,
      rcNumber: FIXTURE_RC,
      paymentTerms: '07 DDL',
    });
    expect(registered.items[0]?.commercialSnapshot).toMatchObject({
      description: 'Serviço de locação',
      lineTotal: '9351',
    });
  });

  it('rejects draft edits after register', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);

    const created = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: FIXTURE_PO,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '9351.0000',
    });
    const registered = await purchaseOrdersAccess.register(actor, created.purchaseOrder.id, {
      rowVersion: created.purchaseOrder.rowVersion,
    });

    await expect(
      purchaseOrdersAccess.updateDraft(actor, created.purchaseOrder.id, {
        rowVersion: registered.purchaseOrder.rowVersion,
        paymentTerms: '15 DDL',
      }),
    ).rejects.toMatchObject({ code: COMMERCIAL_ERROR_CODES.PURCHASE_ORDER_INVALID_STATE });
  });

  it('returns snapshotted commercial values even if columns are mutated', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);

    const created = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: FIXTURE_PO,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
      items: [
        {
          lineNumber: 1,
          description: 'Linha original',
          quantity: '1.0000',
          unitCode: 'UA',
          unitPrice: '1000.0000',
          lineTotal: '1000.0000',
        },
      ],
    });
    await purchaseOrdersAccess.register(actor, created.purchaseOrder.id, {
      rowVersion: created.purchaseOrder.rowVersion,
    });

    await pool.query(
      `UPDATE com.purchase_orders SET po_number = $2, total_amount = $3::numeric WHERE id = $1`,
      [created.purchaseOrder.id, 'PO-ADULTERADO', '9999.0000'],
    );
    await pool.query(
      `UPDATE com.purchase_order_items
       SET description = $2, line_total_amount = $3::numeric
       WHERE purchase_order_id = $1`,
      [created.purchaseOrder.id, 'Linha adulterada', '9999.0000'],
    );

    const detail = await purchaseOrdersAccess.getById(actor, created.purchaseOrder.id);
    expect(detail.purchaseOrder.poNumber).toBe(FIXTURE_PO);
    expect(detail.items[0]?.description).toBe('Linha original');
    expect(detail.items[0]?.lineTotal).toBe('1000');
  });

  it('blocks cancel when purchase order has billing consumption', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);

    const created = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: `PO-BAL-${crypto.randomUUID().slice(0, 8)}`,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '5000.0000',
    });
    const registered = await purchaseOrdersAccess.register(actor, created.purchaseOrder.id, {
      rowVersion: created.purchaseOrder.rowVersion,
    });

    await pool.query(
      `UPDATE com.purchase_orders SET consumed_amount = 100.0000 WHERE id = $1`,
      [created.purchaseOrder.id],
    );

    await expect(
      purchaseOrdersAccess.cancel(actor, created.purchaseOrder.id, {
        rowVersion: registered.purchaseOrder.rowVersion,
        cancellationReason: 'Tentativa inválida',
      }),
    ).rejects.toMatchObject({ code: COMMERCIAL_ERROR_CODES.PURCHASE_ORDER_IN_USE });
  });
});

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
  truncateCommercialProposalTables,
  truncateCommercialPurchaseOrderTables,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { SECURITY_AUDIT_ACTIONS } from '../audit/types/security-audit.types';
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
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { ClientAccessService } from '../clients/services/client-access.service';
import { CommercialModule } from '../commercial/commercial.module';
import { COMMERCIAL_ERROR_CODES } from '../commercial/errors/commercial-error-codes';
import { CommercialHttpException } from '../commercial/errors/commercial-http.exception';
import { PROPOSAL_PRICING_STRUCTURES } from '../commercial/domain/proposal';
import { PURCHASE_ORDER_PRICING_STRUCTURES } from '../commercial/domain/purchase-order';
import { ProposalsAccessService } from '../commercial/services/proposals-access.service';
import { PurchaseOrdersAccessService } from '../commercial/services/purchase-orders-access.service';
import { DocumentsModule } from '../documents/documents.module';
import { DOCUMENT_CATEGORIES } from '../documents/domain/document-categories';
import { minimalPdfBuffer } from '../documents/domain/file-validation';
import { DocumentsAccessService } from '../documents/services/documents-access.service';
import {
  SERVICE_REQUEST_DOCUMENT_LINK_PURPOSES,
  SERVICE_REQUEST_ORIGINS,
  SERVICE_REQUEST_PRIORITIES,
  SERVICE_REQUEST_STATUSES,
} from './domain/service-request';
import { REQUESTS_ERROR_CODES } from './errors/requests-error-codes';
import { RequestsHttpException } from './errors/requests-http.exception';
import { RequestsModule } from './requests.module';
import { ServiceRequestsAccessService } from './services/service-requests-access.service';

const UNIT_A = 'unit-sr-a';
const UNIT_B = 'unit-sr-b';
const TEST_CNPJ = '11222333000181';
const TEST_CNPJ_ALT = '19131243000197';

async function grantServiceRequestAdmin(
  pool: Pool,
  identityId: string,
  grantedBy: string,
): Promise<void> {
  const requestActions = [
    AUTHZ_ACTIONS.RequestsServiceRequestCreate,
    AUTHZ_ACTIONS.RequestsServiceRequestRead,
    AUTHZ_ACTIONS.RequestsServiceRequestList,
    AUTHZ_ACTIONS.RequestsServiceRequestUpdate,
    AUTHZ_ACTIONS.RequestsServiceRequestSubmit,
    AUTHZ_ACTIONS.RequestsServiceRequestReview,
    AUTHZ_ACTIONS.RequestsServiceRequestApprove,
    AUTHZ_ACTIONS.RequestsServiceRequestReject,
    AUTHZ_ACTIONS.RequestsServiceRequestCancel,
    AUTHZ_ACTIONS.RequestsServiceRequestConvert,
  ];
  const extraActions = [
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServicePublish,
    AUTHZ_ACTIONS.DocumentsDocumentCreate,
    AUTHZ_ACTIONS.DocumentsDocumentRead,
    AUTHZ_ACTIONS.CommercialProposalCreate,
    AUTHZ_ACTIONS.CommercialProposalRead,
    AUTHZ_ACTIONS.CommercialProposalIssue,
    AUTHZ_ACTIONS.CommercialPurchaseOrderCreate,
    AUTHZ_ACTIONS.CommercialPurchaseOrderRead,
    AUTHZ_ACTIONS.CommercialPurchaseOrderRegister,
    AUTHZ_ACTIONS.CommercialPurchaseOrderCancel,
  ];

  for (const action of [...requestActions, ...extraActions]) {
    const resourceType = action.startsWith('requests:')
      ? AUTHZ_RESOURCE_TYPES.RequestsServiceRequest
      : action.startsWith('client:')
        ? AUTHZ_RESOURCE_TYPES.Client
        : action.startsWith('catalog:')
          ? AUTHZ_RESOURCE_TYPES.CatalogService
          : action.startsWith('documents:')
            ? AUTHZ_RESOURCE_TYPES.DocumentsDocument
            : action.startsWith('commercial:proposal')
              ? AUTHZ_RESOURCE_TYPES.CommercialProposal
              : AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder;

    await insertGrant(pool, {
      identityId,
      action,
      resourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Service requests PostgreSQL integration', () => {
  let pool: Pool;
  let serviceRequestsAccess: ServiceRequestsAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  let documentsAccess: DocumentsAccessService;
  let proposalsAccess: ProposalsAccessService;
  let purchaseOrdersAccess: PurchaseOrdersAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for service request integration tests.');
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
        RequestsModule,
      ],
    }).compile();

    serviceRequestsAccess = module.get(ServiceRequestsAccessService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    documentsAccess = module.get(DocumentsAccessService);
    proposalsAccess = module.get(ProposalsAccessService);
    purchaseOrdersAccess = module.get(PurchaseOrdersAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
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
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor() {
    const login = normalizeLoginIdentifier(`sr-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantServiceRequestAdmin(pool, identityId, identityId);
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

  async function seedPublishedService(actor: { identityId: string; sessionId: string }) {
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, {
      code: `CAT-${suffix}`,
      name: 'Serviços',
    });
    const draft = await catalogAccess.create(actor, {
      code: `SRV-${suffix}`,
      name: 'Serviço de campo',
      categoryId: category.categoryId,
      archetype: 'CIVIL_WORK',
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [
        { modelCode: 'GLOBAL_PRICE', salePrice: '1000.0000', internalCost: '800.0000' },
      ],
      resourceRequirements: [],
      laborRequirements: [],
      executionRequirements: [],
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    return catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);
  }

  it('creates intake with unresolved client and external origin', async () => {
    const { actor } = await seedActor();
    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Whatsapp,
      externalContact: { name: 'Maria Silva', phone: '69988887777' },
      description: 'Solicitação via WhatsApp — terraplanagem',
      location: { city: 'Porto Velho', state: 'RO' },
    });

    expect(created.serviceRequest.status).toBe(SERVICE_REQUEST_STATUSES.Draft);
    expect(created.serviceRequest.clientId).toBeNull();
    expect(created.serviceRequest.originSource).toBe(SERVICE_REQUEST_ORIGINS.Whatsapp);
  });

  it('runs submit, review, approve and reject lifecycle', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      clientId: client.id,
      description: 'Serviço recorrente',
    });

    const submitted = await serviceRequestsAccess.submit(actor, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
    });
    expect(submitted.serviceRequest.status).toBe(SERVICE_REQUEST_STATUSES.Submitted);

    const underReview = await serviceRequestsAccess.startReview(actor, created.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    expect(underReview.serviceRequest.status).toBe(SERVICE_REQUEST_STATUSES.UnderReview);

    const approved = await serviceRequestsAccess.approve(actor, created.serviceRequest.id, {
      rowVersion: underReview.serviceRequest.rowVersion,
      priority: SERVICE_REQUEST_PRIORITIES.High,
    });
    expect(approved.serviceRequest.status).toBe(SERVICE_REQUEST_STATUSES.Approved);
    expect(approved.serviceRequest.priority).toBe(SERVICE_REQUEST_PRIORITIES.High);

    const rejectDraft = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Phone,
      clientId: client.id,
      description: 'Outra solicitação',
    });
    const rejectSubmitted = await serviceRequestsAccess.submit(actor, rejectDraft.serviceRequest.id, {
      rowVersion: rejectDraft.serviceRequest.rowVersion,
    });
    const rejectReview = await serviceRequestsAccess.startReview(actor, rejectDraft.serviceRequest.id, {
      rowVersion: rejectSubmitted.serviceRequest.rowVersion,
    });
    const rejected = await serviceRequestsAccess.reject(actor, rejectDraft.serviceRequest.id, {
      rowVersion: rejectReview.serviceRequest.rowVersion,
      rejectionReason: 'Escopo fora do portfólio',
    });
    expect(rejected.serviceRequest.status).toBe(SERVICE_REQUEST_STATUSES.Rejected);
    expect(rejected.serviceRequest.rejectionReason).toBe('Escopo fora do portfólio');
    const osCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM so.service_orders WHERE service_request_id = $1`,
      [rejectDraft.serviceRequest.id],
    );
    expect(osCount.rows[0]?.count).toBe('0');
  });

  it('cancels from draft and rejects invalid transitions', async () => {
    const { actor } = await seedActor();
    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.DirectRequest,
      externalContact: { name: 'Pedro' },
      description: 'Cancelável',
    });

    const cancelled = await serviceRequestsAccess.cancel(actor, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
      cancellationReason: 'Cliente desistiu',
    });
    expect(cancelled.serviceRequest.status).toBe(SERVICE_REQUEST_STATUSES.Cancelled);

    const active = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Other,
      externalContact: { email: 'a@b.invalid' },
      description: 'Ativa',
    });
    const submitted = await serviceRequestsAccess.submit(actor, active.serviceRequest.id, {
      rowVersion: active.serviceRequest.rowVersion,
    });

    await expect(
      serviceRequestsAccess.submit(actor, active.serviceRequest.id, {
        rowVersion: submitted.serviceRequest.rowVersion,
      }),
    ).rejects.toMatchObject({
      code: REQUESTS_ERROR_CODES.INVALID_STATE,
    } satisfies Partial<RequestsHttpException>);
  });

  it('rejects stale version, duplicate submit and unauthorized cross-scope access', async () => {
    const owner = await seedActor();
    const client = await seedClient(owner.actor);
    const created = await serviceRequestsAccess.create(owner.actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Contract,
      clientId: client.id,
      description: 'Protegida',
    });

    await expect(
      serviceRequestsAccess.updateDraft(owner.actor, created.serviceRequest.id, {
        rowVersion: created.serviceRequest.rowVersion + 99,
        description: 'Stale',
      }),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.VERSION_CONFLICT });

    const intruderLogin = normalizeLoginIdentifier(`sr-intruder-${crypto.randomUUID()}@cisne.invalid`);
    const { identityId: intruderId } = await insertIdentity(
      pool,
      intruderLogin,
      await hashPassword(AUTH_TEST_PASSWORD),
    );
    await insertGrant(pool, {
      identityId: intruderId,
      action: AUTHZ_ACTIONS.RequestsServiceRequestRead,
      resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: UNIT_B,
      grantedByIdentityId: intruderId,
    });

    await expect(
      serviceRequestsAccess.getById({ identityId: intruderId, sessionId: 'sid' }, created.serviceRequest.id),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.DENIED });
  });

  it('returns existing record for duplicate idempotency key', async () => {
    const { actor } = await seedActor();
    const idempotencyKey = `idem-${crypto.randomUUID()}`;
    const payload = {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      externalContact: { name: 'Idem' },
      description: 'Com chave',
      idempotencyKey,
    };
    const first = await serviceRequestsAccess.create(actor, payload);
    const second = await serviceRequestsAccess.create(actor, payload);
    expect(second.serviceRequest.id).toBe(first.serviceRequest.id);
  });

  it('links documents and accepts proposal and purchase order references', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedService(actor);

    const proposal = await proposalsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Proposta vinculada',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: '5000.0000',
    });
    await proposalsAccess.issue(
      actor,
      proposal.proposal.id,
      1,
      proposal.currentVersion!.rowVersion,
    );

    const purchaseOrder = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: `PO-${crypto.randomUUID().slice(0, 8)}`,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '3000.0000',
    });
    const registered = await purchaseOrdersAccess.register(actor, purchaseOrder.purchaseOrder.id, {
      rowVersion: purchaseOrder.purchaseOrder.rowVersion,
    });

    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.ProposalAcceptance,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Origem em proposta aceita',
      proposalId: proposal.proposal.id,
      purchaseOrderId: registered.purchaseOrder.id,
    });
    expect(created.serviceRequest.proposalId).toBe(proposal.proposal.id);
    expect(created.serviceRequest.purchaseOrderId).toBe(registered.purchaseOrder.id);

    const document = await documentsAccess.createWithUpload(
      actor,
      {
        title: 'Evidência da solicitação',
        categoryCode: DOCUMENT_CATEGORIES.General,
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
      },
      { buffer: minimalPdfBuffer(), filename: 'evidencia.pdf', mimetype: 'application/pdf' },
    );

    const linked = await serviceRequestsAccess.linkDocument(actor, created.serviceRequest.id, {
      documentId: document.document.id,
      linkPurpose: SERVICE_REQUEST_DOCUMENT_LINK_PURPOSES.Evidence,
    });
    expect(linked.documentLinks).toHaveLength(1);
    expect(linked.documentLinks[0]?.documentId).toBe(document.document.id);
  });

  it('converts approved request to service order and blocks rejected conversion', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedService(actor);
    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.PurchaseOrder,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Para conversão',
    });
    const submitted = await serviceRequestsAccess.submit(actor, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
    });
    const underReview = await serviceRequestsAccess.startReview(actor, created.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    const approved = await serviceRequestsAccess.approve(actor, created.serviceRequest.id, {
      rowVersion: underReview.serviceRequest.rowVersion,
    });

    const converted = await serviceRequestsAccess.convert(actor, created.serviceRequest.id, {
      rowVersion: approved.serviceRequest.rowVersion,
    });
    expect(converted.serviceRequest.status).toBe(SERVICE_REQUEST_STATUSES.Converted);
    expect(converted.serviceRequest.convertedServiceOrderId).not.toBeNull();

    const order = await pool.query<{ order_number: string; service_snapshot: Record<string, unknown> }>(
      `SELECT order_number, service_snapshot FROM so.service_orders WHERE id = $1`,
      [converted.serviceRequest.convertedServiceOrderId],
    );
    expect(order.rows[0]?.order_number).toMatch(/^OS-/);
    expect(order.rows[0]?.service_snapshot?.['serviceCode']).toBe(publishedService.code);

    const second = await serviceRequestsAccess.convert(actor, created.serviceRequest.id, {
      rowVersion: converted.serviceRequest.rowVersion,
    });
    expect(second.serviceRequest.status).toBe(SERVICE_REQUEST_STATUSES.Converted);
    const orderCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM so.service_orders WHERE service_request_id = $1`,
      [created.serviceRequest.id],
    );
    expect(orderCount.rows[0]?.count).toBe('2');

    const rejectedFlow = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Other,
      clientId: client.id,
      description: 'Rejeitada',
    });
    const rejectedSubmitted = await serviceRequestsAccess.submit(actor, rejectedFlow.serviceRequest.id, {
      rowVersion: rejectedFlow.serviceRequest.rowVersion,
    });
    const rejectedReview = await serviceRequestsAccess.startReview(actor, rejectedFlow.serviceRequest.id, {
      rowVersion: rejectedSubmitted.serviceRequest.rowVersion,
    });
    const rejected = await serviceRequestsAccess.reject(actor, rejectedFlow.serviceRequest.id, {
      rowVersion: rejectedReview.serviceRequest.rowVersion,
      rejectionReason: 'Não atende',
    });

    await expect(
      serviceRequestsAccess.convert(actor, rejectedFlow.serviceRequest.id, {
        rowVersion: rejected.serviceRequest.rowVersion,
      }),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.INVALID_STATE });
  });

  it('propagates contract reference and snapshot when converting CONTRACT-origin request', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedService(actor);
    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Contract,
      externalOriginReference: 'CT-FLOW-2026',
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Contrato operacional',
    });
    const submitted = await serviceRequestsAccess.submit(actor, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
    });
    const underReview = await serviceRequestsAccess.startReview(actor, created.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    const approved = await serviceRequestsAccess.approve(actor, created.serviceRequest.id, {
      rowVersion: underReview.serviceRequest.rowVersion,
    });
    const converted = await serviceRequestsAccess.convert(actor, created.serviceRequest.id, {
      rowVersion: approved.serviceRequest.rowVersion,
    });

    const order = await pool.query<{
      contract_reference: string | null;
      contract_snapshot: Record<string, unknown> | null;
    }>(
      `SELECT contract_reference, contract_snapshot
       FROM so.service_orders
       WHERE id = $1`,
      [converted.serviceRequest.convertedServiceOrderId],
    );
    expect(order.rows[0]?.contract_reference).toBe('CT-FLOW-2026');
    expect(order.rows[0]?.contract_snapshot?.['contractReference']).toBe('CT-FLOW-2026');
    expect(order.rows[0]?.contract_snapshot?.['serviceRequestId']).toBe(created.serviceRequest.id);
  });

  it('records audit events on create and submit', async () => {
    const { actor } = await seedActor();
    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      externalContact: { email: 'audit@test.invalid' },
      description: 'Auditável',
    });
    await serviceRequestsAccess.submit(actor, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
    });

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [created.serviceRequest.id],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toContain(SECURITY_AUDIT_ACTIONS.RequestsServiceRequestCreate);
    expect(actions).toContain(SECURITY_AUDIT_ACTIONS.RequestsServiceRequestSubmit);
  });

  it('rejects linking a draft purchase order to a service request', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);

    const draftPo = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: `PO-DRAFT-${crypto.randomUUID().slice(0, 8)}`,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '1000.0000',
    });

    await expect(
      serviceRequestsAccess.create(actor, {
        unitId: UNIT_A,
        originSource: SERVICE_REQUEST_ORIGINS.Email,
        clientId: client.id,
        externalContact: { email: 'draft-po@test.invalid' },
        description: 'PO ainda em rascunho',
        purchaseOrderId: draftPo.purchaseOrder.id,
      }),
    ).rejects.toMatchObject({
      code: REQUESTS_ERROR_CODES.PURCHASE_ORDER_INVALID_STATE,
    } satisfies Partial<RequestsHttpException>);
  });

  it('rejects purchase order client mismatch on service request', async () => {
    const { actor } = await seedActor();
    const clientA = await seedClient(actor);
    const clientB = await clientAccess.create(actor, {
      legalName: `Cliente B ${crypto.randomUUID()}`,
      tradeName: 'Cliente B',
      taxId: TEST_CNPJ_ALT,
      contacts: [
        {
          name: 'Contato B',
          purpose: CONTACT_PURPOSES.Operational,
          phone: '69999990001',
        },
      ],
    });

    const created = await purchaseOrdersAccess.create(actor, {
      clientId: clientA.id,
      unitId: UNIT_A,
      poNumber: `PO-${crypto.randomUUID().slice(0, 8)}`,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '1000.0000',
    });
    const registered = await purchaseOrdersAccess.register(actor, created.purchaseOrder.id, {
      rowVersion: created.purchaseOrder.rowVersion,
    });

    await expect(
      serviceRequestsAccess.create(actor, {
        unitId: UNIT_A,
        originSource: SERVICE_REQUEST_ORIGINS.Email,
        clientId: clientB.id,
        externalContact: { email: 'mismatch@test.invalid' },
        description: 'Cliente diferente do PO',
        purchaseOrderId: registered.purchaseOrder.id,
      }),
    ).rejects.toMatchObject({
      code: REQUESTS_ERROR_CODES.PURCHASE_ORDER_CLIENT_MISMATCH,
    } satisfies Partial<RequestsHttpException>);
  });

  it('blocks purchase order cancel when linked to an active service request', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);

    const created = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: `PO-${crypto.randomUUID().slice(0, 8)}`,
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '1000.0000',
    });
    const registered = await purchaseOrdersAccess.register(actor, created.purchaseOrder.id, {
      rowVersion: created.purchaseOrder.rowVersion,
    });

    await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      clientId: client.id,
      externalContact: { email: 'po-active@test.invalid' },
      description: 'Solicitação ativa com PO',
      purchaseOrderId: registered.purchaseOrder.id,
    });

    await expect(
      purchaseOrdersAccess.cancel(actor, registered.purchaseOrder.id, {
        rowVersion: registered.purchaseOrder.rowVersion,
        cancellationReason: 'Tentativa inválida',
      }),
    ).rejects.toMatchObject({
      code: COMMERCIAL_ERROR_CODES.PURCHASE_ORDER_IN_USE,
    } satisfies Partial<CommercialHttpException>);
  });

  it('returns scoped list summary counts by operational category', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);

    const submittedOnly = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      clientId: client.id,
      description: 'Aguardando triagem',
    });
    await serviceRequestsAccess.submit(actor, submittedOnly.serviceRequest.id, {
      rowVersion: submittedOnly.serviceRequest.rowVersion,
    });

    const reviewFlow = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Phone,
      clientId: client.id,
      description: 'Em análise operacional',
    });
    const reviewSubmitted = await serviceRequestsAccess.submit(actor, reviewFlow.serviceRequest.id, {
      rowVersion: reviewFlow.serviceRequest.rowVersion,
    });
    await serviceRequestsAccess.startReview(actor, reviewFlow.serviceRequest.id, {
      rowVersion: reviewSubmitted.serviceRequest.rowVersion,
    });

    const publishedService = await seedPublishedService(actor);
    const convertedFlow = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.DirectRequest,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Convertida em OS',
    });
    const convertedSubmitted = await serviceRequestsAccess.submit(actor, convertedFlow.serviceRequest.id, {
      rowVersion: convertedFlow.serviceRequest.rowVersion,
    });
    const convertedReview = await serviceRequestsAccess.startReview(actor, convertedFlow.serviceRequest.id, {
      rowVersion: convertedSubmitted.serviceRequest.rowVersion,
    });
    const convertedApproved = await serviceRequestsAccess.approve(actor, convertedFlow.serviceRequest.id, {
      rowVersion: convertedReview.serviceRequest.rowVersion,
    });
    await serviceRequestsAccess.convert(actor, convertedFlow.serviceRequest.id, {
      rowVersion: convertedApproved.serviceRequest.rowVersion,
    });

    const cancelledFlow = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Other,
      clientId: client.id,
      description: 'Cancelada',
    });
    await serviceRequestsAccess.cancel(actor, cancelledFlow.serviceRequest.id, {
      rowVersion: cancelledFlow.serviceRequest.rowVersion,
      cancellationReason: 'Sem interesse',
    });

    await serviceRequestsAccess.create(actor, {
      unitId: UNIT_B,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      clientId: client.id,
      description: 'Outra unidade',
    });

    const summary = await serviceRequestsAccess.summary(actor, { unitId: UNIT_A });

    expect(summary.total).toBe(4);
    expect(summary.pending).toBe(1);
    expect(summary.underReview).toBe(1);
    expect(summary.converted).toBe(1);
    expect(summary.cancelled).toBe(1);
  });

  it('records append-only transition history with actor and timestamps', async () => {
    const { actor, identityId } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedService(actor);

    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Contract,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Com histórico',
    });

    const submitted = await serviceRequestsAccess.submit(actor, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
    });
    const reviewed = await serviceRequestsAccess.startReview(actor, created.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    const approved = await serviceRequestsAccess.approve(actor, created.serviceRequest.id, {
      rowVersion: reviewed.serviceRequest.rowVersion,
      priority: SERVICE_REQUEST_PRIORITIES.High,
    });
    const converted = await serviceRequestsAccess.convert(actor, created.serviceRequest.id, {
      rowVersion: approved.serviceRequest.rowVersion,
    });

    const eventTypes = converted.historyEvents.map((event) => event.eventType);
    expect(eventTypes).toEqual([
      'CREATED',
      'SUBMITTED',
      'REVIEW_STARTED',
      'APPROVED',
      'CONVERTED',
    ]);
    expect(converted.historyEvents.every((event) => event.actorIdentityId === identityId)).toBe(true);
    expect(converted.historyEvents.every((event) => event.occurredAt)).toBeTruthy();

    const approvedEvent = converted.historyEvents.find((event) => event.eventType === 'APPROVED');
    expect(approvedEvent?.payload).toMatchObject({
      fromStatus: SERVICE_REQUEST_STATUSES.UnderReview,
      toStatus: SERVICE_REQUEST_STATUSES.Approved,
      priority: SERVICE_REQUEST_PRIORITIES.High,
    });
  });

  it('rejects submit when draft no longer has description or service', async () => {
    const { actor } = await seedActor();
    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      externalContact: { name: 'Sem demanda' },
      description: 'Será removida',
    });

    const cleared = await serviceRequestsAccess.updateDraft(actor, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
      description: null,
      serviceDefinitionId: null,
    });

    await expect(
      serviceRequestsAccess.submit(actor, created.serviceRequest.id, {
        rowVersion: cleared.serviceRequest.rowVersion,
      }),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.VALIDATION_FAILED });
  });

  it('denies unauthorized convert of an approved request', async () => {
    const owner = await seedActor();
    const client = await seedClient(owner.actor);
    const publishedService = await seedPublishedService(owner.actor);
    const created = await serviceRequestsAccess.create(owner.actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.DirectRequest,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Convertida só por autoridade operacional',
    });
    const submitted = await serviceRequestsAccess.submit(owner.actor, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
    });
    const underReview = await serviceRequestsAccess.startReview(owner.actor, created.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    const approved = await serviceRequestsAccess.approve(owner.actor, created.serviceRequest.id, {
      rowVersion: underReview.serviceRequest.rowVersion,
    });

    const intruderLogin = normalizeLoginIdentifier(`sr-noconvert-${crypto.randomUUID()}@cisne.invalid`);
    const { identityId: intruderId } = await insertIdentity(
      pool,
      intruderLogin,
      await hashPassword(AUTH_TEST_PASSWORD),
    );
    await insertGrant(pool, {
      identityId: intruderId,
      action: AUTHZ_ACTIONS.RequestsServiceRequestRead,
      resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: owner.identityId,
    });

    await expect(
      serviceRequestsAccess.convert(
        { identityId: intruderId, sessionId: 'sid' },
        created.serviceRequest.id,
        { rowVersion: approved.serviceRequest.rowVersion },
      ),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.DENIED });
  });

  it('rejects invalid state transitions across the lifecycle', async () => {
    const { actor } = await seedActor();
    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      externalContact: { name: 'Ana' },
      description: 'Transições inválidas',
    });

    await expect(
      serviceRequestsAccess.approve(actor, created.serviceRequest.id, {
        rowVersion: created.serviceRequest.rowVersion,
      }),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.INVALID_STATE });

    const submitted = await serviceRequestsAccess.submit(actor, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
    });

    await expect(
      serviceRequestsAccess.convert(actor, created.serviceRequest.id, {
        rowVersion: submitted.serviceRequest.rowVersion,
      }),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.INVALID_STATE });

    const reviewed = await serviceRequestsAccess.startReview(actor, created.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    const approved = await serviceRequestsAccess.approve(actor, created.serviceRequest.id, {
      rowVersion: reviewed.serviceRequest.rowVersion,
    });

    await expect(
      serviceRequestsAccess.submit(actor, created.serviceRequest.id, {
        rowVersion: approved.serviceRequest.rowVersion,
      }),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.INVALID_STATE });
  });

  it('does not reserve physical assets during service request intake', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const created = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Whatsapp,
      clientId: client.id,
      externalContact: { phone: '69999990001', name: 'Cliente' },
      description: 'Sem reserva antecipada',
    });
    const submitted = await serviceRequestsAccess.submit(actor, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
    });
    const reviewed = await serviceRequestsAccess.startReview(actor, created.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    await serviceRequestsAccess.approve(actor, created.serviceRequest.id, {
      rowVersion: reviewed.serviceRequest.rowVersion,
    });

    const allocationCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM res.resource_allocations ra
       INNER JOIN so.service_orders so ON so.id = ra.service_order_id
       WHERE so.service_request_id = $1`,
      [created.serviceRequest.id],
    );
    expect(allocationCount.rows[0]?.count).toBe('0');
  });
});

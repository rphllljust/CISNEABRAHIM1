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
import { PROPOSAL_ACCEPTANCE_ORIGINS, PROPOSAL_PRICING_STRUCTURES } from '../commercial/domain/proposal';
import { PURCHASE_ORDER_PRICING_STRUCTURES } from '../commercial/domain/purchase-order';
import { ProposalsAccessService } from '../commercial/services/proposals-access.service';
import { PurchaseOrdersAccessService } from '../commercial/services/purchase-orders-access.service';
import {
  SERVICE_REQUEST_ORIGINS,
  SERVICE_REQUEST_STATUSES,
} from '../requests/domain/service-request';
import { RequestsModule } from '../requests/requests.module';
import { ServiceRequestsAccessService } from '../requests/services/service-requests-access.service';
import { SERVICE_ORDER_ORIGINS, SERVICE_ORDER_STATUSES } from './domain/service-order';
import { SERVICE_ORDERS_ERROR_CODES } from './errors/service-orders-error-codes';
import { ServiceOrdersModule } from './service-orders.module';
import { ServiceOrdersAccessService } from './services/service-orders-access.service';

const UNIT_A = 'unit-so-a';
const TEST_CNPJ = '11222333000181';
const TEST_CNPJ_ALT = '19131243000197';

async function grantServiceOrderAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderUpdate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCancel,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderReopen,
    AUTHZ_ACTIONS.RequestsServiceRequestCreate,
    AUTHZ_ACTIONS.RequestsServiceRequestRead,
    AUTHZ_ACTIONS.RequestsServiceRequestUpdate,
    AUTHZ_ACTIONS.RequestsServiceRequestSubmit,
    AUTHZ_ACTIONS.RequestsServiceRequestReview,
    AUTHZ_ACTIONS.RequestsServiceRequestApprove,
    AUTHZ_ACTIONS.RequestsServiceRequestCancel,
    AUTHZ_ACTIONS.RequestsServiceRequestConvert,
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.ClientDeactivate,
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServicePublish,
    AUTHZ_ACTIONS.CommercialProposalCreate,
    AUTHZ_ACTIONS.CommercialProposalRead,
    AUTHZ_ACTIONS.CommercialProposalIssue,
    AUTHZ_ACTIONS.CommercialProposalAccept,
    AUTHZ_ACTIONS.CommercialPurchaseOrderCreate,
    AUTHZ_ACTIONS.CommercialPurchaseOrderRead,
    AUTHZ_ACTIONS.CommercialPurchaseOrderRegister,
  ];

  for (const action of actions) {
    const resourceType = action.startsWith('service-orders:')
      ? AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder
      : action.startsWith('requests:')
        ? AUTHZ_RESOURCE_TYPES.RequestsServiceRequest
        : action.startsWith('client:')
          ? AUTHZ_RESOURCE_TYPES.Client
          : action.startsWith('catalog:')
            ? AUTHZ_RESOURCE_TYPES.CatalogService
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

describe('Service orders PostgreSQL integration', () => {
  let pool: Pool;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let serviceRequestsAccess: ServiceRequestsAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  let proposalsAccess: ProposalsAccessService;
  let purchaseOrdersAccess: PurchaseOrdersAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for service order integration tests.');
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
        ServiceOrdersModule,
        RequestsModule,
      ],
    }).compile();

    serviceOrdersAccess = module.get(ServiceOrdersAccessService);
    serviceRequestsAccess = module.get(ServiceRequestsAccessService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
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
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor() {
    const login = normalizeLoginIdentifier(`so-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantServiceOrderAdmin(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedClient(
    actor: { identityId: string; sessionId: string },
    taxId: string = TEST_CNPJ,
  ) {
    return clientAccess.create(actor, {
      legalName: `Cliente SO ${crypto.randomUUID()}`,
      tradeName: 'Cliente SO',
      taxId,
      contacts: [
        {
          name: 'Contato',
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
      code: `SO-SRV-${suffix}`,
      name: 'Serviço OS',
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

  async function approveRequest(
    actor: { identityId: string; sessionId: string },
    serviceRequestId: string,
    rowVersion: number,
  ) {
    const submitted = await serviceRequestsAccess.submit(actor, serviceRequestId, { rowVersion });
    const underReview = await serviceRequestsAccess.startReview(actor, serviceRequestId, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    return serviceRequestsAccess.approve(actor, serviceRequestId, {
      rowVersion: underReview.serviceRequest.rowVersion,
    });
  }

  it('creates DRAFT service order with client and service snapshot', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedService(actor);

    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'OS direta autorizada',
    });

    expect(created.status).toBe(SERVICE_ORDER_STATUSES.Draft);
    expect(created.orderNumber).toMatch(/^OS-/);
    expect(created.internalCode).toMatch(/^SO-INT-/);
    expect(created.clientSnapshot?.['clientId']).toBe(client.id);
    expect(created.serviceSnapshot?.['serviceCode']).toBe(publishedService.code);
    expect(created.serviceSnapshot?.['catalogVersion']).toBe(1);
    expect(created.historyEvents.some((event) => event.eventType === 'CREATED')).toBe(true);
  });

  it('converts approved service request atomically with references', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedService(actor);

    const proposal = await proposalsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Proposta OS',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: '5000.0000',
    });
    const issued = await proposalsAccess.issue(
      actor,
      proposal.proposal.id,
      1,
      proposal.currentVersion!.rowVersion,
    );
    const accepted = await proposalsAccess.accept(actor, proposal.proposal.id, 1, {
      rowVersion: issued.rowVersion,
      acceptanceOriginCode: PROPOSAL_ACCEPTANCE_ORIGINS.InternalApproval,
    });

    const purchaseOrder = await purchaseOrdersAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      poNumber: `PO-${crypto.randomUUID().slice(0, 8)}`,
      rcNumber: 'RC-001',
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '3000.0000',
    });
    const registered = await purchaseOrdersAccess.register(actor, purchaseOrder.purchaseOrder.id, {
      rowVersion: purchaseOrder.purchaseOrder.rowVersion,
    });

    const request = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.ProposalAcceptance,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      proposalId: accepted.proposalId,
      purchaseOrderId: registered.purchaseOrder.id,
      description: 'Converter',
    });
    const approved = await approveRequest(actor, request.serviceRequest.id, request.serviceRequest.rowVersion);

    const converted = await serviceRequestsAccess.convert(actor, request.serviceRequest.id, {
      rowVersion: approved.serviceRequest.rowVersion,
    });
    expect(converted.serviceRequest.status).toBe(SERVICE_REQUEST_STATUSES.Converted);

    const order = await serviceOrdersAccess.getById(actor, converted.serviceRequest.convertedServiceOrderId!);
    expect(order.origin).toBe(SERVICE_ORDER_ORIGINS.ServiceRequest);
    expect(order.proposalSnapshot?.['proposalId']).toBe(proposal.proposal.id);
    expect(order.purchaseOrderSnapshot?.['purchaseOrderId']).toBe(registered.purchaseOrder.id);
    expect(order.rcNumber).toBe('RC-001');
    expect(order.serviceSnapshot?.['serviceCode']).toBe(publishedService.code);
  });

  it('prevents double conversion under concurrency', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedService(actor);
    const request = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.DirectRequest,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Race',
    });
    const approved = await approveRequest(actor, request.serviceRequest.id, request.serviceRequest.rowVersion);

    const results = await Promise.allSettled([
      serviceRequestsAccess.convert(actor, request.serviceRequest.id, {
        rowVersion: approved.serviceRequest.rowVersion,
      }),
      serviceRequestsAccess.convert(actor, request.serviceRequest.id, {
        rowVersion: approved.serviceRequest.rowVersion,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const orders = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM so.service_orders WHERE service_request_id = $1`,
      [request.serviceRequest.id],
    );
    expect(orders.rows[0]?.count).toBe('1');
  });

  it('blocks cancelled request conversion and preserves approved state on failure', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const request = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Other,
      clientId: client.id,
      description: 'Sem serviço',
    });
    const submitted = await serviceRequestsAccess.submit(actor, request.serviceRequest.id, {
      rowVersion: request.serviceRequest.rowVersion,
    });
    const underReview = await serviceRequestsAccess.startReview(actor, request.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    const approved = await serviceRequestsAccess.approve(actor, request.serviceRequest.id, {
      rowVersion: underReview.serviceRequest.rowVersion,
    });

    await expect(
      serviceRequestsAccess.convert(actor, request.serviceRequest.id, {
        rowVersion: approved.serviceRequest.rowVersion,
      }),
    ).rejects.toBeDefined();

    const stillApproved = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM sr.service_requests WHERE id = $1`,
      [request.serviceRequest.id],
    );
    expect(stillApproved.rows[0]?.status).toBe(SERVICE_REQUEST_STATUSES.Approved);

    const cancelled = await serviceRequestsAccess.cancel(actor, request.serviceRequest.id, {
      rowVersion: approved.serviceRequest.rowVersion,
      cancellationReason: 'Desistência',
    });
    await expect(
      serviceRequestsAccess.convert(actor, request.serviceRequest.id, {
        rowVersion: cancelled.serviceRequest.rowVersion,
      }),
    ).rejects.toBeDefined();
  });

  it('creates from proposal and purchase order origins with snapshots', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedService(actor);

    const proposal = await proposalsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Proposta origem',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: '5000.0000',
    });
    const issued = await proposalsAccess.issue(
      actor,
      proposal.proposal.id,
      1,
      proposal.currentVersion!.rowVersion,
    );
    const accepted = await proposalsAccess.accept(actor, proposal.proposal.id, 1, {
      rowVersion: issued.rowVersion,
      acceptanceOriginCode: PROPOSAL_ACCEPTANCE_ORIGINS.InternalApproval,
    });

    const fromProposal = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.Proposal,
      unitId: UNIT_A,
      clientId: client.id,
      proposalId: accepted.proposalId,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
    });
    expect(fromProposal.proposalSnapshot?.['proposalId']).toBe(proposal.proposal.id);

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

    const fromPo = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.PurchaseOrder,
      unitId: UNIT_A,
      clientId: client.id,
      purchaseOrderId: registered.purchaseOrder.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
    });
    expect(fromPo.purchaseOrderSnapshot?.['purchaseOrderId']).toBe(registered.purchaseOrder.id);
  });

  it('records security audit on create and denies unauthorized read', async () => {
    const { actor, identityId } = await seedActor();
    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      description: 'Auditável',
    });

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [created.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderCreate,
    );

    const otherLogin = normalizeLoginIdentifier(`so-deny-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: otherId } = await insertIdentity(pool, otherLogin, passwordHash);
    void identityId;

    await expect(
      serviceOrdersAccess.getById({ identityId: otherId, sessionId: 'sid' }, created.id),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.DENIED });
  });

  async function createDraftWithService(
    actor: { identityId: string; sessionId: string },
    taxId: string = TEST_CNPJ,
  ) {
    const client = await seedClient(actor, taxId);
    const publishedService = await seedPublishedService(actor);
    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'OS para transição',
    });
    return { client, publishedService, created };
  }

  it('denies release from DRAFT without client after prepare', async () => {
    const { actor } = await seedActor();
    const publishedService = await seedPublishedService(actor);
    const created = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
    });
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    await expect(
      serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.CLIENT_REQUIRED });
  });

  it('denies update with nonexistent client', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);
    await expect(
      serviceOrdersAccess.update(actor, created.id, {
        rowVersion: created.rowVersion,
        clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.CLIENT_NOT_FOUND });
  });

  it('denies create against an inactive client', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedService(actor);
    await clientAccess.deactivate(actor, client.id, client.version, 'Inativo');

    await expect(
      serviceOrdersAccess.create(actor, {
        origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
        unitId: UNIT_A,
        clientId: client.id,
        serviceDefinitionId: publishedService.serviceDefinitionId,
        serviceDefinitionVersionId: publishedService.id,
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.CLIENT_INACTIVE });
  });

  it('denies release for inactive client', async () => {
    const { actor } = await seedActor();
    const { client, created } = await createDraftWithService(actor);
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    await clientAccess.deactivate(actor, client.id, client.version, 'Inativo');
    await expect(
      serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.CLIENT_INACTIVE });
  });

  it('releases PREPARED order with active client and records history and audit', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    const released = await serviceOrdersAccess.release(actor, prepared.id, {
      rowVersion: prepared.rowVersion,
    });

    expect(released.status).toBe(SERVICE_ORDER_STATUSES.Released);
    expect(released.releasedAt).not.toBeNull();
    expect(created.createdByIdentityId).toBe(actor.identityId);
    expect(released.releasedByIdentityId).toBe(actor.identityId);
    expect(released.createdByIdentityId).toBe(released.releasedByIdentityId);
    expect(released.historyEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['CREATED', 'PREPARED', 'RELEASED']),
    );

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [released.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderRelease,
    );
  });

  it('denies unauthorized release', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    const otherLogin = normalizeLoginIdentifier(`so-release-deny-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: otherId } = await insertIdentity(pool, otherLogin, passwordHash);

    await expect(
      serviceOrdersAccess.release({ identityId: otherId, sessionId: 'sid' }, prepared.id, {
        rowVersion: prepared.rowVersion,
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.DENIED });
  });

  it('returns VERSION_CONFLICT on stale row version', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);
    await serviceOrdersAccess.update(actor, created.id, {
      rowVersion: created.rowVersion,
      description: 'Atualizada',
    });
    await expect(
      serviceOrdersAccess.update(actor, created.id, {
        rowVersion: created.rowVersion,
        description: 'Conflito',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.VERSION_CONFLICT });
  });

  it('prevents duplicate release effects', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    const released = await serviceOrdersAccess.release(actor, prepared.id, {
      rowVersion: prepared.rowVersion,
    });
    await expect(
      serviceOrdersAccess.release(actor, released.id, { rowVersion: released.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    const history = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM so.service_order_history_events
       WHERE service_order_id = $1 AND event_type = 'RELEASED'`,
      [released.id],
    );
    expect(history.rows[0]?.count).toBe('1');
  });

  it('resolves release versus cancel race deterministically', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });

    const results = await Promise.allSettled([
      serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion }),
      serviceOrdersAccess.cancel(actor, prepared.id, {
        rowVersion: prepared.rowVersion,
        cancellationReason: 'Concorrência',
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const row = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM so.service_orders WHERE id = $1`,
      [prepared.id],
    );
    expect(['RELEASED', 'CANCELLED']).toContain(row.rows[0]?.status);
  });

  it('resolves update versus release race deterministically', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });

    const results = await Promise.allSettled([
      serviceOrdersAccess.release(actor, prepared.id, { rowVersion: prepared.rowVersion }),
      serviceOrdersAccess.update(actor, prepared.id, {
        rowVersion: prepared.rowVersion,
        description: 'Atualização concorrente',
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('blocks critical field updates in PREPARED', async () => {
    const { actor } = await seedActor();
    const { client, created } = await createDraftWithService(actor);
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    await expect(
      serviceOrdersAccess.update(actor, prepared.id, {
        rowVersion: prepared.rowVersion,
        clientId: client.id,
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.IMMUTABLE_CRITICAL_FIELD });
  });

  it('lists service orders with scope, status and stable pagination', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const publishedService = await seedPublishedService(actor);

    const first = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Primeira OS',
    });
    const second = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Segunda OS',
    });

    const page = await serviceOrdersAccess.list(actor, {
      limit: 1,
      offset: 0,
      status: SERVICE_ORDER_STATUSES.Draft,
      clientId: client.id,
      unitId: UNIT_A,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(second.id);
    expect(page.limit).toBe(1);
    expect(page.offset).toBe(0);

    const nextPage = await serviceOrdersAccess.list(actor, {
      limit: 1,
      offset: 1,
      status: SERVICE_ORDER_STATUSES.Draft,
      clientId: client.id,
      unitId: UNIT_A,
    });
    expect(nextPage.items[0]?.id).toBe(first.id);
  });

  it('denies list without list grant', async () => {
    const { actor, identityId } = await seedActor();
    await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      description: 'Protegida',
    });

    const otherLogin = normalizeLoginIdentifier(`so-list-deny-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: otherId } = await insertIdentity(pool, otherLogin, passwordHash);
    await insertGrant(pool, {
      identityId: otherId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
    void identityId;

    await expect(
      serviceOrdersAccess.list({ identityId: otherId, sessionId: 'sid' }, { limit: 20, offset: 0 }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.DENIED });
  });

  it('records prepare transition with history and security audit', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);

    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });

    expect(prepared.status).toBe(SERVICE_ORDER_STATUSES.Prepared);
    expect(prepared.preparedAt).not.toBeNull();
    expect(prepared.historyEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['CREATED', 'PREPARED']),
    );

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [prepared.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderPrepare,
    );
  });

  it('cancels from DRAFT and RELEASED with history and security audit', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);

    const cancelledFromDraft = await serviceOrdersAccess.cancel(actor, created.id, {
      rowVersion: created.rowVersion,
      cancellationReason: 'Desistência operacional',
    });
    expect(cancelledFromDraft.status).toBe(SERVICE_ORDER_STATUSES.Cancelled);
    expect(cancelledFromDraft.cancelledAt).not.toBeNull();
    expect(cancelledFromDraft.historyEvents.map((event) => event.eventType)).toContain('CANCELLED');

    let audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [created.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderCancel,
    );

    const { created: second } = await createDraftWithService(actor, TEST_CNPJ_ALT);
    const prepared = await serviceOrdersAccess.prepare(actor, second.id, {
      rowVersion: second.rowVersion,
    });
    const released = await serviceOrdersAccess.release(actor, prepared.id, {
      rowVersion: prepared.rowVersion,
    });
    const cancelledFromReleased = await serviceOrdersAccess.cancel(actor, released.id, {
      rowVersion: released.rowVersion,
      cancellationReason: 'Liberação revertida',
    });
    expect(cancelledFromReleased.status).toBe(SERVICE_ORDER_STATUSES.Cancelled);

    audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [released.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderCancel,
    );
  });

  it('reopens a cancelled service order with mandatory justification and audit', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);
    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    const released = await serviceOrdersAccess.release(actor, prepared.id, {
      rowVersion: prepared.rowVersion,
    });
    const cancelled = await serviceOrdersAccess.cancel(actor, released.id, {
      rowVersion: released.rowVersion,
      cancellationReason: 'Liberação revertida',
    });

    const otherLogin = normalizeLoginIdentifier(`so-reopen-deny-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: otherId } = await insertIdentity(pool, otherLogin, passwordHash);

    await expect(
      serviceOrdersAccess.reopen({ identityId: otherId, sessionId: 'sid' }, cancelled.id, {
        rowVersion: cancelled.rowVersion,
        reopenReason: 'Tentativa sem autoridade máxima.',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.DENIED });

    await expect(
      serviceOrdersAccess.reopen(actor, cancelled.id, {
        rowVersion: cancelled.rowVersion,
        reopenReason: '   ',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.REOPEN_JUSTIFICATION_REQUIRED });

    const reopened = await serviceOrdersAccess.reopen(actor, cancelled.id, {
      rowVersion: cancelled.rowVersion,
      reopenReason: 'Cliente confirmou execução e a OS precisa voltar ao fluxo.',
    });
    expect(reopened.status).toBe(SERVICE_ORDER_STATUSES.Released);
    expect(reopened.reopenedByIdentityId).toBe(actor.identityId);
    expect(reopened.reopenReason).toContain('Cliente confirmou');
    expect(reopened.historyEvents.map((event) => event.eventType)).toContain('REOPENED');

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [cancelled.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderReopen,
    );
  });

  it('rejects invalid lifecycle transitions from wrong states', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);

    await expect(
      serviceOrdersAccess.release(actor, created.id, { rowVersion: created.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    await expect(
      serviceOrdersAccess.prepare(actor, prepared.id, { rowVersion: prepared.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    const released = await serviceOrdersAccess.release(actor, prepared.id, {
      rowVersion: prepared.rowVersion,
    });
    const cancelled = await serviceOrdersAccess.cancel(actor, released.id, {
      rowVersion: released.rowVersion,
      cancellationReason: 'Cancelada',
    });
    await expect(
      serviceOrdersAccess.cancel(actor, cancelled.id, {
        rowVersion: cancelled.rowVersion,
        cancellationReason: 'Duplicada',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });
  });

  it('returns VERSION_CONFLICT on stale prepare rowVersion', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);
    await serviceOrdersAccess.update(actor, created.id, {
      rowVersion: created.rowVersion,
      description: 'Atualizada antes de preparar',
    });

    await expect(
      serviceOrdersAccess.prepare(actor, created.id, { rowVersion: created.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.VERSION_CONFLICT });
  });

  it('denies unauthorized prepare and cancel', async () => {
    const { actor } = await seedActor();
    const { created } = await createDraftWithService(actor);
    const otherLogin = normalizeLoginIdentifier(`so-transition-deny-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: otherId } = await insertIdentity(pool, otherLogin, passwordHash);
    const otherActor = { identityId: otherId, sessionId: 'sid' };

    await expect(
      serviceOrdersAccess.prepare(otherActor, created.id, { rowVersion: created.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.DENIED });

    const prepared = await serviceOrdersAccess.prepare(actor, created.id, {
      rowVersion: created.rowVersion,
    });
    await expect(
      serviceOrdersAccess.cancel(otherActor, prepared.id, {
        rowVersion: prepared.rowVersion,
        cancellationReason: 'Sem permissão',
      }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.DENIED });

    await expect(
      serviceOrdersAccess.release(otherActor, prepared.id, { rowVersion: prepared.rowVersion }),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.DENIED });
  });
});

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
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
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
import { SERVICE_REQUEST_ORIGINS, SERVICE_REQUEST_PRIORITIES } from './domain/service-request';
import { REQUESTS_ERROR_CODES } from './errors/requests-error-codes';
import { RequestsModule } from './requests.module';
import { ServiceRequestsAccessService } from './services/service-requests-access.service';
import { RequestsHttpException } from './errors/requests-http.exception';

/**
 * Fila operacional e workbench da solicitacao — provas contra o banco de teste real.
 *
 * Nao ha mock de PDP nem de grants: o ator e um usuario restrito de verdade com as concessoes que
 * o teste escolher. O que se prova e o resultado observavel (o que aparece e o que NAO aparece).
 */
const UNIT_A = 'unit-workbench-a';
const TEST_CNPJ = '11222333000181';

const READ_ONLY_ACTIONS = [
  AUTHZ_ACTIONS.RequestsServiceRequestRead,
  AUTHZ_ACTIONS.RequestsServiceRequestList,
];

/** Concessoes de apoio que os dados de teste exigem (cliente e catalogo). */
const SUPPORT_GRANTS = [
  { action: AUTHZ_ACTIONS.ClientCreate, resourceType: AUTHZ_RESOURCE_TYPES.Client },
  { action: AUTHZ_ACTIONS.ClientRead, resourceType: AUTHZ_RESOURCE_TYPES.Client },
  { action: AUTHZ_ACTIONS.CatalogServiceCreate, resourceType: AUTHZ_RESOURCE_TYPES.CatalogService },
  { action: AUTHZ_ACTIONS.CatalogServiceRead, resourceType: AUTHZ_RESOURCE_TYPES.CatalogService },
  { action: AUTHZ_ACTIONS.CatalogServicePublish, resourceType: AUTHZ_RESOURCE_TYPES.CatalogService },
  {
    action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
  },
];

const FULL_ACTIONS = [
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

describe('Service request workbench — fila operacional, prontidao e cadeia autorizada', () => {
  let module: TestingModule;
  let pool: Pool;
  let serviceRequestsAccess: ServiceRequestsAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for service request workbench tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    module = await Test.createTestingModule({
      imports: [AuditModule, AuthorizationModule, ClientsModule, CatalogModule, CommercialModule, RequestsModule],
    }).compile();
    serviceRequestsAccess = module.get(ServiceRequestsAccessService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterAll(async () => {
    await pool.end();
    await module.close();
  });

  beforeEach(async () => {
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateCommercialProposalTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
  });

  async function seedActor(
    actions: string[] = FULL_ACTIONS,
    extra: Array<{ action: string; resourceType: string }> = SUPPORT_GRANTS,
  ) {
    const login = normalizeLoginIdentifier(`wb-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    for (const action of actions) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }
    for (const grant of extra) {
      await insertGrant(pool, {
        identityId,
        action: grant.action,
        resourceType: grant.resourceType,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }
    return { identityId, sessionId: 'sid' };
  }

  async function seedClient(actor: { identityId: string; sessionId: string }) {
    return clientAccess.create(actor, {
      legalName: `Cliente Workbench ${crypto.randomUUID()}`,
      tradeName: 'Cliente Workbench',
      taxId: TEST_CNPJ,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });
  }

  async function seedPublishedService(actor: { identityId: string; sessionId: string }) {
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, { code: `CAT-${suffix}`, name: 'Serviços' });
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

  it('filtra a fila por prioridade, origem, busca e janela desejada no backend', async () => {
    const actor = await seedActor();
    const client = await seedClient(actor);

    const urgent = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      clientId: client.id,
      description: 'Troca de compressor',
      desiredStartAt: '2026-05-10T12:00:00.000Z',
    });
    const normal = await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Whatsapp,
      clientId: client.id,
      description: 'Limpeza de caixa d’água',
      desiredStartAt: '2026-06-20T12:00:00.000Z',
    });
    await serviceRequestsAccess.create(actor, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Phone,
      clientId: client.id,
      description: 'Pintura de fachada',
      externalOriginReference: 'OC-7788',
    });

    // Prioridade so existe depois da aprovacao (regra do dominio) — usa o caminho real.
    await serviceRequestsAccess.submit(actor, urgent.serviceRequest.id, {
      rowVersion: urgent.serviceRequest.rowVersion,
    });
    const submitted = await serviceRequestsAccess.list(actor, { limit: 20, offset: 0, search: 'compressor' });
    const urgentRow = submitted.items[0]!;
    const reviewed = await serviceRequestsAccess.startReview(actor, urgentRow.id, {
      rowVersion: urgentRow.rowVersion,
    });
    await serviceRequestsAccess.approve(actor, urgentRow.id, {
      rowVersion: reviewed.serviceRequest.rowVersion,
      priority: SERVICE_REQUEST_PRIORITIES.Urgent,
    });
    await serviceRequestsAccess.submit(actor, normal.serviceRequest.id, {
      rowVersion: normal.serviceRequest.rowVersion,
    });

    const byPriority = await serviceRequestsAccess.list(actor, {
      limit: 20,
      offset: 0,
      priority: SERVICE_REQUEST_PRIORITIES.Urgent,
    });
    expect(byPriority.items).toHaveLength(1);
    expect(byPriority.items[0]?.description).toBe('Troca de compressor');

    const byOrigin = await serviceRequestsAccess.list(actor, {
      limit: 20,
      offset: 0,
      originSource: SERVICE_REQUEST_ORIGINS.Whatsapp,
    });
    expect(byOrigin.items).toHaveLength(1);
    expect(byOrigin.items[0]?.description).toBe('Limpeza de caixa d’água');

    const byReference = await serviceRequestsAccess.list(actor, {
      limit: 20,
      offset: 0,
      search: 'OC-7788',
    });
    expect(byReference.items).toHaveLength(1);
    expect(byReference.items[0]?.description).toBe('Pintura de fachada');

    const byWindow = await serviceRequestsAccess.list(actor, {
      limit: 20,
      offset: 0,
      desiredFrom: '2026-06-01T00:00:00.000Z',
      desiredTo: '2026-06-30T00:00:00.000Z',
    });
    expect(byWindow.items).toHaveLength(1);
    expect(byWindow.items[0]?.description).toBe('Limpeza de caixa d’água');

    const noMatch = await serviceRequestsAccess.list(actor, {
      limit: 20,
      offset: 0,
      search: 'inexistente-zzz',
    });
    expect(noMatch.items).toHaveLength(0);
  });

  it('ordena por allowlist, mantendo o padrao seguro e rejeitando ordenacao fora da lista', async () => {
    const actor = await seedActor();
    const client = await seedClient(actor);

    for (const description of ['primeira', 'segunda', 'terceira']) {
      await serviceRequestsAccess.create(actor, {
        unitId: UNIT_A,
        originSource: SERVICE_REQUEST_ORIGINS.Email,
        clientId: client.id,
        description,
      });
    }

    const defaultOrder = await serviceRequestsAccess.list(actor, { limit: 20, offset: 0 });
    expect(defaultOrder.items).toHaveLength(3);
    const createdAtOrder = await serviceRequestsAccess.list(actor, {
      limit: 20,
      offset: 0,
      sort: 'createdAt',
      direction: 'asc',
    });
    expect(createdAtOrder.items.map((item) => item.description)).toEqual([
      'primeira',
      'segunda',
      'terceira',
    ]);

    const desiredAsc = await serviceRequestsAccess.list(actor, {
      limit: 20,
      offset: 0,
      sort: 'desiredStartAt',
      direction: 'asc',
    });
    expect(desiredAsc.items).toHaveLength(3);

    await expect(
      serviceRequestsAccess.list(actor, {
        limit: 20,
        offset: 0,
        sort: 'description; DROP TABLE sr.service_requests' as never,
      }),
    ).rejects.toBeInstanceOf(RequestsHttpException);
    await expect(
      serviceRequestsAccess.list(actor, {
        limit: 20,
        offset: 0,
        direction: 'sideways' as never,
      }),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.VALIDATION_FAILED });
  });

  it('enriquece a fila com o nome do cliente somente quando o modulo CLIENTES autoriza', async () => {
    const admin = await seedActor();
    const client = await seedClient(admin);
    const created = await serviceRequestsAccess.create(admin, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      clientId: client.id,
      description: 'Com cliente nomeado',
    });

    const authorized = await seedActor(FULL_ACTIONS);
    const withName = await serviceRequestsAccess.list(authorized, { limit: 20, offset: 0 });
    expect(withName.items[0]?.clientName).toBe('Cliente Workbench');

    // Mesma solicitacao, ator com leitura de solicitacao mas SEM leitura de cliente.
    const restricted = await seedActor(READ_ONLY_ACTIONS, []);
    const withoutName = await serviceRequestsAccess.list(restricted, { limit: 20, offset: 0 });
    expect(withoutName.items).toHaveLength(1);
    expect(withoutName.items[0]?.id).toBe(created.serviceRequest.id);
    expect(withoutName.items[0]?.clientName).toBeNull();

    const detail = await serviceRequestsAccess.getById(restricted, created.serviceRequest.id);
    expect(detail.serviceRequest.clientId).toBe(client.id);
    expect(detail.related.client).toBeNull();
  });

  it('deriva proximo passo e bloqueios das regras reais, sem oferecer transicao nao autorizada', async () => {
    const admin = await seedActor();
    const client = await seedClient(admin);

    // O cadastro exige descricao OU servico; o bloqueio aparece quando o rascunho perde a
    // demanda — a mesma pre-condicao que `validateSubmitReady` impoe ao envio.
    const emptied = await serviceRequestsAccess.create(admin, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      externalContact: { name: 'Contato' },
      description: 'Demanda provisoria',
    });
    await serviceRequestsAccess.updateDraft(admin, emptied.serviceRequest.id, {
      rowVersion: emptied.serviceRequest.rowVersion,
      description: null,
    });
    const draft = await serviceRequestsAccess.getById(admin, emptied.serviceRequest.id);
    expect(draft.readiness.blockers).toContain('DESCRIPTION_OR_SERVICE_REQUIRED');
    // O passo continua sendo o do estado (enviar); o bloqueio real e informado separadamente.
    expect(draft.readiness.nextStep).toBe('SUBMIT_REQUEST');
    expect(draft.readiness.availableTransitions).toContain('cancel');
    await expect(
      serviceRequestsAccess.submit(admin, emptied.serviceRequest.id, {
        rowVersion: draft.serviceRequest.rowVersion,
      }),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.VALIDATION_FAILED });

    const ready = await serviceRequestsAccess.create(admin, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      clientId: client.id,
      description: 'Pronta para enviar',
    });
    const readyDetail = await serviceRequestsAccess.getById(admin, ready.serviceRequest.id);
    expect(readyDetail.readiness.blockers).toEqual([]);
    expect(readyDetail.readiness.nextStep).toBe('SUBMIT_REQUEST');
    expect(readyDetail.readiness.nextStepTransition).toBe('submit');

    // Ator de leitura pura: ve o detalhe e o proximo passo do estado, mas nao recebe acao.
    const reader = await seedActor(READ_ONLY_ACTIONS, []);
    const readerDetail = await serviceRequestsAccess.getById(reader, ready.serviceRequest.id);
    expect(readerDetail.readiness.availableTransitions).toEqual([]);
    expect(readerDetail.readiness.nextStepTransition).toBeNull();
    expect(readerDetail.readiness.nextStep).toBe('SUBMIT_REQUEST');
    expect(readerDetail.historyEvents.map((event) => event.eventType)).toContain('CREATED');
  });

  it('expoe apenas os elos da cadeia que o ator pode ler no modulo dono', async () => {
    const admin = await seedActor(FULL_ACTIONS, SUPPORT_GRANTS);
    const client = await seedClient(admin);
    const publishedService = await seedPublishedService(admin);
    const created = await serviceRequestsAccess.create(admin, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Contract,
      externalOriginReference: 'CT-WORKBENCH-1',
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Conversão com cadeia',
    });

    const submitted = await serviceRequestsAccess.submit(admin, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
    });
    const reviewed = await serviceRequestsAccess.startReview(admin, created.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    const approved = await serviceRequestsAccess.approve(admin, created.serviceRequest.id, {
      rowVersion: reviewed.serviceRequest.rowVersion,
    });
    const converted = await serviceRequestsAccess.convert(admin, created.serviceRequest.id, {
      rowVersion: approved.serviceRequest.rowVersion,
    });

    const adminDetail = await serviceRequestsAccess.getById(admin, created.serviceRequest.id);
    const serviceOrderLink = adminDetail.linkedChain.find((link) => link.kind === 'SERVICE_ORDER');
    expect(serviceOrderLink).toBeDefined();
    expect(serviceOrderLink?.id).toBe(converted.serviceRequest.convertedServiceOrderId);
    expect(serviceOrderLink?.label).toMatch(/^OS-/);
    expect(adminDetail.readiness.nextStep).toBe('OPEN_SERVICE_ORDER');
    expect(adminDetail.readiness.nextStepTransition).toBeNull();

    // O vinculo existe no banco, mas o ator nao le o modulo ORDENS DE SERVICO.
    const restricted = await seedActor(READ_ONLY_ACTIONS, []);
    const restrictedDetail = await serviceRequestsAccess.getById(restricted, created.serviceRequest.id);
    expect(restrictedDetail.serviceRequest.convertedServiceOrderId).toBe(
      converted.serviceRequest.convertedServiceOrderId,
    );
    expect(restrictedDetail.linkedChain).toEqual([]);
    expect(JSON.stringify(restrictedDetail)).not.toContain(serviceOrderLink!.label);
  });

  it('preserva o conflito de versao nas acoes do workbench', async () => {
    const admin = await seedActor();
    const client = await seedClient(admin);
    const created = await serviceRequestsAccess.create(admin, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      clientId: client.id,
      description: 'Conflito de versao',
    });

    await serviceRequestsAccess.submit(admin, created.serviceRequest.id, {
      rowVersion: created.serviceRequest.rowVersion,
    });

    await expect(
      serviceRequestsAccess.submit(admin, created.serviceRequest.id, {
        rowVersion: created.serviceRequest.rowVersion,
      }),
    ).rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.INVALID_STATE });
  });
});

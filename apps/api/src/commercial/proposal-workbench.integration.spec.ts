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
import { CommercialModule } from './commercial.module';
import { COMMERCIAL_ERROR_CODES } from './errors/commercial-error-codes';
import { CommercialHttpException } from './errors/commercial-http.exception';
import { PROPOSAL_PRICING_STRUCTURES, PROPOSAL_VERSION_STATUSES } from './domain/proposal';
import { ProposalsAccessService } from './services/proposals-access.service';
import { DocumentsModule } from '../documents/documents.module';
import { RequestsModule } from '../requests/requests.module';
import { ServiceRequestsAccessService } from '../requests/services/service-requests-access.service';
import { SERVICE_REQUEST_ORIGINS } from '../requests/domain/service-request';

/**
 * Workbench comercial da proposta — provas contra o banco de teste real.
 *
 * Sem mock de PDP ou de grants: o ator e um usuario restrito de verdade com as concessoes que o
 * teste escolher. O que se prova e o resultado observavel (o que aparece e o que NAO aparece).
 */
const UNIT_A = 'unit-wb-a';
const TEST_CNPJ = '11222333000181';

const PROPOSAL_READ = [
  AUTHZ_ACTIONS.CommercialProposalRead,
  AUTHZ_ACTIONS.CommercialProposalList,
];

const PROPOSAL_FULL = [
  AUTHZ_ACTIONS.CommercialProposalCreate,
  AUTHZ_ACTIONS.CommercialProposalRead,
  AUTHZ_ACTIONS.CommercialProposalList,
  AUTHZ_ACTIONS.CommercialProposalUpdate,
  AUTHZ_ACTIONS.CommercialProposalIssue,
  AUTHZ_ACTIONS.CommercialProposalAccept,
  AUTHZ_ACTIONS.CommercialProposalReject,
  AUTHZ_ACTIONS.CommercialProposalExpire,
  AUTHZ_ACTIONS.CommercialProposalCancel,
];

const SUPPORT_GRANTS = [
  { action: AUTHZ_ACTIONS.ClientCreate, resourceType: AUTHZ_RESOURCE_TYPES.Client },
  { action: AUTHZ_ACTIONS.ClientRead, resourceType: AUTHZ_RESOURCE_TYPES.Client },
  { action: AUTHZ_ACTIONS.CatalogServiceRead, resourceType: AUTHZ_RESOURCE_TYPES.CatalogService },
  {
    action: AUTHZ_ACTIONS.DocumentsDocumentRead,
    resourceType: AUTHZ_RESOURCE_TYPES.DocumentsDocument,
  },
];

describe('Proposal commercial workbench — fila, revisoes, cadeia e prontidao', () => {
  let module: TestingModule;
  let pool: Pool;
  let proposalsAccess: ProposalsAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  let serviceRequestsAccess: ServiceRequestsAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for proposal workbench tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    module = await Test.createTestingModule({
      imports: [
        AuditModule,
        AuthorizationModule,
        ClientsModule,
        CatalogModule,
        DocumentsModule,
        RequestsModule,
        CommercialModule,
      ],
    }).compile();
    proposalsAccess = module.get(ProposalsAccessService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    serviceRequestsAccess = module.get(ServiceRequestsAccessService);
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
    actions: string[] = PROPOSAL_FULL,
    extra: Array<{ action: string; resourceType: string }> = SUPPORT_GRANTS,
  ) {
    const login = normalizeLoginIdentifier(`wb-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    for (const action of actions) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }
    const seen = new Set<string>();
    for (const grant of extra) {
      const key = `${grant.resourceType}:${grant.action}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
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

  function amount(value: string) {
    return value;
  }

  it('filtra a fila comercial por situacao, validade, periodo de criacao e busca', async () => {
    const actor = await seedActor();
    const client = await seedClient(actor);

    const issued = await proposalsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Proposta emitida para filtro',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: amount('10000.0000'),
      validUntil: '2026-06-30T12:00:00.000Z',
    });
    await proposalsAccess.issue(actor, issued.proposal.id, 1, issued.currentVersion!.rowVersion);

    const draft = await proposalsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Rascunho aguardando composição',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: amount('20000.0000'),
      validUntil: '2026-08-31T12:00:00.000Z',
    });
    void draft;

    const byStatus = await proposalsAccess.list(actor, {
      limit: 20,
      offset: 0,
      status: PROPOSAL_VERSION_STATUSES.Issued,
    });
    expect(byStatus.items).toHaveLength(1);
    expect(byStatus.items[0]?.title).toBe('Proposta emitida para filtro');
    expect(byStatus.items[0]?.currentVersionStatus).toBe(PROPOSAL_VERSION_STATUSES.Issued);

    const byValidity = await proposalsAccess.list(actor, {
      limit: 20,
      offset: 0,
      validFrom: '2026-07-01T00:00:00.000Z',
      validTo: '2026-09-30T00:00:00.000Z',
    });
    expect(byValidity.items).toHaveLength(1);
    expect(byValidity.items[0]?.title).toBe('Rascunho aguardando composição');

    const bySearch = await proposalsAccess.list(actor, {
      limit: 20,
      offset: 0,
      search: 'aguardando composição',
    });
    expect(bySearch.items).toHaveLength(1);
    expect(bySearch.items[0]?.title).toBe('Rascunho aguardando composição');

    const byCreatedFrom = await proposalsAccess.list(actor, {
      limit: 20,
      offset: 0,
      createdFrom: new Date(Date.now() - 60_000).toISOString(),
      createdTo: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(byCreatedFrom.items).toHaveLength(2);

    const byCode = await proposalsAccess.list(actor, {
      limit: 20,
      offset: 0,
      search: issued.proposal.proposalCode,
    });
    expect(byCode.items).toHaveLength(1);
  });

  it('ordena por allowlist e rejeita ordenacao fora da lista', async () => {
    const actor = await seedActor();
    const client = await seedClient(actor);

    for (const [title, price, validity] of [
      ['Menor valor', '1000.0000', '2026-12-31T00:00:00.000Z'],
      ['Maior valor', '9000.0000', '2026-03-31T00:00:00.000Z'],
    ] as const) {
      await proposalsAccess.create(actor, {
        clientId: client.id,
        unitId: UNIT_A,
        title,
        pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
        globalSalePrice: price,
        validUntil: validity,
      });
    }

    const byValueAsc = await proposalsAccess.list(actor, {
      limit: 20,
      offset: 0,
      sort: 'value',
      direction: 'asc',
    });
    expect(byValueAsc.items.map((item) => item.title)).toEqual(['Menor valor', 'Maior valor']);

    const byValidityAsc = await proposalsAccess.list(actor, {
      limit: 20,
      offset: 0,
      sort: 'validUntil',
      direction: 'asc',
    });
    expect(byValidityAsc.items[0]?.title).toBe('Maior valor');

    const byRevisionAsc = await proposalsAccess.list(actor, {
      limit: 20,
      offset: 0,
      sort: 'revision',
      direction: 'asc',
    });
    expect(byRevisionAsc.items).toHaveLength(2);

    await expect(
      proposalsAccess.list(actor, {
        limit: 20,
        offset: 0,
        sort: 'title; DROP TABLE com.proposals' as never,
      }),
    ).rejects.toBeInstanceOf(CommercialHttpException);
    await expect(
      proposalsAccess.list(actor, {
        limit: 20,
        offset: 0,
        direction: 'sideways' as never,
      }),
    ).rejects.toMatchObject({ code: COMMERCIAL_ERROR_CODES.VALIDATION_FAILED });
  });

  it('enriquece a fila com o cliente apenas quando o modulo CLIENTES autoriza', async () => {
    const admin = await seedActor();
    const client = await seedClient(admin);
    await proposalsAccess.create(admin, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Com cliente nomeado',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: amount('5000.0000'),
    });

    const authorized = await seedActor(PROPOSAL_FULL, [
      ...SUPPORT_GRANTS,
      { action: AUTHZ_ACTIONS.ClientRead, resourceType: AUTHZ_RESOURCE_TYPES.Client },
    ]);
    const withName = await proposalsAccess.list(authorized, { limit: 20, offset: 0 });
    expect(withName.items[0]?.clientName).toBe('Cliente Workbench');

    // Mesma proposta, ator com leitura comercial mas SEM leitura de cliente.
    const restricted = await seedActor(PROPOSAL_READ, []);
    const withoutName = await proposalsAccess.list(restricted, { limit: 20, offset: 0 });
    expect(withoutName.items).toHaveLength(1);
    expect(withoutName.items[0]?.clientName).toBeNull();

    const detail = await proposalsAccess.getById(restricted, withName.items[0]!.id);
    expect(detail.related.client).toBeNull();
  });

  it('mantem revisoes, aponta a vigente e calcula a comparacao entre as duas ultimas', async () => {
    const actor = await seedActor();
    const client = await seedClient(actor);

    const created = await proposalsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Proposta com revisões',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.Itemized,
      currencyCode: 'BRL',
      validUntil: '2026-05-31T00:00:00.000Z',
      items: [
        {
          lineNumber: 1,
          itemKind: 'SERVICE',
          description: 'Escavação',
          quantity: '10',
          unitCode: 'SERVICE',
          lineSaleAmount: '1000.0000',
        },
      ],
    });
    const issued = await proposalsAccess.issue(actor, created.proposal.id, 1, 1);
    expect(issued.status).toBe(PROPOSAL_VERSION_STATUSES.Issued);

    const revision = await proposalsAccess.createRevision(actor, created.proposal.id);
    expect(revision.currentVersion?.versionNumber).toBe(2);
    expect(revision.currentVersion?.status).toBe(PROPOSAL_VERSION_STATUSES.Draft);

    // A revisao 2 nasce como copia da 1; o teste altera valor e acrescenta uma linha.
    await proposalsAccess.updateDraft(actor, created.proposal.id, 2, {
      rowVersion: revision.currentVersion!.rowVersion,
      validUntil: '2026-07-31T00:00:00.000Z',
      items: [
        {
          lineNumber: 1,
          itemKind: 'SERVICE',
          description: 'Escavação',
          quantity: '10',
          unitCode: 'SERVICE',
          lineSaleAmount: '1500.0000',
        },
        {
          lineNumber: 2,
          itemKind: 'TRANSPORT',
          description: 'Mobilização',
          quantity: '1',
          unitCode: 'EVT',
          lineSaleAmount: '250.0000',
        },
      ],
    });

    // A substituicao da revisao anterior acontece na EMISSAO da nova revisao (regra do backend).
    const issuedRevision = await proposalsAccess.issue(
      actor,
      created.proposal.id,
      2,
      revision.currentVersion!.rowVersion + 1,
    );
    expect(issuedRevision.status).toBe(PROPOSAL_VERSION_STATUSES.Issued);

    const detail = await proposalsAccess.getById(actor, created.proposal.id);
    expect(detail.revisions).toHaveLength(2);
    const currentRevision = detail.revisions.find((entry) => entry.isCurrent);
    expect(currentRevision?.versionNumber).toBe(2);
    expect(currentRevision?.supersedesVersionNumber).toBe(1);
    const previousRevision = detail.revisions.find((entry) => entry.versionNumber === 1);
    expect(previousRevision?.supersededAt).not.toBeNull();

    expect(detail.revisionComparison).not.toBeNull();
    expect(detail.revisionComparison?.fromRevisionNumber).toBe(1);
    expect(detail.revisionComparison?.toRevisionNumber).toBe(2);
    const validityField = detail.revisionComparison?.fields.find(
      (field) => field.field === 'validUntil',
    );
    expect(new Date(validityField!.before!).toISOString()).toBe('2026-05-31T00:00:00.000Z');
    expect(new Date(validityField!.after!).toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(detail.revisionComparison?.totals.linesAdded).toBe(1);
    expect(detail.revisionComparison?.totals.linesChanged).toBe(1);
  });

  it('deriva pronto para emitir, bloqueios reais e transicoes autorizadas', async () => {
    const actor = await seedActor();
    const client = await seedClient(actor);

    const blocked = await proposalsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Sem preço global',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
    });
    const blockedDetail = await proposalsAccess.getById(actor, blocked.proposal.id);
    expect(blockedDetail.readiness.blockers).toContain('GLOBAL_SALE_PRICE_REQUIRED');
    expect(blockedDetail.readiness.nextStep).toBe('COMPLETE_AND_ISSUE');
    expect(blockedDetail.readiness.availableTransitions).toContain('issue');
    expect(blockedDetail.readiness.nextStepTransition).toBe('issue');
    await expect(
      proposalsAccess.issue(actor, blocked.proposal.id, 1, blockedDetail.currentVersion!.rowVersion),
    ).rejects.toMatchObject({ code: COMMERCIAL_ERROR_CODES.VALIDATION_FAILED });

    const issued = await proposalsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Pronta para emitir',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: amount('7000.0000'),
    });
    const issuedDetail = await proposalsAccess.getById(actor, issued.proposal.id);
    expect(issuedDetail.readiness.blockers).toEqual([]);
    expect(issuedDetail.readiness.nextStepTransition).toBe('issue');

    // Ator de leitura pura: ve o detalhe e o proximo passo, mas nao recebe acao alguma.
    const reader = await seedActor(PROPOSAL_READ, []);
    const readerDetail = await proposalsAccess.getById(reader, issued.proposal.id);
    expect(readerDetail.readiness.availableTransitions).toEqual([]);
    expect(readerDetail.readiness.nextStepTransition).toBeNull();
    expect(readerDetail.readiness.nextStep).toBe('COMPLETE_AND_ISSUE');

    // Depois da emissao o proximo passo passa a ser a decisao do cliente.
    await proposalsAccess.issue(actor, issued.proposal.id, 1, issuedDetail.currentVersion!.rowVersion);
    const afterIssue = await proposalsAccess.getById(actor, issued.proposal.id);
    expect(afterIssue.readiness.nextStep).toBe('AWAIT_CLIENT_DECISION');
    expect(afterIssue.readiness.nextStepTransition).toBe('accept');
    expect(afterIssue.readiness.availableTransitions).toContain('reject');
  });

  it('expoe na cadeia apenas os elos autorizados pelo modulo dono', async () => {
    const admin = await seedActor(PROPOSAL_FULL, [
      ...SUPPORT_GRANTS,
      { action: AUTHZ_ACTIONS.ClientRead, resourceType: AUTHZ_RESOURCE_TYPES.Client },
      {
        action: AUTHZ_ACTIONS.CatalogServiceRead,
        resourceType: AUTHZ_RESOURCE_TYPES.CatalogService,
      },
      {
        action: AUTHZ_ACTIONS.CatalogServiceCreate,
        resourceType: AUTHZ_RESOURCE_TYPES.CatalogService,
      },
      {
        action: AUTHZ_ACTIONS.CatalogServicePublish,
        resourceType: AUTHZ_RESOURCE_TYPES.CatalogService,
      },
      {
        action: AUTHZ_ACTIONS.RequestsServiceRequestCreate,
        resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      },
      {
        action: AUTHZ_ACTIONS.RequestsServiceRequestRead,
        resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      },
      {
        action: AUTHZ_ACTIONS.RequestsServiceRequestList,
        resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      },
      {
        action: AUTHZ_ACTIONS.RequestsServiceRequestSubmit,
        resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      },
      {
        action: AUTHZ_ACTIONS.RequestsServiceRequestReview,
        resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      },
      {
        action: AUTHZ_ACTIONS.RequestsServiceRequestApprove,
        resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      },
      {
        action: AUTHZ_ACTIONS.RequestsServiceRequestConvert,
        resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      },
      {
        action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      },
    ]);
    const client = await seedClient(admin);
    const publishedService = await seedPublishedService(admin);

    const proposal = await proposalsAccess.create(admin, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Proposta que vira operação',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: amount('30000.0000'),
    });
    await proposalsAccess.issue(admin, proposal.proposal.id, 1, proposal.currentVersion!.rowVersion);

    // A solicitacao aponta para a proposta; a conversao em OS leva o vinculo adiante.
    const request = await serviceRequestsAccess.create(admin, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.ProposalAcceptance,
      clientId: client.id,
      serviceDefinitionId: publishedService.serviceDefinitionId,
      serviceDefinitionVersionId: publishedService.id,
      description: 'Execução da proposta aceita',
      proposalId: proposal.proposal.id,
    });
    const submitted = await serviceRequestsAccess.submit(admin, request.serviceRequest.id, {
      rowVersion: request.serviceRequest.rowVersion,
    });
    const reviewed = await serviceRequestsAccess.startReview(admin, request.serviceRequest.id, {
      rowVersion: submitted.serviceRequest.rowVersion,
    });
    const approved = await serviceRequestsAccess.approve(admin, request.serviceRequest.id, {
      rowVersion: reviewed.serviceRequest.rowVersion,
    });
    const converted = await serviceRequestsAccess.convert(admin, request.serviceRequest.id, {
      rowVersion: approved.serviceRequest.rowVersion,
    });

    expect(converted.serviceRequest.convertedServiceOrderId).not.toBeNull();

    const adminDetail = await proposalsAccess.getById(admin, proposal.proposal.id);
    const kinds = adminDetail.linkedChain.map((link) => link.kind);
    expect(kinds).toContain('REQUEST');
    expect(kinds).toContain('SERVICE_ORDER');
    const originLink = adminDetail.linkedChain.find((link) => link.kind === 'REQUEST');
    expect(originLink?.label).toBe(request.serviceRequest.requestCode);
    expect(adminDetail.hiddenLinkedRecords).toBe(false);
    expect(adminDetail.readiness.nextStep).toBe('AWAIT_CLIENT_DECISION');

    // Mesmo vinculo, ator sem leitura de solicitacao nem de OS: nada de numero/status vaza.
    const restricted = await seedActor(PROPOSAL_READ, []);
    const restrictedDetail = await proposalsAccess.getById(restricted, proposal.proposal.id);
    expect(restrictedDetail.linkedChain).toEqual([]);
    expect(restrictedDetail.hiddenLinkedRecords).toBe(true);
    expect(JSON.stringify(restrictedDetail)).not.toContain(request.serviceRequest.requestCode);
  });

  it('preserva o conflito de versao nas acoes comerciais', async () => {
    const actor = await seedActor();
    const client = await seedClient(actor);
    const created = await proposalsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Conflito de versão',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: amount('4000.0000'),
    });

    await proposalsAccess.issue(
      actor,
      created.proposal.id,
      1,
      created.currentVersion!.rowVersion,
    );

    await expect(
      proposalsAccess.updateDraft(actor, created.proposal.id, 1, {
        rowVersion: created.currentVersion!.rowVersion,
        title: 'Edição concorrente',
      }),
    ).rejects.toMatchObject({ code: COMMERCIAL_ERROR_CODES.INVALID_STATE });
  });
});

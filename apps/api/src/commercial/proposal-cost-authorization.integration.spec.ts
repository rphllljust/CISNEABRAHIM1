import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateCatalogTables,
  truncateClientTables,
  truncateCommercialProposalTables,
  truncateIdentityAndAuthorizationTables,
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
import { ClientsModule } from '../clients/clients.module';
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { ClientAccessService } from '../clients/services/client-access.service';
import { RequestsModule } from '../requests/requests.module';
import { ServiceRequestsAccessService } from '../requests/services/service-requests-access.service';
import { SERVICE_REQUEST_ORIGINS } from '../requests/domain/service-request';
import { CommercialModule } from './commercial.module';
import { PROPOSAL_PRICING_STRUCTURES } from './domain/proposal';
import { ProposalsAccessService } from './services/proposals-access.service';

/**
 * PROJECAO DE CUSTO INTERNO COMERCIAL DA PROPOSTA — politica aplicada.
 *
 * Capacidade: `commercial:proposal:read-cost` (resource `commercial:proposal`).
 *
 * `commercial:proposal:read` autoriza os dados comerciais (valor de venda, moeda, itens, validade,
 * revisao, status e relacoes autorizadas) e NAO autoriza custo interno. A visibilidade de custo e
 * resolvida pela mesma trilha autoritativa das demais acoes (PDP + grants + contexto da proposta:
 * recurso, unidade e cliente) e aplicada no BACKEND, antes da serializacao final.
 *
 * Mascara canonica: o campo continua na forma da resposta com `null` quando o ator nao tem
 * visibilidade — mesma semantica de `analytics/operational-profitability`. O dado sensivel nunca e
 * montado no JSON.
 */
const UNIT_A = 'unit-cost-a';
const UNIT_B = 'unit-cost-b';
const TEST_CNPJ = '11222333000181';

const COST_FIELDS = [
  'globalInternalCost',
  'itemsInternalCostTotal',
  'unitInternalCost',
  'lineInternalCost',
] as const;

/** Campos de custo que aparecem COM VALOR (nao nulos) em qualquer ponto do payload. */
function exposedCostFields(payload: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if ((COST_FIELDS as readonly string[]).includes(key) && value !== null && value !== undefined) {
          found.add(key);
        }
        visit(value);
      }
    }
  };
  visit(payload ?? null);
  return [...found].sort();
}

describe('Proposal internal cost projection — politica commercial:proposal:read-cost', () => {
  let module: TestingModule;
  let pool: Pool;
  let proposalsAccess: ProposalsAccessService;
  let clientAccess: ClientAccessService;
  let serviceRequestsAccess: ServiceRequestsAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for proposal cost projection tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    module = await Test.createTestingModule({
      imports: [AuditModule, AuthorizationModule, ClientsModule, RequestsModule, CommercialModule],
    }).compile();
    proposalsAccess = module.get(ProposalsAccessService);
    clientAccess = module.get(ClientAccessService);
    serviceRequestsAccess = module.get(ServiceRequestsAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterAll(async () => {
    await pool.end();
    await module.close();
  });

  beforeEach(async () => {
    await truncateCommercialProposalTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
  });

  type GrantSpec = { action: string; resourceType: string; unitId?: string; clientId?: string };

  async function seedActor(grants: GrantSpec[]) {
    const login = normalizeLoginIdentifier(`cost-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    for (const spec of grants) {
      await insertGrant(pool, {
        identityId,
        action: spec.action,
        resourceType: spec.resourceType,
        scopeType: spec.clientId
          ? AUTHZ_SCOPES.Client
          : spec.unitId
            ? AUTHZ_SCOPES.Unit
            : AUTHZ_SCOPES.Global,
        resourceId: spec.clientId ?? spec.unitId,
        grantedByIdentityId: identityId,
      });
    }
    return { identityId, sessionId: 'sid' };
  }

  const PROPOSAL_RESOURCE = AUTHZ_RESOURCE_TYPES.CommercialProposal;
  const proposalGrant = (action: string, unitId?: string, clientId?: string): GrantSpec => ({
    action,
    resourceType: PROPOSAL_RESOURCE,
    unitId,
    clientId,
  });

  const PROPOSAL_READ_ONLY: GrantSpec[] = [proposalGrant(AUTHZ_ACTIONS.CommercialProposalRead)];
  const PROPOSAL_MODULE: GrantSpec[] = [
    proposalGrant(AUTHZ_ACTIONS.CommercialProposalRead),
    proposalGrant(AUTHZ_ACTIONS.CommercialProposalList),
    proposalGrant(AUTHZ_ACTIONS.CommercialProposalCreate),
    proposalGrant(AUTHZ_ACTIONS.CommercialProposalUpdate),
    proposalGrant(AUTHZ_ACTIONS.CommercialProposalIssue),
    proposalGrant(AUTHZ_ACTIONS.CommercialProposalAccept),
    { action: AUTHZ_ACTIONS.ClientCreate, resourceType: AUTHZ_RESOURCE_TYPES.Client },
    { action: AUTHZ_ACTIONS.ClientRead, resourceType: AUTHZ_RESOURCE_TYPES.Client },
  ];

  /** Proposta por itens com preco de venda E custo interno gravados nas duas pontas. */
  async function seedProposalWithInternalCost() {
    const admin = await seedActor(PROPOSAL_MODULE);
    const client = await clientAccess.create(admin, {
      legalName: `Cliente Custo ${crypto.randomUUID()}`,
      tradeName: 'Cliente Custo',
      taxId: TEST_CNPJ,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });
    const created = await proposalsAccess.create(admin, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Proposta com custo interno',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.Itemized,
      currencyCode: 'BRL',
      globalInternalCost: '6000.0000',
      items: [
        {
          lineNumber: 1,
          itemKind: 'SERVICE',
          description: 'Escavação',
          quantity: '10',
          unitCode: 'SERVICE',
          unitSalePrice: '1000.0000',
          unitInternalCost: '700.0000',
          lineSaleAmount: '10000.0000',
          lineInternalCost: '7000.0000',
        },
      ],
    });
    const issued = await proposalsAccess.issue(
      admin,
      created.proposal.id,
      1,
      created.currentVersion!.rowVersion,
    );
    expect(issued.status).toBe('ISSUED');
    return { admin, client, proposalId: created.proposal.id };
  }

  it('1. detalhe: proposal:read SEM read-cost le a proposta e nao recebe custo', async () => {
    const { proposalId } = await seedProposalWithInternalCost();
    const reader = await seedActor(PROPOSAL_READ_ONLY);

    const detail = await proposalsAccess.getById(reader, proposalId);

    // Dados comerciais permanecem legiveis.
    expect(detail.proposal.id).toBe(proposalId);
    expect(detail.currentVersion?.status).toBe('ISSUED');
    // Valor comercial de estrutura ITEMIZED vem da soma persistida das linhas.
    expect(Number(detail.currentVersion?.itemsSaleTotal)).toBe(10000);
    expect(detail.currentVersion?.currencyCode).toBe('BRL');
    expect(Number(detail.currentVersion?.items[0]?.lineSaleAmount)).toBe(10000);

    // Custo: presente na forma, ausente no valor.
    expect(exposedCostFields(detail)).toEqual([]);
    expect(detail.currentVersion?.globalInternalCost).toBeNull();
    expect(detail.currentVersion?.itemsInternalCostTotal).toBeNull();
    expect(detail.currentVersion?.items[0]?.unitInternalCost).toBeNull();
    expect(detail.currentVersion?.items[0]?.lineInternalCost).toBeNull();
  });

  it('2. detalhe: proposal:read COM read-cost no escopo da unidade recebe o custo', async () => {
    const { proposalId } = await seedProposalWithInternalCost();
    const authorized = await seedActor([
      ...PROPOSAL_READ_ONLY,
      proposalGrant(AUTHZ_ACTIONS.CommercialProposalReadCost, UNIT_A),
    ]);

    const detail = await proposalsAccess.getById(authorized, proposalId);

    expect(exposedCostFields(detail)).toEqual([...COST_FIELDS].sort());
    expect(Number(detail.currentVersion?.globalInternalCost)).toBe(6000);
    expect(Number(detail.currentVersion?.items[0]?.unitInternalCost)).toBe(700);
    expect(Number(detail.currentVersion?.items[0]?.lineInternalCost)).toBe(7000);
  });

  it('3. scope incompativel: read-cost em outra unidade ou cliente nao projeta custo', async () => {
    const { proposalId } = await seedProposalWithInternalCost();

    const wrongUnit = await seedActor([
      ...PROPOSAL_READ_ONLY,
      proposalGrant(AUTHZ_ACTIONS.CommercialProposalReadCost, UNIT_B),
    ]);
    const byUnit = await proposalsAccess.getById(wrongUnit, proposalId);
    expect(exposedCostFields(byUnit)).toEqual([]);
    expect(byUnit.currentVersion?.globalInternalCost).toBeNull();

    const wrongClient = await seedActor([
      ...PROPOSAL_READ_ONLY,
      proposalGrant(AUTHZ_ACTIONS.CommercialProposalReadCost, undefined, crypto.randomUUID()),
    ]);
    const byClient = await proposalsAccess.getById(wrongClient, proposalId);
    expect(exposedCostFields(byClient)).toEqual([]);
    expect(byClient.currentVersion?.globalInternalCost).toBeNull();
  });

  it('4. versoes: /versions e /versions/:n obedecem a mesma regra', async () => {
    const { proposalId } = await seedProposalWithInternalCost();
    const reader = await seedActor(PROPOSAL_READ_ONLY);
    const authorized = await seedActor([
      ...PROPOSAL_READ_ONLY,
      proposalGrant(AUTHZ_ACTIONS.CommercialProposalReadCost, UNIT_A),
    ]);

    expect(exposedCostFields(await proposalsAccess.listVersions(reader, proposalId))).toEqual([]);
    expect(exposedCostFields(await proposalsAccess.getVersion(reader, proposalId, 1))).toEqual([]);

    expect(exposedCostFields(await proposalsAccess.listVersions(authorized, proposalId))).toEqual(
      [...COST_FIELDS].sort(),
    );
    expect(exposedCostFields(await proposalsAccess.getVersion(authorized, proposalId, 1))).toEqual(
      [...COST_FIELDS].sort(),
    );
  });

  it('5. mutacao: emitir sem read-cost nao devolve custo na resposta', async () => {
    const { proposalId } = await seedProposalWithInternalCost();

    // Autorizado a LER e EMITIR, sem read-cost: mutar nao implica ver custo.
    const operator = await seedActor([
      proposalGrant(AUTHZ_ACTIONS.CommercialProposalRead),
      proposalGrant(AUTHZ_ACTIONS.CommercialProposalUpdate),
      proposalGrant(AUTHZ_ACTIONS.CommercialProposalIssue),
    ]);

    const revision = await proposalsAccess.createRevision(operator, proposalId);
    expect(revision.proposal.id).toBe(proposalId);
    expect(exposedCostFields(revision)).toEqual([]);

    const issued = await proposalsAccess.issue(
      operator,
      proposalId,
      revision.currentVersion!.versionNumber,
      revision.currentVersion!.rowVersion,
    );
    expect(issued.status).toBe('ISSUED');
    expect(exposedCostFields(issued)).toEqual([]);
    expect(issued.globalInternalCost).toBeNull();
    expect(issued.items[0]?.lineInternalCost).toBeNull();
  });

  it('6. lista: a fila comercial continua sem projecao de custo', async () => {
    const { proposalId } = await seedProposalWithInternalCost();
    const reader = await seedActor([
      ...PROPOSAL_READ_ONLY,
      proposalGrant(AUTHZ_ACTIONS.CommercialProposalList),
    ]);

    const list = await proposalsAccess.list(reader, { limit: 20, offset: 0 });
    expect(list.items.some((item) => item.id === proposalId)).toBe(true);
    expect(exposedCostFields(list)).toEqual([]);
  });

  it('7. elo nao autorizado: omissao silenciosa, sem metadata e sem declarar existencia', async () => {
    const admin = await seedActor([
      ...PROPOSAL_MODULE,
      {
        action: AUTHZ_ACTIONS.RequestsServiceRequestCreate,
        resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      },
    ]);
    const client = await clientAccess.create(admin, {
      legalName: `Cliente Vinculo ${crypto.randomUUID()}`,
      tradeName: 'Cliente Vinculo',
      taxId: TEST_CNPJ,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });
    const created = await proposalsAccess.create(admin, {
      clientId: client.id,
      unitId: UNIT_A,
      title: 'Proposta com origem vinculada',
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
      globalSalePrice: '4000.0000',
    });
    await proposalsAccess.issue(admin, created.proposal.id, 1, created.currentVersion!.rowVersion);

    const request = await serviceRequestsAccess.create(admin, {
      unitId: UNIT_A,
      originSource: SERVICE_REQUEST_ORIGINS.ProposalAcceptance,
      clientId: client.id,
      description: 'Origem da proposta',
      proposalId: created.proposal.id,
    });

    // Ator que le a proposta, mas NAO a solicitacao de origem.
    const reader = await seedActor(PROPOSAL_READ_ONLY);
    const detail = await proposalsAccess.getById(reader, created.proposal.id);
    const serialized = JSON.stringify(detail);

    expect(detail.linkedChain).toEqual([]);
    expect(serialized).not.toContain(request.serviceRequest.requestCode);
    expect(serialized).not.toContain(request.serviceRequest.id);
    // Ausencia de autorizacao nao vaza existencia da relacao.
    expect(serialized).not.toContain('hiddenLinkedRecords');
    expect(serialized).not.toContain('"hidden"');
  });
});

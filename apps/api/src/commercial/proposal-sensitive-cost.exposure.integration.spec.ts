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
import { CommercialModule } from './commercial.module';
import { PROPOSAL_PRICING_STRUCTURES } from './domain/proposal';
import { ProposalsAccessService } from './services/proposals-access.service';

/**
 * PROJECAO DE CUSTO/MARGEM DA PROPOSTA — prova de vazamento e caracterizacao do gap de politica.
 *
 * O que este arquivo faz: mede, contra o banco de teste real e com ator restrito de verdade, se os
 * campos de custo interno da proposta chegam ao JSON para quem tem APENAS `commercial:proposal:read`.
 *
 * IMPORTANTE — leia antes de alterar:
 * os testes 1 e 3 afirmam a PRESENCA dos campos de custo. Eles nao declaram que isso e correto:
 * eles DOCUMENTAM o comportamento atual (vazamento de projecao) enquanto nao existe regra de
 * autorizacao que governe custo comercial no CISNE. Quando a politica existir, estes asserts devem
 * ser INVERTIDOS (ausencia do campo) — nao "consertados" removendo o teste.
 *
 * Nenhuma capability nova foi inventada aqui: a unica acao de custo existente no CISNE e
 * `service-orders:operational-cost:read`, que pertence ao dominio ORDENS DE SERVICO e e provada
 * abaixo como NAO governante do custo comercial.
 */
const UNIT_A = 'unit-cost-a';
const TEST_CNPJ = '11222333000181';

const VERSION_COST_FIELDS = ['globalInternalCost', 'itemsInternalCostTotal'];
const ITEM_COST_FIELDS = ['unitInternalCost', 'lineInternalCost'];
const FORBIDDEN_DERIVED_FIELDS = ['margin', 'markup', 'marginAmount', 'markupPercent'];

function costFieldsFound(payload: unknown): string[] {
  const serialized = JSON.stringify(payload ?? null);
  return [...VERSION_COST_FIELDS, ...ITEM_COST_FIELDS, ...FORBIDDEN_DERIVED_FIELDS].filter((field) =>
    serialized.includes(`"${field}"`),
  );
}

describe('Proposal sensitive cost projection — estado atual e gap de politica', () => {
  let module: TestingModule;
  let pool: Pool;
  let proposalsAccess: ProposalsAccessService;
  let clientAccess: ClientAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for proposal cost projection tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    module = await Test.createTestingModule({
      imports: [AuditModule, AuthorizationModule, ClientsModule, CommercialModule],
    }).compile();
    proposalsAccess = module.get(ProposalsAccessService);
    clientAccess = module.get(ClientAccessService);
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
  });

  async function seedActor(actions: Array<{ action: string; resourceType: string }>) {
    const login = normalizeLoginIdentifier(`cost-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    for (const grant of actions) {
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

  const PROPOSAL_READ = {
    action: AUTHZ_ACTIONS.CommercialProposalRead,
    resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
  };
  const PROPOSAL_LIST = {
    action: AUTHZ_ACTIONS.CommercialProposalList,
    resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
  };
  const CLIENT_CREATE = {
    action: AUTHZ_ACTIONS.ClientCreate,
    resourceType: AUTHZ_RESOURCE_TYPES.Client,
  };
  const CLIENT_READ = {
    action: AUTHZ_ACTIONS.ClientRead,
    resourceType: AUTHZ_RESOURCE_TYPES.Client,
  };
  const OPERATIONAL_COST_READ = {
    action: AUTHZ_ACTIONS.ServiceOrdersOperationalCostRead,
    resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
  };

  /** Proposta por itens, com preco de venda E custo interno gravados nas duas pontas. */
  async function seedProposalWithInternalCost() {
    const admin = await seedActor([
      PROPOSAL_READ,
      PROPOSAL_LIST,
      CLIENT_CREATE,
      CLIENT_READ,
      {
        action: AUTHZ_ACTIONS.CommercialProposalCreate,
        resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
      },
      {
        action: AUTHZ_ACTIONS.CommercialProposalUpdate,
        resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
      },
      {
        action: AUTHZ_ACTIONS.CommercialProposalIssue,
        resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
      },
    ]);
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

  it('1. detalhe: ator com APENAS commercial:proposal:read recebe custo interno hoje (vazamento)', async () => {
    const { proposalId } = await seedProposalWithInternalCost();
    const reader = await seedActor([PROPOSAL_READ]);

    const detail = await proposalsAccess.getById(reader, proposalId);
    const found = costFieldsFound(detail);

    // Documentacao do estado ATUAL: sem politica de custo comercial, o campo vai no JSON.
    // Quando a politica existir, esta assercao deve virar `expect(found).toEqual([])`.
    expect(found).toEqual([...VERSION_COST_FIELDS, ...ITEM_COST_FIELDS]);
    // Grandezas conferidas para nao acoplar o teste ao formato decimal da projecao.
    expect(Number(detail.currentVersion?.globalInternalCost)).toBe(6000);
    expect(Number(detail.currentVersion?.items[0]?.unitInternalCost)).toBe(700);
    expect(Number(detail.currentVersion?.items[0]?.lineInternalCost)).toBe(7000);

    // Nao existe campo derivado de margem/markup em lugar nenhum da projecao.
    expect(FORBIDDEN_DERIVED_FIELDS.filter((field) => found.includes(field))).toEqual([]);
  });

  it('2. lista: a fila comercial NAO projeta custo interno', async () => {
    const { proposalId } = await seedProposalWithInternalCost();
    const reader = await seedActor([PROPOSAL_READ, PROPOSAL_LIST]);

    const list = await proposalsAccess.list(reader, { limit: 20, offset: 0 });
    expect(list.items.some((item) => item.id === proposalId)).toBe(true);
    expect(costFieldsFound(list)).toEqual([]);
  });

  it('3. versoes: GET /versions e /versions/:n tambem projetam custo para o leitor simples', async () => {
    const { proposalId } = await seedProposalWithInternalCost();
    const reader = await seedActor([PROPOSAL_READ]);

    const versions = await proposalsAccess.listVersions(reader, proposalId);
    expect(costFieldsFound(versions)).toEqual([...VERSION_COST_FIELDS, ...ITEM_COST_FIELDS]);

    const single = await proposalsAccess.getVersion(reader, proposalId, 1);
    expect(costFieldsFound(single)).toEqual([...VERSION_COST_FIELDS, ...ITEM_COST_FIELDS]);
  });

  it('4. a acao de custo existente (ORDENS DE SERVICO) nao governa o custo comercial', async () => {
    const { proposalId } = await seedProposalWithInternalCost();

    // Ator com a unica acao de custo existente no CISNE.
    const withOperationalCost = await seedActor([PROPOSAL_READ, OPERATIONAL_COST_READ]);
    const detail = await proposalsAccess.getById(withOperationalCost, proposalId);

    // Prova do descompasso semantico: a concessao NAO muda nada na projecao da proposta, porque
    // nenhuma regra do dominio comercial a consulta. Ela cobre custo operacional de OS, nao custo
    // comercial de proposta.
    expect(costFieldsFound(detail)).toEqual([...VERSION_COST_FIELDS, ...ITEM_COST_FIELDS]);
    expect(detail.proposal.id).toBe(proposalId);
  });
});

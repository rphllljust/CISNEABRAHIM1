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
  truncateCommercialContractTables,
  truncateBillingTables,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
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
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { ClientAccessService } from '../clients/services/client-access.service';
import { CommercialModule } from './commercial.module';
import { CONTRACT_STATUSES } from './domain/contract';
import { COMMERCIAL_ERROR_CODES } from './errors/commercial-error-codes';
import { ContractsAccessService } from './services/contracts-access.service';
import { ContractsOperationalValidationService } from './services/contracts-operational-validation.service';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { SERVICE_ORDER_ORIGINS } from '../service-orders/domain/service-order';
import { ServiceOrdersAccessService } from '../service-orders/services/service-orders-access.service';

const UNIT_A = 'unit-ctr-a';
const TEST_CNPJ = '11222333000181';
const TEST_CNPJ_ALT = '19131243000197';

async function grantContractAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.CommercialContractCreate,
    AUTHZ_ACTIONS.CommercialContractRead,
    AUTHZ_ACTIONS.CommercialContractList,
    AUTHZ_ACTIONS.CommercialContractUpdate,
    AUTHZ_ACTIONS.CommercialContractActivate,
    AUTHZ_ACTIONS.CommercialContractClose,
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.ClientDeactivate,
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServicePublish,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: action.startsWith('client:')
        ? AUTHZ_RESOURCE_TYPES.Client
        : action.startsWith('catalog:')
          ? AUTHZ_RESOURCE_TYPES.CatalogService
          : action.startsWith('service-orders:')
            ? AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder
            : AUTHZ_RESOURCE_TYPES.CommercialContract,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Commercial contracts PostgreSQL integration', () => {
  let pool: Pool;
  let contractsAccess: ContractsAccessService;
  let contractOperationalValidation: ContractsOperationalValidationService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for contract integration tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        AuthModule,
        AuditModule,
        AuthorizationModule,
        ClientsModule,
        CatalogModule,
        CommercialModule,
        ServiceOrdersModule,
      ],
    }).compile();

    contractsAccess = module.get(ContractsAccessService);
    contractOperationalValidation = module.get(ContractsOperationalValidationService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    serviceOrdersAccess = module.get(ServiceOrdersAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateBillingTables(pool);
    await truncateServiceOrderTables(pool);
    await truncateCommercialContractTables(pool);
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
    const login = normalizeLoginIdentifier(`ctr-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantContractAdmin(pool, identityId, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedClient(
    actor: { identityId: string; sessionId: string },
    label = 'Cliente',
    taxId = TEST_CNPJ,
  ) {
    return clientAccess.create(actor, {
      legalName: `${label} ${crypto.randomUUID()}`,
      tradeName: label,
      taxId,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });
  }

  async function seedPublishedService(actor: { identityId: string; sessionId: string }) {
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, { code: `CAT-${suffix}`, name: 'Serviços' });
    const draft = await catalogAccess.create(actor, {
      code: `SRV-${suffix}`,
      name: 'Serviço contratado',
      categoryId: category.categoryId,
      archetype: 'RENTAL',
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '1000.0000' }],
      resourceRequirements: [],
      laborRequirements: [],
      executionRequirements: [],
    });
    const definition = await catalogAccess.getDefinition(actor, draft.serviceDefinitionId);
    return catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);
  }

  async function createActiveContract(
    actor: { identityId: string; sessionId: string },
    clientId: string,
    contractNumber: string,
    validFrom = '2020-01-01',
    validTo: string | undefined = '2030-12-31',
  ) {
    const created = await contractsAccess.create(actor, {
      clientId,
      unitId: UNIT_A,
      contractNumber,
      title: 'Contrato operacional',
      scopeDescription: 'Escopo de serviços',
      validFrom,
      validTo,
      paymentTerms: '30 DDL',
      items: [],
    });
    return contractsAccess.activate(actor, created.contract.id, {
      rowVersion: created.contract.rowVersion,
    });
  }

  it('rejects operational use when contract is outside validity window', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const contractNumber = `CTR-EXP-${crypto.randomUUID().slice(0, 8)}`;
    const active = await createActiveContract(actor, client.id, contractNumber);

    await pool.query(`UPDATE com.contracts SET valid_to = '2020-12-31' WHERE id = $1`, [
      active.contract.id,
    ]);

    await expect(
      contractOperationalValidation.tryResolveContractForOperationalUse(client.id, contractNumber),
    ).rejects.toMatchObject({ code: COMMERCIAL_ERROR_CODES.CONTRACT_EXPIRED });
  });

  it('rejects operational use for wrong client', async () => {
    const { actor } = await seedActor();
    const clientA = await seedClient(actor, 'Cliente A');
    const clientB = await seedClient(actor, 'Cliente B', TEST_CNPJ_ALT);
    const contract = await createActiveContract(
      actor,
      clientA.id,
      `CTR-CLI-${crypto.randomUUID().slice(0, 8)}`,
    );

    const result = await contractOperationalValidation.tryResolveContractForOperationalUse(
      clientB.id,
      contract.contract.contractNumber,
    );
    expect(result).toBeNull();
  });

  it('rejects concurrent draft update with stale rowVersion', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const created = await contractsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      contractNumber: `CTR-CC-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Contrato concorrente',
      validFrom: '2020-01-01',
      validTo: '2030-12-31',
      items: [],
    });

    await contractsAccess.updateDraft(actor, created.contract.id, {
      rowVersion: created.contract.rowVersion,
      title: 'Primeira atualização',
    });

    await expect(
      contractsAccess.updateDraft(actor, created.contract.id, {
        rowVersion: created.contract.rowVersion,
        title: 'Atualização concorrente',
      }),
    ).rejects.toMatchObject({ code: COMMERCIAL_ERROR_CODES.CONTRACT_VERSION_CONFLICT });
  });

  it('rejects service order creation against closed contract without retroactive snapshot changes', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const published = await seedPublishedService(actor);
    const contractNumber = `CTR-CLOSED-${crypto.randomUUID().slice(0, 8)}`;
    const active = await createActiveContract(actor, client.id, contractNumber);

    const firstOrder = await serviceOrdersAccess.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT_A,
      clientId: client.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
      contractReference: contractNumber,
    });
    const originalSnapshot = firstOrder.contractSnapshot;

    const closed = await contractsAccess.close(actor, active.contract.id, {
      rowVersion: active.contract.rowVersion,
      closureReason: 'Encerramento operacional',
    });
    expect(closed.contract.status).toBe(CONTRACT_STATUSES.Closed);

    const unchanged = await serviceOrdersAccess.getById(actor, firstOrder.id);
    expect(unchanged.contractSnapshot).toEqual(originalSnapshot);

    await expect(
      serviceOrdersAccess.create(actor, {
        origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
        unitId: UNIT_A,
        clientId: client.id,
        serviceDefinitionId: published.serviceDefinitionId,
        serviceDefinitionVersionId: published.id,
        contractReference: contractNumber,
      }),
    ).rejects.toMatchObject({ code: COMMERCIAL_ERROR_CODES.CONTRACT_CLOSED });
  });

  it('rejects activation when the counterparty is inactive', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const created = await contractsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      contractNumber: `CTR-INACT-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Contrato com cliente inativo',
      validFrom: '2020-01-01',
      validTo: '2030-12-31',
      items: [],
    });

    await clientAccess.deactivate(actor, client.id, client.version, 'Cliente inativo');

    await expect(
      contractsAccess.activate(actor, created.contract.id, {
        rowVersion: created.contract.rowVersion,
      }),
    ).rejects.toMatchObject({ code: COMMERCIAL_ERROR_CODES.CLIENT_INACTIVE });
  });

  it('rejects concurrent activate with stale rowVersion', async () => {
    const { actor } = await seedActor();
    const client = await seedClient(actor);
    const created = await contractsAccess.create(actor, {
      clientId: client.id,
      unitId: UNIT_A,
      contractNumber: `CTR-ACT-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Ativação concorrente',
      validFrom: '2020-01-01',
      validTo: '2030-12-31',
      items: [],
    });

    await contractsAccess.activate(actor, created.contract.id, {
      rowVersion: created.contract.rowVersion,
    });

    await expect(
      contractsAccess.activate(actor, created.contract.id, {
        rowVersion: created.contract.rowVersion,
      }),
    ).rejects.toMatchObject({
      code: COMMERCIAL_ERROR_CODES.CONTRACT_INVALID_STATE,
    });
  });
});

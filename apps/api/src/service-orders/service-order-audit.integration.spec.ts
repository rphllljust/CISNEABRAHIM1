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
  truncatePhysicalAssetTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { applyAuthTestEnv, AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { CatalogModule } from '../catalog/catalog.module';
import { ServiceCatalogAccessService } from '../catalog/services/service-catalog-access.service';
import { ClientAccessService } from '../clients/services/client-access.service';
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { ClientsModule } from '../clients/clients.module';
import { ResourcesModule } from '../resources/resources.module';
import { SERVICE_ORDER_ORIGINS, SERVICE_ORDER_STATUSES } from './domain/service-order';
import { SERVICE_ORDERS_ERROR_CODES } from './errors/service-orders-error-codes';
import { ServiceOrdersModule } from './service-orders.module';
import { ServiceOrdersAccessService } from './services/service-orders-access.service';

/**
 * Integracao do canal AUDIT_TRAIL alimentado por service-orders.
 *
 * Prova que a trilha e gravada na MESMA transacao da mutacao: uma transicao
 * rejeitada nao deixa rastro, e comandos consecutivos formam cadeia rastreavel.
 */
const UNIT_A = 'unit-audit-a';
const TEST_CNPJ = '11222333000181';

type AuditLogRow = {
  tabela: string;
  acao: string;
  dados_antigos: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
  usuario_id: string;
  correlation_id: string;
  registro_id: string;
};

const SAMPLE_EXECUTION_REQUIREMENTS = [
  { requirementType: 'OBSERVATION' as const, requirementLevel: 'REQUIRED' as const },
];

async function grantAuditAdmin(pool: Pool, identityId: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
    AUTHZ_ACTIONS.ServiceOrdersServiceOrderCancel,
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.CatalogServiceCreate,
    AUTHZ_ACTIONS.CatalogServiceRead,
    AUTHZ_ACTIONS.CatalogServicePublish,
  ];

  for (const action of actions) {
    const resourceType = action.startsWith('service-orders:')
      ? AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder
      : action.startsWith('client:')
        ? AUTHZ_RESOURCE_TYPES.Client
        : AUTHZ_RESOURCE_TYPES.CatalogService;

    await insertGrant(pool, {
      identityId,
      action,
      resourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Service order audit trail PostgreSQL integration', () => {
  let pool: Pool;
  let serviceOrdersAccess: ServiceOrdersAccessService;
  let clientAccess: ClientAccessService;
  let catalogAccess: ServiceCatalogAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for service order audit integration tests.');
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
        ResourcesModule,
        ServiceOrdersModule,
      ],
    }).compile();

    serviceOrdersAccess = module.get(ServiceOrdersAccessService);
    clientAccess = module.get(ClientAccessService);
    catalogAccess = module.get(ServiceCatalogAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
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
    await pool.query('TRUNCATE TABLE audit.audit_logs');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor() {
    const login = normalizeLoginIdentifier(`audit-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantAuditAdmin(pool, identityId);
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  async function seedServiceDefinition(actor: { identityId: string; sessionId: string }) {
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, {
      code: `CAT-${suffix}`,
      name: 'Serviços',
    });
    const draft = await catalogAccess.create(actor, {
      code: `AUDIT-SRV-${suffix}`,
      name: 'Serviço auditável',
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
    return catalogAccess.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);
  }

  async function seedClient(actor: { identityId: string; sessionId: string }) {
    return clientAccess.create(actor, {
      legalName: `Cliente Audit ${crypto.randomUUID()}`,
      tradeName: 'Cliente Audit',
      taxId: TEST_CNPJ,
      contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });
  }

  async function seedOrder(
    actor: { identityId: string; sessionId: string },
    correlationId?: string,
  ) {
    const client = await seedClient(actor);
    const published = await seedServiceDefinition(actor);
    return serviceOrdersAccess.create(
      actor,
      {
        origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
        unitId: UNIT_A,
        clientId: client.id,
        serviceDefinitionId: published.serviceDefinitionId,
        serviceDefinitionVersionId: published.id,
        description: 'OS para auditoria',
      },
      correlationId,
    );
  }

  async function auditRows(): Promise<AuditLogRow[]> {
    const result = await pool.query<AuditLogRow>(
      `SELECT tabela, acao, dados_antigos, dados_novos, usuario_id, correlation_id, registro_id
       FROM audit.audit_logs
       ORDER BY created_at ASC, id ASC`,
    );
    return result.rows;
  }

  // Caso A
  it('grava CREATE com dados_antigos nulo ao criar OS', async () => {
    const { actor } = await seedActor();
    const correlationId = crypto.randomUUID();

    const created = await seedOrder(actor, correlationId);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tabela).toBe('service_orders');
    expect(rows[0]?.acao).toBe('CREATE');
    expect(rows[0]?.dados_antigos).toBeNull();
    expect(rows[0]?.dados_novos).toMatchObject({ status: SERVICE_ORDER_STATUSES.Draft });
    expect(rows[0]?.registro_id).toBe(created.id);
  });

  // Caso B
  it('grava TRANSITION ao preparar OS, com status anterior diferente do novo', async () => {
    const { actor } = await seedActor();
    const created = await seedOrder(actor, crypto.randomUUID());

    await pool.query('TRUNCATE TABLE audit.audit_logs');
    await serviceOrdersAccess.prepare(
      actor,
      created.id,
      { rowVersion: created.rowVersion },
      crypto.randomUUID(),
    );

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.acao).toBe('TRANSITION');
    expect(rows[0]?.dados_antigos?.['status']).not.toBe(rows[0]?.dados_novos?.['status']);
    expect(rows[0]?.dados_novos?.['comando']).toBe('prepare');
    expect(rows[0]?.dados_novos?.['status']).toBe(SERVICE_ORDER_STATUSES.Prepared);
  });

  // Caso C
  it('nao grava audit quando a transicao e invalida e o rollback ocorre', async () => {
    const { actor } = await seedActor();
    const created = await seedOrder(actor, crypto.randomUUID());
    const prepared = await serviceOrdersAccess.prepare(
      actor,
      created.id,
      { rowVersion: created.rowVersion },
      crypto.randomUUID(),
    );
    const released = await serviceOrdersAccess.release(
      actor,
      prepared.id,
      { rowVersion: prepared.rowVersion },
      crypto.randomUUID(),
    );

    await pool.query('TRUNCATE TABLE audit.audit_logs');

    // RELEASED nao e origem valida para `release` repetido: o repositorio marca
    // INVALID_STATE e faz ROLLBACK antes de a auditoria existir.
    await expect(
      serviceOrdersAccess.release(
        actor,
        released.id,
        { rowVersion: released.rowVersion },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: SERVICE_ORDERS_ERROR_CODES.INVALID_STATE });

    expect(await auditRows()).toHaveLength(0);
  });

  // Caso D
  it('grava correlation_id correspondente ao informado na chamada', async () => {
    const { actor } = await seedActor();
    const correlationId = crypto.randomUUID();

    await seedOrder(actor, correlationId);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.correlation_id).toBe(correlationId);
  });

  // Caso E
  it('grava usuario_id correspondente ao ator autenticado', async () => {
    const { identityId, actor } = await seedActor();

    await seedOrder(actor, crypto.randomUUID());

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usuario_id).toBe(identityId);
  });

  // Caso F
  it('mantem rastreabilidade em cadeia entre prepare e release', async () => {
    const { actor } = await seedActor();
    const created = await seedOrder(actor, crypto.randomUUID());

    await pool.query('TRUNCATE TABLE audit.audit_logs');

    const prepareCorrelation = crypto.randomUUID();
    const prepared = await serviceOrdersAccess.prepare(
      actor,
      created.id,
      { rowVersion: created.rowVersion },
      prepareCorrelation,
    );
    const releaseCorrelation = crypto.randomUUID();
    await serviceOrdersAccess.release(
      actor,
      prepared.id,
      { rowVersion: prepared.rowVersion },
      releaseCorrelation,
    );

    const rows = await auditRows();
    const transitions = rows.filter((row) => row.acao === 'TRANSITION');
    expect(transitions).toHaveLength(2);

    expect(transitions[0]?.dados_novos?.['comando']).toBe('prepare');
    expect(transitions[0]?.correlation_id).toBe(prepareCorrelation);
    expect(transitions[1]?.dados_novos?.['comando']).toBe('release');
    expect(transitions[1]?.correlation_id).toBe(releaseCorrelation);

    // Cadeia: o estado anterior do release e o estado posterior do prepare.
    expect(transitions[1]?.dados_antigos?.['status']).toBe(transitions[0]?.dados_novos?.['status']);
    expect(transitions[1]?.dados_antigos?.['rowVersion']).toBe(
      transitions[0]?.dados_novos?.['rowVersion'],
    );
  });

  it('nao grava snapshot RESTRICTED/FINANCIAL no jsonb', async () => {
    const { actor } = await seedActor();
    await seedOrder(actor, crypto.randomUUID());

    const rows = await auditRows();
    const snapshot = rows[0]?.dados_novos ?? {};

    expect(Object.keys(snapshot).sort()).toEqual(['rowVersion', 'status', 'updatedAt']);
    expect(snapshot).not.toHaveProperty('client_snapshot');
    expect(snapshot).not.toHaveProperty('contract_snapshot');
    expect(snapshot).not.toHaveProperty('service_snapshot');
  });
});

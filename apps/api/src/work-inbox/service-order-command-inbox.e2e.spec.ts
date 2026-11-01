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
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { SECURITY_AUDIT_ACTIONS } from '../audit/types/security-audit.types';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { parseAuthTokenResponse } from '../auth/test/auth-response-test-types';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { ServiceCatalogAccessService } from '../catalog/services/service-catalog-access.service';
import { ClientAccessService } from '../clients/services/client-access.service';
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { configureApiTestApp } from '../infrastructure/http/configure-api-test-app';
import { SERVICE_ORDER_ORIGINS, SERVICE_ORDER_STATUSES } from '../service-orders/domain/service-order';
import { ServiceOrdersAccessService } from '../service-orders/services/service-orders-access.service';

const UNIT = 'unit-master-001-command';

type InboxResponse = {
  items: Array<{ id: string; targetRoute: string }>;
  total: number;
  byDomain: Record<string, number>;
  unavailableDomains: string[];
};

/**
 * MASTER 001 / AC-07, AC-09–13: genuine authenticated HTTP command.
 * Runs exclusively on TEST_DATABASE_URL. No production writes or test data.
 */
describe('MASTER 001: OS command API -> audit -> Inbox and KPI', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let catalog: ServiceCatalogAccessService;
  let clients: ClientAccessService;
  let serviceOrders: ServiceOrdersAccessService;
  let token: string;
  let actor: { identityId: string; sessionId: string };

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) throw new Error('TEST_DATABASE_URL is required');
    applyAuthTestEnv(url);
    process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-e2e';
    process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    catalog = app.get(ServiceCatalogAccessService);
    clients = app.get(ClientAccessService);
    serviceOrders = app.get(ServiceOrdersAccessService);
    pool = new Pool({ connectionString: url });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE pty.operational_unit_history, pty.operational_unit_commands, pty.operational_units');
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
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT });

    const login = normalizeLoginIdentifier(`master-001-${crypto.randomUUID()}@cisne.invalid`);
    const { identityId } = await insertIdentity(pool, login, await hashPassword(AUTH_TEST_PASSWORD));
    actor = { identityId, sessionId: 'master-001-session' };
    const grants = [
      [AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder],
      [AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder],
      [AUTHZ_ACTIONS.ServiceOrdersServiceOrderList, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder],
      [AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder],
      [AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder],
      [AUTHZ_ACTIONS.ClientCreate, AUTHZ_RESOURCE_TYPES.Client],
      [AUTHZ_ACTIONS.ClientRead, AUTHZ_RESOURCE_TYPES.Client],
      [AUTHZ_ACTIONS.CatalogServiceCreate, AUTHZ_RESOURCE_TYPES.CatalogService],
      [AUTHZ_ACTIONS.CatalogServiceRead, AUTHZ_RESOURCE_TYPES.CatalogService],
      [AUTHZ_ACTIONS.CatalogServicePublish, AUTHZ_RESOURCE_TYPES.CatalogService],
    ] as const;
    for (const [action, resourceType] of grants) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'user-agent': `master-001-${crypto.randomUUID()}` },
      payload: { login, password: AUTH_TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    token = parseAuthTokenResponse(response.body).accessToken;
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('executes RELEASE via HTTP and reconciles rowVersion, history, audit, Inbox and KPI', async () => {
    const client = await clients.create(actor, {
      legalName: 'Cliente Master 001',
      tradeName: 'Cliente 001',
      taxId: '11222333000181',
      contacts: [{ name: 'Operação', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
    });

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const category = await insertCatalogCategory(pool, {
      code: `M001-${suffix}`,
      name: 'Serviços operacionais',
    });
    const draft = await catalog.create(actor, {
      code: `M001-SRV-${suffix}`,
      name: 'Serviço para transição real',
      categoryId: category.categoryId,
      archetype: 'CIVIL_WORK',
      measurementMode: 'BY_EVENT',
      measurementBasis: 'GLOBAL_COMPLETION',
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '1000.0000', internalCost: '800.0000' }],
      resourceRequirements: [],
      laborRequirements: [],
      executionRequirements: [],
    });
    const definition = await catalog.getDefinition(actor, draft.serviceDefinitionId);
    const published = await catalog.publishVersion(actor, draft.serviceDefinitionId, 1, definition.version);

    const created = await serviceOrders.create(actor, {
      origin: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
      unitId: UNIT,
      clientId: client.id,
      serviceDefinitionId: published.serviceDefinitionId,
      serviceDefinitionVersionId: published.id,
      description: 'MASTER 001 command/inbox evidence',
    });

    const auth = { authorization: `Bearer ${token}` };
    const preparedResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/service-orders/${created.id}/prepare`,
      headers: auth,
      payload: { rowVersion: created.rowVersion },
    });
    expect(preparedResponse.statusCode).toBe(200);
    const prepared = JSON.parse(preparedResponse.body) as { id: string; status: string; rowVersion: number };
    expect(prepared.status).toBe(SERVICE_ORDER_STATUSES.Prepared);

    const beforeResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/work-inbox?domain=OPERACOES&unitId=${UNIT}`,
      headers: auth,
    });
    expect(beforeResponse.statusCode).toBe(200);
    const before = JSON.parse(beforeResponse.body) as InboxResponse;
    expect(before.unavailableDomains).not.toContain('OPERACOES');
    expect(before.items.some((item) => item.id === `OPERACOES:OS:RELEASE:${created.id}` && item.targetRoute === `/app/service-orders/${created.id}`)).toBe(true);
    expect(before.byDomain.OPERACOES).toBe(before.total);

    const releaseCorrelationId = crypto.randomUUID();
    const releasedResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/service-orders/${created.id}/release`,
      headers: { ...auth, 'x-correlation-id': releaseCorrelationId },
      payload: { rowVersion: prepared.rowVersion },
    });
    expect(releasedResponse.statusCode).toBe(200);
    const released = JSON.parse(releasedResponse.body) as {
      status: string;
      rowVersion: number;
      releasedAt: string | null;
      historyEvents: Array<{ eventType: string }>;
    };
    expect(released.status).toBe(SERVICE_ORDER_STATUSES.Released);
    expect(released.rowVersion).toBe(prepared.rowVersion + 1);
    expect(released.releasedAt).not.toBeNull();
    expect(released.historyEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['CREATED', 'PREPARED', 'RELEASED']),
    );

    const persisted = await pool.query<{ status: string; row_version: number }>(
      'SELECT status, row_version FROM so.service_orders WHERE id = $1',
      [created.id],
    );
    expect(persisted.rows[0]).toEqual({
      status: SERVICE_ORDER_STATUSES.Released,
      row_version: released.rowVersion,
    });

    const security = await pool.query<{ action: string }>(
      'SELECT action FROM audit.security_audit_events WHERE resource_id = $1',
      [created.id],
    );
    expect(security.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderRelease,
    );
    const transitions = await pool.query<{ acao: string; dados_novos: Record<string, unknown> }>(
      `SELECT acao, dados_novos FROM audit.audit_logs
       WHERE tabela = 'service_orders' AND registro_id = $1 ORDER BY created_at`,
      [created.id],
    );
    expect(transitions.rows.some((row) => row.acao === 'TRANSITION' && row.dados_novos['comando'] === 'release')).toBe(true);

    const afterResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/work-inbox?domain=OPERACOES&unitId=${UNIT}`,
      headers: auth,
    });
    expect(afterResponse.statusCode).toBe(200);
    const after = JSON.parse(afterResponse.body) as InboxResponse;
    expect(after.unavailableDomains).not.toContain('OPERACOES');
    expect(after.items.some((item) => item.id === `OPERACOES:OS:RELEASE:${created.id}`)).toBe(false);
    expect(after.byDomain.OPERACOES).toBe(after.total);
    expect(after.total).toBe(before.total - 1);
  });
});

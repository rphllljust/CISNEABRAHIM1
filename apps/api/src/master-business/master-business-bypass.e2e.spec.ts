import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateBillingTables,
  truncateCatalogTables,
  truncateClientTables,
  truncateCommercialProposalTables,
  truncateCommercialPurchaseOrderTables,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
  truncatePhysicalAssetTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
} from '@cisne/database';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApiTestApp } from '../infrastructure/http/configure-api-test-app';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { applyAuthTestEnv, AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { parseAuthTokenResponse } from '../auth/test/auth-response-test-types';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { BillingModule } from '../billing/billing.module';
import { BillingAccessService } from '../billing/services/billing-access.service';
import { BillingDocumentAccessService } from '../billing/services/billing-document-access.service';
import { CatalogModule } from '../catalog/catalog.module';
import { ServiceCatalogAccessService } from '../catalog/services/service-catalog-access.service';
import { ClientsModule } from '../clients/clients.module';
import { ClientAccessService } from '../clients/services/client-access.service';
import { CommercialModule } from '../commercial/commercial.module';
import { ProposalsAccessService } from '../commercial/services/proposals-access.service';
import { PurchaseOrdersAccessService } from '../commercial/services/purchase-orders-access.service';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentsAccessService } from '../documents/services/documents-access.service';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MeasurementsAccessService } from '../measurements/services/measurements-access.service';
import { RequestsModule } from '../requests/requests.module';
import { ServiceRequestsAccessService } from '../requests/services/service-requests-access.service';
import { ResourcesModule } from '../resources/resources.module';
import { PhysicalAssetsAccessService } from '../resources/services/physical-assets-access.service';
import { PhysicalResourceTypesAccessService } from '../resources/services/physical-resource-types-access.service';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { ServiceOrderExecutionAccessService } from '../service-orders/services/service-order-execution-access.service';
import { OperationsService } from '../service-orders/services/operations.service';
import { ServiceOrderPlanningAccessService } from '../service-orders/services/service-order-planning-access.service';
import { ServiceOrdersAccessService } from '../service-orders/services/service-orders-access.service';
import { grantUatProfile, runUatVerticalScenario, type UatVerticalServices } from '../uat/uat-vertical-runner';
import { UAT_SCENARIOS } from '../uat/uat-scenarios';
import { MASTER_BUSINESS_UNIT } from './master-business-harness';

describe('Master business direct API bypass (Prompt 98)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let services: UatVerticalServices;
  let adminToken: string;
  let intruderToken: string;
  let adminActor: { identityId: string; sessionId: string };
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  let adminLogin = '';
  let intruderLogin = '';

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for master business bypass E2E tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);
    process.env['AUTH_LOGIN_RATE_LIMIT_PER_MINUTE'] = '1000';
    process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-e2e';
    process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    pool = new Pool({ connectionString: testDatabaseUrl });

    const serviceModule: TestingModule = await Test.createTestingModule({
      imports: [
        AuthModule,
        AuditModule,
        AuthorizationModule,
        ClientsModule,
        CatalogModule,
        CommercialModule,
        DocumentsModule,
        ResourcesModule,
        RequestsModule,
        ServiceOrdersModule,
        MeasurementsModule,
        BillingModule,
      ],
    }).compile();

    services = {
      pool,
      clientAccess: serviceModule.get(ClientAccessService),
      catalogAccess: serviceModule.get(ServiceCatalogAccessService),
      proposalsAccess: serviceModule.get(ProposalsAccessService),
      purchaseOrdersAccess: serviceModule.get(PurchaseOrdersAccessService),
      serviceRequestsAccess: serviceModule.get(ServiceRequestsAccessService),
      documentsAccess: serviceModule.get(DocumentsAccessService),
      serviceOrdersAccess: serviceModule.get(ServiceOrdersAccessService),
      planningAccess: serviceModule.get(ServiceOrderPlanningAccessService),
      executionAccess: serviceModule.get(ServiceOrderExecutionAccessService),
    operationsAccess: serviceModule.get(OperationsService),
      measurementsAccess: serviceModule.get(MeasurementsAccessService),
      billingAccess: serviceModule.get(BillingAccessService),
      billingDocumentAccess: serviceModule.get(BillingDocumentAccessService),
      assetsAccess: serviceModule.get(PhysicalAssetsAccessService),
      resourceTypesAccess: serviceModule.get(PhysicalResourceTypesAccessService),
    };

    await truncateDocumentTables(pool);
    await truncateBillingTables(pool);
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateCommercialProposalTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: MASTER_BUSINESS_UNIT });

    adminLogin = normalizeLoginIdentifier(`mb-admin-fixed@cisne.invalid`);
    intruderLogin = normalizeLoginIdentifier(`mb-intruder-fixed@cisne.invalid`);
    const adminHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: adminId } = await insertIdentity(pool, adminLogin, adminHash);
    await grantUatProfile(pool, adminId, adminId, 'control_admin');
    adminActor = { identityId: adminId, sessionId: 'sid-admin' };

    const intruderHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: intruderId } = await insertIdentity(pool, intruderLogin, intruderHash);
    await insertGrant(pool, {
      identityId: intruderId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: adminId,
    });

    const adminLoginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: adminLogin, password: AUTH_TEST_PASSWORD },
    });
    expect(adminLoginResponse.statusCode).toBe(200);
    adminToken = parseAuthTokenResponse(adminLoginResponse.body).accessToken;

    const intruderLoginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: intruderLogin, password: AUTH_TEST_PASSWORD },
    });
    expect(intruderLoginResponse.statusCode).toBe(200);
    intruderToken = parseAuthTokenResponse(intruderLoginResponse.body).accessToken;
  });

  beforeEach(async () => {
    await truncateDocumentTables(pool);
    await truncateBillingTables(pool);
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateCommercialProposalTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('rejects forged clientId on service order update via HTTP', async () => {
    const partial = await runUatVerticalScenario(services, UAT_SCENARIOS[0]!, adminActor, MASTER_BUSINESS_UNIT, {
      stopAfter: 'prepared',
    });
    const order = await services.serviceOrdersAccess.getById(adminActor, partial.serviceOrderId!);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/service-orders/${partial.serviceOrderId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        rowVersion: order.rowVersion,
        clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });

    expect([400, 403, 404, 409]).toContain(response.statusCode);
  });

  it('rejects stale rowVersion on release via HTTP', async () => {
    const partial = await runUatVerticalScenario(services, UAT_SCENARIOS[0]!, adminActor, MASTER_BUSINESS_UNIT, {
      stopAfter: 'prepared',
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/service-orders/${partial.serviceOrderId}/release`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { rowVersion: 99999 },
    });
    expect([409, 400]).toContain(response.statusCode);
  });

  it('rejects unauthorized measurement approve and forged approver metadata via HTTP', async () => {
    const partial = await runUatVerticalScenario(services, UAT_SCENARIOS[1]!, adminActor, MASTER_BUSINESS_UNIT, {
      stopAfter: 'completed_execution',
    });
    const measurement = await services.measurementsAccess.create(adminActor, partial.serviceOrderId!);
    const submitted = await services.measurementsAccess.submit(adminActor, partial.serviceOrderId!, measurement.id, {
      rowVersion: measurement.rowVersion,
    });
    const reviewed = await services.measurementsAccess.startReview(adminActor, partial.serviceOrderId!, measurement.id, {
      rowVersion: submitted.rowVersion,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/service-orders/${partial.serviceOrderId}/measurements/${measurement.id}/approve`,
      headers: { authorization: `Bearer ${intruderToken}` },
      payload: {
        rowVersion: reviewed.rowVersion,
        approvedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });

    expect([401, 403, 400, 409]).toContain(response.statusCode);
    const reloaded = await services.measurementsAccess.getById(adminActor, partial.serviceOrderId!, measurement.id);
    expect(reloaded.status).not.toBe('APPROVED');
  });

  it('rejects forged internalCost on catalog publish via HTTP', async () => {
    const partial = await runUatVerticalScenario(services, UAT_SCENARIOS[0]!, adminActor, MASTER_BUSINESS_UNIT, {
      stopAfter: 'prepared',
    });
    const order = await services.serviceOrdersAccess.getById(adminActor, partial.serviceOrderId!);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/catalog/service-definitions/${order.serviceDefinitionId}/versions/1/publish`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        version: 99999,
        pricingModels: [{ modelCode: 'GLOBAL_PRICE', salePrice: '1.0000', internalCost: '0.0001' }],
      },
    });

    expect([400, 409]).toContain(response.statusCode);
  });

  it('rejects billing document issue without proper authorization scope', async () => {
    const partial = await runUatVerticalScenario(services, UAT_SCENARIOS[2]!, adminActor, MASTER_BUSINESS_UNIT, {
      stopAfter: 'measurement_approved',
    });
    const billing = await services.billingAccess.prepare(adminActor, partial.serviceOrderId!, {
      measurementId: partial.measurementId!,
      paymentTerms: '30 DDL',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/service-orders/${partial.serviceOrderId}/billing-records/${billing.id}/documents`,
      headers: { authorization: `Bearer ${intruderToken}` },
      payload: { dueDate: '2026-12-31', forgedRole: 'finance_admin' },
    });

    expect([401, 403]).toContain(response.statusCode);

    const docCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bil.billing_documents WHERE billing_record_id = $1`,
      [billing.id],
    );
    expect(docCount.rows[0]?.count).toBe('0');
  });
});

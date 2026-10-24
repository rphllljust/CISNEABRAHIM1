import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
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
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
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
import { getUatScenario } from '../uat/uat-scenarios';
import { grantUatProfile, runUatVerticalScenario, type UatVerticalServices } from '../uat/uat-vertical-runner';

const UNIT_VERTICAL = 'unit-vertical-a';

describe('First business vertical quality gate (PostgreSQL integration)', () => {
  let pool: Pool;
  let services: UatVerticalServices;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for vertical quality gate tests.');
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
        DocumentsModule,
        ResourcesModule,
        RequestsModule,
        ServiceOrdersModule,
        MeasurementsModule,
        BillingModule,
      ],
    }).compile();

    pool = new Pool({ connectionString: testDatabaseUrl });
    services = {
      pool,
      clientAccess: module.get(ClientAccessService),
      catalogAccess: module.get(ServiceCatalogAccessService),
      proposalsAccess: module.get(ProposalsAccessService),
      purchaseOrdersAccess: module.get(PurchaseOrdersAccessService),
      serviceRequestsAccess: module.get(ServiceRequestsAccessService),
      documentsAccess: module.get(DocumentsAccessService),
      serviceOrdersAccess: module.get(ServiceOrdersAccessService),
      planningAccess: module.get(ServiceOrderPlanningAccessService),
      executionAccess: module.get(ServiceOrderExecutionAccessService),
      operationsAccess: module.get(OperationsService),
      measurementsAccess: module.get(MeasurementsAccessService),
      billingAccess: module.get(BillingAccessService),
      billingDocumentAccess: module.get(BillingDocumentAccessService),
      assetsAccess: module.get(PhysicalAssetsAccessService),
      resourceTypesAccess: module.get(PhysicalResourceTypesAccessService),
    };
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
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_VERTICAL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('executes obra composto vertical happy path without internal mocks', async () => {
    const login = normalizeLoginIdentifier(`vertical-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantUatProfile(pool, identityId, identityId, 'control_admin');
    const actor = { identityId, sessionId: 'sid' };

    const result = await runUatVerticalScenario(
      services,
      getUatScenario('obra_composto'),
      actor,
      UNIT_VERTICAL,
    );
    expect(result.status, result.error).toBe('PASS');
    expect(result.billingDocumentId).toBeTruthy();
  });
});

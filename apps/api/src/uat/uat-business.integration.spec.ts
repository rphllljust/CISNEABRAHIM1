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
import { evaluateUatProfileChecks } from './uat-profile-checks';
import { UAT_SCENARIOS } from './uat-scenarios';
import { grantUatProfile, runUatVerticalScenario, type UatVerticalServices } from './uat-vertical-runner';
import { computeUatVerdict } from './uat-verdict';

const UNIT_UAT = 'unit-uat';

describe('Business UAT (Prompt 89)', () => {
  let pool: Pool;
  let services: UatVerticalServices;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for business UAT integration tests.');
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
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_UAT });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedProfileActor(profileId: Parameters<typeof grantUatProfile>[3]) {
    const login = normalizeLoginIdentifier(`uat-${profileId}-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantUatProfile(pool, identityId, identityId, profileId);
    return { identityId, sessionId: `sid-${profileId}` };
  }

  for (const scenario of UAT_SCENARIOS) {
    it(`executes UAT scenario: ${scenario.title}`, async () => {
      const admin = await seedProfileActor('control_admin');
      const result = await runUatVerticalScenario(services, scenario, admin, UNIT_UAT);
      expect(result.status, result.error).toBe('PASS');
      expect(result.serviceOrderId).toBeTruthy();
      expect(result.billingDocumentId).toBeTruthy();
    });
  }

  it('enforces profile visibility and separation of duties', async () => {
    const admin = await seedProfileActor('control_admin');
    const executor = await seedProfileActor('executor');
    const finance = await seedProfileActor('finance');

    const released = await runUatVerticalScenario(services, UAT_SCENARIOS[0]!, admin, UNIT_UAT, {
      stopAfter: 'released',
    });
    const billable = await runUatVerticalScenario(services, UAT_SCENARIOS[1]!, admin, UNIT_UAT, {
      stopAfter: 'measurement_approved',
    });

    const profileChecks = await evaluateUatProfileChecks({
      controlAdmin: admin,
      executor,
      finance,
      releasedServiceOrderId: released.serviceOrderId!,
      billableServiceOrderId: billable.serviceOrderId!,
      approvedMeasurementId: billable.measurementId!,
      clientAccess: services.clientAccess,
      serviceOrdersAccess: services.serviceOrdersAccess,
      executionAccess: services.executionAccess,
      billingAccess: services.billingAccess,
    });

    expect(profileChecks.filter((check) => !check.passed)).toEqual([]);
  });

  it('computes UAT verdict APPROVED when scenarios and profiles pass with no open blockers', async () => {
    const admin = await seedProfileActor('control_admin');
    const scenarioResults = [];
    for (const scenario of UAT_SCENARIOS) {
      scenarioResults.push(await runUatVerticalScenario(services, scenario, admin, UNIT_UAT));
    }

    const verdict = computeUatVerdict({
      scenarioResults,
      profileChecks: [{ profileId: 'executor', action: 'smoke', expected: 'DENY', actual: 'DENY', passed: true }],
      defects: [],
    });

    expect(verdict.status).toBe('APPROVED');
    expect(verdict.goLiveBlockers).toContain('BUSINESS_STAKEHOLDER_SIGN_OFF_PENDING');
  });
});

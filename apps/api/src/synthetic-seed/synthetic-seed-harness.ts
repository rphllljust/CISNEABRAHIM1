import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import {
  checkDatabaseHealth,
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  insertScopeRef,
  SYNTHETIC_SEED_UNIT_ID,
} from '@cisne/database';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ClientsModule } from '../clients/clients.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CommercialModule } from '../commercial/commercial.module';
import { DocumentsModule } from '../documents/documents.module';
import { ResourcesModule } from '../resources/resources.module';
import { RequestsModule } from '../requests/requests.module';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { MeasurementsModule } from '../measurements/measurements.module';
import { BillingModule } from '../billing/billing.module';
import { FinanceModule } from '../finance/finance.module';
import { FaultInjectionModule } from '../platform/fault-injection/fault-injection.module';
import { ClientAccessService } from '../clients/services/client-access.service';
import { ServiceCatalogAccessService } from '../catalog/services/service-catalog-access.service';
import { ProposalsAccessService } from '../commercial/services/proposals-access.service';
import { PurchaseOrdersAccessService } from '../commercial/services/purchase-orders-access.service';
import { DocumentsAccessService } from '../documents/services/documents-access.service';
import { ServiceRequestsAccessService } from '../requests/services/service-requests-access.service';
import { ServiceOrdersAccessService } from '../service-orders/services/service-orders-access.service';
import { ServiceOrderPlanningAccessService } from '../service-orders/services/service-order-planning-access.service';
import { ServiceOrderExecutionAccessService } from '../service-orders/services/service-order-execution-access.service';
import { OperationsService } from '../service-orders/services/operations.service';
import { MeasurementsAccessService } from '../measurements/services/measurements-access.service';
import { BillingAccessService } from '../billing/services/billing-access.service';
import { BillingDocumentAccessService } from '../billing/services/billing-document-access.service';
import { PhysicalAssetsAccessService } from '../resources/services/physical-assets-access.service';
import { PhysicalResourceTypesAccessService } from '../resources/services/physical-resource-types-access.service';
import { DatabaseService } from '../infrastructure/database/database.service';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import type { UatVerticalServices, UatActor } from '../uat/uat-vertical-runner';

export type SyntheticSeedHarness = {
  moduleRef: TestingModule;
  services: UatVerticalServices;
};

function createSharedPoolDatabaseService(pool: Pool): DatabaseService {
  return {
    isConfigured: () => true,
    getConnection: () => ({ pool }),
    getHealth: () => checkDatabaseHealth(pool),
    onModuleDestroy: async () => {},
  } as DatabaseService;
}

export async function createSyntheticSeedHarness(pool: Pool): Promise<SyntheticSeedHarness> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for synthetic seed harness.');
  }

  applyAuthTestEnv(databaseUrl);
  process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';
  process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-synthetic-seed';

  const moduleRef = await Test.createTestingModule({
    imports: [
      FaultInjectionModule,
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
      FinanceModule,
    ],
  })
    .overrideProvider(DatabaseService)
    .useValue(createSharedPoolDatabaseService(pool))
    .compile();

  const services: UatVerticalServices = {
    pool,
    clientAccess: moduleRef.get(ClientAccessService),
    catalogAccess: moduleRef.get(ServiceCatalogAccessService),
    proposalsAccess: moduleRef.get(ProposalsAccessService),
    purchaseOrdersAccess: moduleRef.get(PurchaseOrdersAccessService),
    serviceRequestsAccess: moduleRef.get(ServiceRequestsAccessService),
    documentsAccess: moduleRef.get(DocumentsAccessService),
    serviceOrdersAccess: moduleRef.get(ServiceOrdersAccessService),
    planningAccess: moduleRef.get(ServiceOrderPlanningAccessService),
    executionAccess: moduleRef.get(ServiceOrderExecutionAccessService),
      operationsAccess: moduleRef.get(OperationsService),
    measurementsAccess: moduleRef.get(MeasurementsAccessService),
    billingAccess: moduleRef.get(BillingAccessService),
    billingDocumentAccess: moduleRef.get(BillingDocumentAccessService),
    assetsAccess: moduleRef.get(PhysicalAssetsAccessService),
    resourceTypesAccess: moduleRef.get(PhysicalResourceTypesAccessService),
  };

  return { moduleRef, services };
}

export async function ensureSyntheticSeedBaselines(
  pool: Pool,
  unitId: string = SYNTHETIC_SEED_UNIT_ID,
): Promise<void> {
  await ensureUnitsOfMeasureBaseline(pool);
  await ensurePhysicalResourceTypesBaseline(pool);
  await ensureOperationalLaborTypesBaseline(pool);
  await insertScopeRef(pool, { scopeType: 'UNIT', refId: unitId });
}

/** Nest harness must boot before PostgreSQL baselines that touch catalog FK actors. */
export async function prepareSyntheticSeedHarness(pool: Pool): Promise<SyntheticSeedHarness> {
  const harness = await createSyntheticSeedHarness(pool);
  await ensureSyntheticSeedBaselines(pool);
  return harness;
}

export async function resolveDevOperatorIdentityId(pool: Pool, login: string): Promise<string | null> {
  const result = await pool.query<{ identity_id: string }>(
    `SELECT identity_id
     FROM identity.credentials
     WHERE login_identifier_normalized = $1
       AND revoked_at IS NULL
     LIMIT 1`,
    [login.trim().toLowerCase()],
  );
  return result.rows[0]?.identity_id ?? null;
}

export function buildSyntheticActor(identityId: string): UatActor {
  return { identityId, sessionId: 'sid-synthetic-business-seed' };
}

export async function closeSyntheticSeedHarness(
  harness: SyntheticSeedHarness | undefined,
): Promise<void> {
  await harness?.moduleRef?.close?.().catch(() => undefined);
}

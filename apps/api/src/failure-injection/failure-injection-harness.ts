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
  truncateFinanceTables,
  truncateDomainEventTables,
  truncateIdentityAndAuthorizationTables,
  truncateOutboxTables,
  truncatePhysicalAssetTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
  createIntegrationTestPool,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
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
import { CONCURRENCY_UNIT } from '../concurrency/concurrency-seeds';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentsAccessService } from '../documents/services/documents-access.service';
import { FinanceModule } from '../finance/finance.module';
import { ObjectStorageService } from '../documents/storage/object-storage.service';
import { DatabaseService } from '../infrastructure/database/database.service';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MeasurementsAccessService } from '../measurements/services/measurements-access.service';
import { FaultInjectionModule } from '../platform/fault-injection/fault-injection.module';
import { FAULT_INJECTION_PORT } from '../platform/fault-injection/fault-injection.port';
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
import { grantUatProfile, type UatActor, type UatVerticalServices } from '../uat/uat-vertical-runner';
import { resetSyntheticCnpjSequence } from '../master-business/synthetic-test-data';
import { ConfigurableFaultInjectionPort } from './configurable-fault-injection.port';
import { FaultingDatabaseService } from './faulting-database.service';
import { FaultingObjectStorageAdapter } from './faulting-object-storage.adapter';

export type FailureInjectionTestContext = {
  pool: Pool;
  services: UatVerticalServices;
  objectStorage: ObjectStorageService;
  faultPort: ConfigurableFaultInjectionPort;
  faultingStorage: FaultingObjectStorageAdapter;
  seedAdminActor: () => Promise<UatActor>;
  resetDatabase: () => Promise<void>;
  close: () => Promise<void>;
};

export async function createFailureInjectionTestContext(): Promise<FailureInjectionTestContext> {
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for failure injection tests.');
  }

  applyAuthTestEnv(testDatabaseUrl);
  process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-failure-test';
  process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';

  const faultPort = new ConfigurableFaultInjectionPort();
  const faultingDb = new FaultingDatabaseService(faultPort);
  const baseStorage = new ObjectStorageService();
  const faultingStorage = new FaultingObjectStorageAdapter(baseStorage);

  const moduleBuilder = Test.createTestingModule({
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
    .overrideProvider(FAULT_INJECTION_PORT)
    .useValue(faultPort)
    .overrideProvider(DatabaseService)
    .useValue(faultingDb);

  const module: TestingModule = await moduleBuilder.compile();

  const objectStorage = module.get(ObjectStorageService);
  Object.assign(objectStorage, {
    putObject: (...args: Parameters<ObjectStorageService['putObject']>) => faultingStorage.putObject(...args),
    getObject: (...args: Parameters<ObjectStorageService['getObject']>) => faultingStorage.getObject(...args),
    deleteObject: (...args: Parameters<ObjectStorageService['deleteObject']>) =>
      faultingStorage.deleteObject(...args),
    createSignedDownloadUrl: (...args: Parameters<ObjectStorageService['createSignedDownloadUrl']>) =>
      faultingStorage.createSignedDownloadUrl(...args),
  });

  const pool = createIntegrationTestPool(testDatabaseUrl);
  const services: UatVerticalServices = {
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

  async function resetDatabase(): Promise<void> {
    faultPort.clear();
    faultingStorage.reset();
    resetSyntheticCnpjSequence();
    await truncateFinanceTables(pool);
    await truncateDocumentTables(pool);
    await truncateBillingTables(pool);
    await truncateServiceRequestTables(pool);
    await truncateServiceOrderTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateCommercialProposalTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await truncateOutboxTables(pool);
    await truncateDomainEventTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: CONCURRENCY_UNIT });
  }

  // bcrypt custa ~100 ms por chamada e este seed roda uma vez POR TESTE. A senha
  // e constante no contexto e o hash resultante e o mesmo que a autenticacao de
  // teste verifica, entao calcular uma vez nao enfraquece nada.
  let sharedPasswordHash: string | null = null;

  async function seedAdminActor(): Promise<UatActor> {
    const login = normalizeLoginIdentifier(`failure-inj-${crypto.randomUUID()}@cisne.invalid`);
    sharedPasswordHash ??= await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, sharedPasswordHash);
    await grantUatProfile(pool, identityId, identityId, 'control_admin');
    return { identityId, sessionId: 'sid-failure' };
  }

  await resetDatabase();

  async function close(): Promise<void> {
    await faultingDb.onModuleDestroy();
    await pool.end();
  }

  return {
    pool,
    services,
    objectStorage,
    faultPort,
    faultingStorage,
    seedAdminActor,
    resetDatabase,
    close,
  };
}

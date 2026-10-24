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
  createIntegrationTestPool,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ensureTestDefaultIssuer } from '../test/ensure-test-issuer';
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
import { FaultInjectionModule } from '../platform/fault-injection/fault-injection.module';
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
import { resetSyntheticCnpjSequence } from './synthetic-test-data';

export const MASTER_BUSINESS_UNIT = 'unit-master-business';

export type MasterBusinessTestContext = {
  pool: Pool;
  services: UatVerticalServices;
  seedAdminActor: () => Promise<UatActor>;
  resetDatabase: () => Promise<void>;
};

export async function createMasterBusinessTestContext(): Promise<MasterBusinessTestContext> {
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for master business tests.');
  }

  applyAuthTestEnv(testDatabaseUrl);
  process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-test';
  process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';

  const module: TestingModule = await Test.createTestingModule({
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
    ],
  }).compile();

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

  /**
   * Limpeza entre testes.
   *
   * NAO paralelizar os truncates: `createIntegrationTestPool` usa `max: 1` de
   * proposito, para que o advisory lock da isolation fique na MESMA conexao do
   * processo. Com uma unica conexao, `Promise.all` so enfileira — nao ha ganho e
   * ha risco de mudar a ordem de aquisicao do lock. O ganho real desta limpeza
   * veio de cachear o hash de senha em `seedAdminActor` (bcrypt e o custo
   * dominante), nao de mudar o paralelismo do banco.
   */
  async function resetDatabase(): Promise<void> {
    resetSyntheticCnpjSequence();
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
    await ensureTestDefaultIssuer(pool);
  }

  // O hash e deterministico para a mesma senha+params e NAO e segredo: o custo do
  // bcrypt (~100 ms por chamada) nao precisa ser pago uma vez por teste. O cast
  // continua real — o hash gerado aqui e o que a autenticacao de teste verifica.
  let sharedPasswordHash: string | null = null;

  async function seedAdminActor(): Promise<UatActor> {
    const login = normalizeLoginIdentifier(`master-biz-${crypto.randomUUID()}@cisne.invalid`);
    sharedPasswordHash ??= await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, sharedPasswordHash);
    await grantUatProfile(pool, identityId, identityId, 'control_admin');
    return { identityId, sessionId: 'sid-master' };
  }

  await resetDatabase();

  return { pool, services, seedAdminActor, resetDatabase };
}

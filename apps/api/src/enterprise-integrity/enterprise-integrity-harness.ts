import {
  createIntegrationTestPool,
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateAccountingTables,
  truncateBillingTables,
  truncateCatalogTables,
  truncateClientTables,
  truncateCommercialProposalTables,
  truncateCommercialPurchaseOrderTables,
  truncateDocumentTables,
  truncateFiscalTables,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
  truncatePayrollTables,
  truncatePhysicalAssetTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountingAccessService } from '../accounting/services/accounting-access.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ApprovalMatrixAccessService } from '../authorization/services/approval-matrix-access.service';
import { enableCriticalSodFor } from '../authorization/test/critical-sod-harness';
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
import { FinanceModule } from '../finance/finance.module';
import { BankReconciliationAccessService } from '../finance/services/bank-reconciliation-access.service';
import { ReceivablesAccessService } from '../finance/services/receivables-access.service';
import { TreasuryAccessService } from '../finance/services/treasury-access.service';
import { FiscalModule } from '../fiscal/fiscal.module';
import {
  FISCAL_CREDENTIALING_STATUSES,
  type FiscalCredentialingSnapshot,
} from '../fiscal/domain/fiscal-credentialing';
import { FISCAL_CREDENTIALING_PORT, type FiscalCredentialingPort } from '../fiscal/ports/fiscal-credentialing.port';
import {
  FISCAL_AUTHORIZATION_GATEWAY,
  type FiscalAuthorizationGateway,
  type FiscalGatewaySubmitResult,
} from '../fiscal/ports/fiscal-authorization-gateway.port';
import { FiscalAccessService } from '../fiscal/services/fiscal-access.service';
import { TaxEngineAccessService } from '../fiscal/services/tax-engine-access.service';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MeasurementsAccessService } from '../measurements/services/measurements-access.service';
import { MASTER_BUSINESS_UNIT } from '../master-business/master-business-harness';
import { resetSyntheticCnpjSequence } from '../master-business/synthetic-test-data';
import { PayrollModule } from '../payroll/payroll.module';
import { PayrollAccessService } from '../payroll/services/payroll-access.service';
import { FaultInjectionModule } from '../platform/fault-injection/fault-injection.module';
import { RequestsModule } from '../requests/requests.module';
import { ServiceRequestsAccessService } from '../requests/services/service-requests-access.service';
import { ResourcesModule } from '../resources/resources.module';
import { PhysicalAssetsAccessService } from '../resources/services/physical-assets-access.service';
import { PhysicalResourceTypesAccessService } from '../resources/services/physical-resource-types-access.service';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { ServiceOrderExecutionAccessService } from '../service-orders/services/service-order-execution-access.service';
import { ServiceOrderPlanningAccessService } from '../service-orders/services/service-order-planning-access.service';
import { ServiceOrdersAccessService } from '../service-orders/services/service-orders-access.service';
import { grantUatProfile, type UatActor, type UatVerticalServices } from '../uat/uat-vertical-runner';

export { MASTER_BUSINESS_UNIT };

export class ScriptedFiscalGateway implements FiscalAuthorizationGateway {
  readonly gatewayId = 'enterprise-integrity-fiscal-gateway';
  next: FiscalGatewaySubmitResult = { outcome: 'AUTHORIZED', protocolCode: 'PROT-INTEGRITY-1' };

  async submit(): Promise<FiscalGatewaySubmitResult> {
    return this.next;
  }
}

/**
 * Porta de credenciamento fiscal scriptada (mesmo padrao de fiscal.integration.spec.ts).
 * A ligacao de producao e SRC-006 NAO CREDENCIADO: sem credenciamento aprovado a
 * transmissao fiscal e bloqueada por regra (BR-043..BR-045). Aqui a jornada empresarial
 * integra o hop fiscal com o gateway scriptado, portanto o credenciamento tambem e
 * scriptado. O bloqueio continua provado em fiscal-credentialing.spec.ts e
 * fiscal.integration.spec.ts ("blocks transmission when credentialing is not approved").
 */
export class ScriptedFiscalCredentialing implements FiscalCredentialingPort {
  approved = true;

  snapshot(): FiscalCredentialingSnapshot {
    return {
      status: this.approved
        ? FISCAL_CREDENTIALING_STATUSES.Approved
        : FISCAL_CREDENTIALING_STATUSES.NotCredentialed,
      approved: this.approved,
      source: 'LAB',
    };
  }
}

const ENTERPRISE_GRANTS: Array<{ action: string; resourceType: string }> = [
  { action: AUTHZ_ACTIONS.FinanceReceivableRead, resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable },
  { action: AUTHZ_ACTIONS.FinanceReceivableList, resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable },
  { action: AUTHZ_ACTIONS.FinanceReceivableSettle, resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable },
  { action: AUTHZ_ACTIONS.FinanceReceivableCancel, resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable },
  { action: AUTHZ_ACTIONS.FinanceTreasuryAccountOpen, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.FinanceTreasuryRead, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.FinanceTreasuryList, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.FinanceTreasuryPost, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.FinanceTreasuryTransfer, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.FinanceTreasuryReverse, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.FinanceBankStatementImport, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.FinanceReconciliationMatch, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.FinanceReconciliationConfirm, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.FinanceReconciliationUnreconcile, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.FinanceReconciliationRead, resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury },
  { action: AUTHZ_ACTIONS.AccountingChartManage, resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger },
  { action: AUTHZ_ACTIONS.AccountingPeriodOpen, resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger },
  { action: AUTHZ_ACTIONS.AccountingJournalDraft, resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger },
  { action: AUTHZ_ACTIONS.AccountingJournalPost, resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger },
  { action: AUTHZ_ACTIONS.AccountingJournalRead, resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger },
  { action: AUTHZ_ACTIONS.AccountingJournalList, resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger },
  { action: AUTHZ_ACTIONS.FiscalDocumentDraft, resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument },
  { action: AUTHZ_ACTIONS.FiscalDocumentSubmit, resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument },
  { action: AUTHZ_ACTIONS.FiscalDocumentCancel, resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument },
  { action: AUTHZ_ACTIONS.FiscalDocumentRead, resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument },
  { action: AUTHZ_ACTIONS.FiscalDocumentList, resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument },
  { action: AUTHZ_ACTIONS.FiscalTaxRuleManage, resourceType: AUTHZ_RESOURCE_TYPES.FiscalTaxEngine },
  { action: AUTHZ_ACTIONS.FiscalTaxCalculate, resourceType: AUTHZ_RESOURCE_TYPES.FiscalTaxEngine },
  { action: AUTHZ_ACTIONS.FiscalTaxRead, resourceType: AUTHZ_RESOURCE_TYPES.FiscalTaxEngine },
  { action: AUTHZ_ACTIONS.PayrollContractManage, resourceType: AUTHZ_RESOURCE_TYPES.PayrollLedger },
  { action: AUTHZ_ACTIONS.PayrollPeriodOpen, resourceType: AUTHZ_RESOURCE_TYPES.PayrollLedger },
  { action: AUTHZ_ACTIONS.PayrollRead, resourceType: AUTHZ_RESOURCE_TYPES.PayrollLedger },
];

export type EnterpriseIntegrityServices = UatVerticalServices & {
  receivablesAccess: ReceivablesAccessService;
  treasuryAccess: TreasuryAccessService;
  bankReconciliationAccess: BankReconciliationAccessService;
  accountingAccess: AccountingAccessService;
  fiscalAccess: FiscalAccessService;
  taxEngineAccess: TaxEngineAccessService;
  payrollAccess: PayrollAccessService;
};

export type EnterpriseIntegrityContext = {
  pool: Pool;
  module: TestingModule;
  services: EnterpriseIntegrityServices;
  fiscalGateway: ScriptedFiscalGateway;
  seedAdminActor: () => Promise<UatActor>;
  seedOperationalActor: () => Promise<UatActor>;
  seedFinancialChecker: () => Promise<UatActor>;
  resetDatabase: () => Promise<void>;
};

async function grantEnterpriseCapabilities(pool: Pool, identityId: string): Promise<void> {
  for (const grant of ENTERPRISE_GRANTS) {
    await insertGrant(pool, {
      identityId,
      action: grant.action,
      resourceType: grant.resourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

export async function createEnterpriseIntegrityContext(): Promise<EnterpriseIntegrityContext> {
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for enterprise financial integrity tests.');
  }

  applyAuthTestEnv(testDatabaseUrl);
  process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-test';
  process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';

  const fiscalGateway = new ScriptedFiscalGateway();
  const fiscalCredentialing = new ScriptedFiscalCredentialing();
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
      FinanceModule,
      AccountingModule,
      FiscalModule,
      PayrollModule,
    ],
  })
    .overrideProvider(FISCAL_AUTHORIZATION_GATEWAY)
    .useValue(fiscalGateway)
    .overrideProvider(FISCAL_CREDENTIALING_PORT)
    .useValue(fiscalCredentialing)
    .compile();

  const pool = createIntegrationTestPool(testDatabaseUrl);
  const services: EnterpriseIntegrityServices = {
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
    measurementsAccess: module.get(MeasurementsAccessService),
    billingAccess: module.get(BillingAccessService),
    billingDocumentAccess: module.get(BillingDocumentAccessService),
    assetsAccess: module.get(PhysicalAssetsAccessService),
    resourceTypesAccess: module.get(PhysicalResourceTypesAccessService),
    receivablesAccess: module.get(ReceivablesAccessService),
    treasuryAccess: module.get(TreasuryAccessService),
    bankReconciliationAccess: module.get(BankReconciliationAccessService),
    accountingAccess: module.get(AccountingAccessService),
    fiscalAccess: module.get(FiscalAccessService),
    taxEngineAccess: module.get(TaxEngineAccessService),
    payrollAccess: module.get(PayrollAccessService),
  };

  async function resetDatabase(): Promise<void> {
    resetSyntheticCnpjSequence();
    fiscalGateway.next = { outcome: 'AUTHORIZED', protocolCode: 'PROT-INTEGRITY-1' };
    await truncatePayrollTables(pool);
    await truncateAccountingTables(pool);
    await truncateFiscalTables(pool);
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
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: MASTER_BUSINESS_UNIT });
  }

  async function seedAdminActor(): Promise<UatActor> {
    const login = normalizeLoginIdentifier(`ent-admin-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantUatProfile(pool, identityId, identityId, 'control_admin');
    await grantEnterpriseCapabilities(pool, identityId);
    return { identityId, sessionId: 'sid-enterprise-admin' };
  }

  async function seedOperationalActor(): Promise<UatActor> {
    const login = normalizeLoginIdentifier(`ent-ops-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantUatProfile(pool, identityId, identityId, 'executor');
    return { identityId, sessionId: 'sid-enterprise-ops' };
  }

  async function seedFinancialChecker(): Promise<UatActor> {
    const login = normalizeLoginIdentifier(`ent-checker-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantUatProfile(pool, identityId, identityId, 'control_admin');
    await grantEnterpriseCapabilities(pool, identityId);
    const matrices = module.get(ApprovalMatrixAccessService);
    await enableCriticalSodFor(pool, matrices, identityId);
    return { identityId, sessionId: 'sid-enterprise-checker' };
  }

  await resetDatabase();

  return {
    pool,
    module,
    services,
    fiscalGateway,
    seedAdminActor,
    seedOperationalActor,
    seedFinancialChecker,
    resetDatabase,
  };
}

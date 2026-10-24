import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { IssuerRegistryModule } from '../establishments/issuer-registry.module';
import { ENTERPRISE_CORE_PORT } from '../platform/bounded-contexts/enterprise-core-ports';
import { FiscalController } from './controllers/fiscal.controller';
import { FiscalPeriodController } from './controllers/fiscal-period.controller';
import { TaxAssessmentController } from './controllers/tax-assessment.controller';
import { TaxEngineController } from './controllers/tax-engine.controller';
import {
  FISCAL_PERIOD_FAILURE_INJECTION,
  FiscalPeriodFailureInjection,
} from './domain/fiscal-period-failure-injection';
import { TAX_PAYABLE_FAILURE_INJECTION, TaxPayableFailureInjection } from './domain/tax-payable-failure-injection';
import { FISCAL_AUTHORIZATION_GATEWAY } from './ports/fiscal-authorization-gateway.port';
import { FISCAL_CERTIFICATE_PORT } from './ports/fiscal-certificate.port';
import { FISCAL_CREDENTIALING_PORT } from './ports/fiscal-credentialing.port';
import { Src006FiscalCredentialing } from './ports/src006-fiscal-credentialing';
import { UnconfiguredFiscalAuthorizationGateway } from './ports/unconfigured-fiscal-authorization.gateway';
import { UnconfiguredFiscalCertificatePort } from './ports/unconfigured-fiscal-certificate.port';
import { FiscalRepository } from './repositories/fiscal.repository';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { FiscalPeriodRepository } from './repositories/fiscal-period.repository';
import { TaxAssessmentRepository } from './repositories/tax-assessment.repository';
import { TaxEngineRepository } from './repositories/tax-engine.repository';
import { FiscalAccessAuthz } from './services/fiscal-access.authz';
import { FiscalAccessService } from './services/fiscal-access.service';
import { FiscalPeriodAccessService } from './services/fiscal-period-access.service';
import { FiscalAccountingIntegrationService } from './services/fiscal-accounting-integration.service';
import { TaxAssessmentAccessService } from './services/tax-assessment-access.service';
import { TaxEngineAccessAuthz } from './services/tax-engine-access.authz';
import { TaxEngineAccessService } from './services/tax-engine-access.service';

/**
 * FISCAL write owner of fis.*. Official FiscalDocument is not BillingDocument.
 * TaxCalculation is not FiscalDocument and not JournalEntry.
 * TaxAssessment finalize opens Payable through FinancePayablePort; Accounting stays decoupled.
 * Versioned engine stores configured rules only — no invented official rates.
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AuthorizationModule,
    AuditModule,
    IssuerRegistryModule,
    /**
     * F1.2 — FISCAL publica o fato econômico na outbox transacional, dentro da
     * própria transação de autorização/cancelamento. FISCAL → PLATFORM é
     * dependência permitida pelo grafo.
     */
    OutboxModule,
  ],
  controllers: [FiscalController, TaxEngineController, TaxAssessmentController, FiscalPeriodController],
  providers: [
    FiscalRepository,
    FiscalPeriodRepository,
    FiscalPeriodAccessService,
    FiscalPeriodFailureInjection,
    {
      provide: FISCAL_PERIOD_FAILURE_INJECTION,
      useExisting: FiscalPeriodFailureInjection,
    },
    FiscalAccessAuthz,
    FiscalAccountingIntegrationService,
    FiscalAccessService,
    TaxEngineRepository,
    TaxEngineAccessAuthz,
    TaxEngineAccessService,
    TaxAssessmentRepository,
    TaxAssessmentAccessService,
    TaxPayableFailureInjection,
    {
      provide: TAX_PAYABLE_FAILURE_INJECTION,
      useExisting: TaxPayableFailureInjection,
    },
    {
      provide: FISCAL_AUTHORIZATION_GATEWAY,
      useClass: UnconfiguredFiscalAuthorizationGateway,
    },
    {
      provide: FISCAL_CERTIFICATE_PORT,
      useClass: UnconfiguredFiscalCertificatePort,
    },
    {
      provide: FISCAL_CREDENTIALING_PORT,
      useClass: Src006FiscalCredentialing,
    },
    {
      provide: ENTERPRISE_CORE_PORT.FiscalDocument,
      useExisting: FiscalAccessService,
    },
  ],
  exports: [
    FiscalAccessService,
    TaxEngineAccessService,
    TaxAssessmentAccessService,
    FiscalPeriodAccessService,
    FiscalAccountingIntegrationService,
    ENTERPRISE_CORE_PORT.FiscalDocument,
    FISCAL_AUTHORIZATION_GATEWAY,
    FISCAL_CERTIFICATE_PORT,
    FISCAL_CREDENTIALING_PORT,
  ],
})
export class FiscalModule {}

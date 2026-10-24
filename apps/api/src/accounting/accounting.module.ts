import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ENTERPRISE_CORE_PORT } from '../platform/bounded-contexts/enterprise-core-ports';
import {
  POSTING_FAILURE_INJECTION,
  PostingFailureInjection,
} from '../platform/kernel/posting-failure-injection';
import { AccountingController } from './controllers/accounting.controller';
import { ClosingController } from './controllers/closing.controller';
import { FixedAssetAccountingController } from './controllers/fixed-asset-accounting.controller';
import { EconomicTraceController } from './controllers/economic-trace.controller';
import { AccountingPostingRepository } from './repositories/accounting-posting.repository';
import { AccountingRepository } from './repositories/accounting.repository';
import { FixedAssetAccountingRepository } from './repositories/fixed-asset-accounting.repository';
import { AccountingAccessAuthz } from './services/accounting-access.authz';
import { AccountingAccessService } from './services/accounting-access.service';
import { AccountingReportingService } from './services/accounting-reporting.service';
import { ClosingReadinessService } from './services/closing-readiness.service';
import { EconomicPostingService } from './services/economic-posting.service';
import { EconomicTraceReadModelService } from './repositories/economic-trace.read-model';
import { EconomicTraceAccessService } from './services/economic-trace-access.service';
import { FixedAssetAccountingAccessService } from './services/fixed-asset-accounting-access.service';
import { ECONOMIC_EVENT_CONSUMER } from '../platform/outbox/domain/economic-event-consumer.port';
import { OutboxModule } from '../platform/outbox/outbox.module';

/**
 * ACCOUNTING write owner of acc.*. Posted journals are append-only double-entry
 * records and never mutate operational or finance aggregates.
 *
 * F1.1 — este módulo também é o DONO da decisão contábil do fato econômico
 * publicado por FINANCE (`EconomicPostingService`), ligado à porta
 * `ECONOMIC_EVENT_CONSUMER` que a outbox consome. `OutboxModule` é importado pelo
 * READER (`ECONOMIC_OUTBOX_READER`) do reprocessamento autorizado — seta
 * ACCOUNTING → PLATFORM, que o grafo permite.
 */
@Global()
@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule, OutboxModule],
  controllers: [
    AccountingController,
    ClosingController,
    FixedAssetAccountingController,
    EconomicTraceController,
  ],
  providers: [
    AccountingRepository,
    AccountingPostingRepository,
    FixedAssetAccountingRepository,
    AccountingAccessAuthz,
    AccountingReportingService,
    AccountingAccessService,
    ClosingReadinessService,
    FixedAssetAccountingAccessService,
    EconomicPostingService,
    EconomicTraceReadModelService,
    EconomicTraceAccessService,
    PostingFailureInjection,
    {
      provide: POSTING_FAILURE_INJECTION,
      useExisting: PostingFailureInjection,
    },
    {
      provide: ENTERPRISE_CORE_PORT.AccountingLedger,
      useExisting: AccountingAccessService,
    },
    {
      provide: ECONOMIC_EVENT_CONSUMER,
      useExisting: EconomicPostingService,
    },
  ],
  exports: [
    AccountingAccessService,
    AccountingReportingService,
    ClosingReadinessService,
    FixedAssetAccountingAccessService,
    EconomicPostingService,
    EconomicTraceReadModelService,
    EconomicTraceAccessService,
    PostingFailureInjection,
    POSTING_FAILURE_INJECTION,
    ENTERPRISE_CORE_PORT.AccountingLedger,
    ECONOMIC_EVENT_CONSUMER,
  ],
})
export class AccountingModule {}

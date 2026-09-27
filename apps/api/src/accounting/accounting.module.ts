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
import { AccountingPostingRepository } from './repositories/accounting-posting.repository';
import { AccountingRepository } from './repositories/accounting.repository';
import { FixedAssetAccountingRepository } from './repositories/fixed-asset-accounting.repository';
import { AccountingAccessAuthz } from './services/accounting-access.authz';
import { AccountingAccessService } from './services/accounting-access.service';
import { AccountingReportingService } from './services/accounting-reporting.service';
import { ClosingReadinessService } from './services/closing-readiness.service';
import { FixedAssetAccountingAccessService } from './services/fixed-asset-accounting-access.service';

/**
 * ACCOUNTING write owner of acc.*. Posted journals are append-only double-entry
 * records and never mutate operational or finance aggregates.
 */
@Global()
@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule],
  controllers: [AccountingController, ClosingController, FixedAssetAccountingController],
  providers: [
    AccountingRepository,
    AccountingPostingRepository,
    FixedAssetAccountingRepository,
    AccountingAccessAuthz,
    AccountingReportingService,
    AccountingAccessService,
    ClosingReadinessService,
    FixedAssetAccountingAccessService,
    PostingFailureInjection,
    {
      provide: POSTING_FAILURE_INJECTION,
      useExisting: PostingFailureInjection,
    },
    {
      provide: ENTERPRISE_CORE_PORT.AccountingLedger,
      useExisting: AccountingAccessService,
    },
  ],
  exports: [
    AccountingAccessService,
    AccountingReportingService,
    FixedAssetAccountingAccessService,
    PostingFailureInjection,
    POSTING_FAILURE_INJECTION,
    ENTERPRISE_CORE_PORT.AccountingLedger,
  ],
})
export class AccountingModule {}

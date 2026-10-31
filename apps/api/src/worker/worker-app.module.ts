import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { BillingModule } from '../billing/billing.module';
import { BillingReceivableHandoffJobHandler } from '../billing/jobs/billing-receivable-handoff.handler';
import { BillingReceivableCancelJobHandler } from '../billing/jobs/billing-receivable-cancel.handler';
import { FinanceModule } from '../finance/finance.module';
import { ObservabilityModule } from '../observability/observability.module';
import { IntegrationsInboxModule } from '../integrations/inbox/integrations-inbox.module';
import { IntegrationInboxProcessorWorkerService } from '../integrations/inbox/services/integration-inbox-processor.worker.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { BackgroundJobsModule } from '../platform/background-jobs/background-jobs.module';
import { BACKGROUND_JOB_EXTRA_HANDLERS, BackgroundWorkerBootstrapService } from '../platform/background-jobs/background-worker.bootstrap';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { OutboxPublisherWorkerService } from '../platform/outbox/services/outbox-publisher.worker.service';
import { DatabaseModule } from '../infrastructure/database/database.module';

@Module({
  imports: [
    ObservabilityModule,
    DatabaseModule,
    NotificationsModule,
    ReportsModule,
    BackgroundJobsModule,
    OutboxModule,
    AccountingModule,
    FinanceModule,
    BillingModule,
    IntegrationsInboxModule,
  ],
  providers: [
    BillingReceivableHandoffJobHandler,
    BillingReceivableCancelJobHandler,
    {
      provide: BACKGROUND_JOB_EXTRA_HANDLERS,
      useFactory: (billingHandler: BillingReceivableHandoffJobHandler, cancelHandler: BillingReceivableCancelJobHandler) => [billingHandler, cancelHandler],
      inject: [BillingReceivableHandoffJobHandler, BillingReceivableCancelJobHandler],
    },
    BackgroundWorkerBootstrapService,
    OutboxPublisherWorkerService,
    IntegrationInboxProcessorWorkerService,
  ],
})
export class WorkerAppModule {}

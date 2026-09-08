import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { IntegrationsInboxModule } from '../integrations/inbox/integrations-inbox.module';
import { IntegrationInboxProcessorWorkerService } from '../integrations/inbox/services/integration-inbox-processor.worker.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { BackgroundJobsModule } from '../platform/background-jobs/background-jobs.module';
import { BackgroundWorkerBootstrapService } from '../platform/background-jobs/background-worker.bootstrap';
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
    IntegrationsInboxModule,
  ],
  providers: [BackgroundWorkerBootstrapService, OutboxPublisherWorkerService, IntegrationInboxProcessorWorkerService],
})
export class WorkerAppModule {}

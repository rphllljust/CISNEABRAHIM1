import { Module, forwardRef } from '@nestjs/common';
import { AlertsModule } from '../../alerts/alerts.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { NotificationDispatchJobHandler } from './handlers/notification-dispatch.handler';
import { OperationalAlertScanJobHandler } from './handlers/operational-alert-scan.handler';
import { BackgroundJobsRepository } from './repositories/background-jobs.repository';
import { OperationalAlertSchedulerBootstrap } from './services/operational-alert-scheduler.bootstrap';
import { BackgroundJobEnqueueService } from './services/background-job-enqueue.service';
import { BackgroundJobHandlerRegistry } from './services/background-job-handler.registry';
import { BackgroundWorkerService } from './services/background-worker.service';

@Module({
  imports: [DatabaseModule, NotificationsModule, ObservabilityModule, forwardRef(() => AlertsModule)],
  providers: [
    BackgroundJobsRepository,
    BackgroundJobEnqueueService,
    BackgroundJobHandlerRegistry,
    BackgroundWorkerService,
    NotificationDispatchJobHandler,
    OperationalAlertScanJobHandler,
    OperationalAlertSchedulerBootstrap,
  ],
  exports: [
    BackgroundJobsRepository,
    BackgroundJobEnqueueService,
    BackgroundJobHandlerRegistry,
    BackgroundWorkerService,
    NotificationDispatchJobHandler,
    OperationalAlertScanJobHandler,
  ],
})
export class BackgroundJobsModule {}

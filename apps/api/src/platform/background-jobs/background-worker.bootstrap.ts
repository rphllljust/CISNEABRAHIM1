import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationDispatchJobHandler } from './handlers/notification-dispatch.handler';
import { Inject, Optional } from '@nestjs/common';
import type { BackgroundJobHandler } from './domain/job-handler.types';

export const BACKGROUND_JOB_EXTRA_HANDLERS = Symbol('BACKGROUND_JOB_EXTRA_HANDLERS');
import { OperationalAlertScanJobHandler } from './handlers/operational-alert-scan.handler';
import { BackgroundJobHandlerRegistry } from './services/background-job-handler.registry';
import { BackgroundWorkerService } from './services/background-worker.service';

@Injectable()
export class BackgroundWorkerBootstrapService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackgroundWorkerBootstrapService.name);

  constructor(
    private readonly worker: BackgroundWorkerService,
    private readonly registry: BackgroundJobHandlerRegistry,
    private readonly notificationHandler: NotificationDispatchJobHandler,
    private readonly operationalAlertHandler: OperationalAlertScanJobHandler,
    @Optional() @Inject(BACKGROUND_JOB_EXTRA_HANDLERS)
    private readonly extraHandlers?: BackgroundJobHandler[],
  ) {}

  onModuleInit(): void {
    this.registry.register(this.notificationHandler);
    this.registry.register(this.operationalAlertHandler);
    for (const handler of this.extraHandlers ?? []) {
      this.registry.register(handler);
    }
    this.worker.start();
    this.logger.log('Background worker bootstrap complete');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.stop();
  }
}

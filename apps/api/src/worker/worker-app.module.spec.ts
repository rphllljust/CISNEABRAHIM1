import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { EconomicPostingService } from '../accounting/services/economic-posting.service';
import { ECONOMIC_EVENT_CONSUMER } from '../platform/outbox/domain/economic-event-consumer.port';
import { OutboxPublisherService } from '../platform/outbox/services/outbox-publisher.service';
import { WorkerAppModule } from './worker-app.module';

describe('Worker application composition', () => {
  it('routes economic outbox events to the Accounting posting consumer', async () => {
    const module = await Test.createTestingModule({ imports: [WorkerAppModule] }).compile();
    try {
      const consumer = module.get(EconomicPostingService);
      expect(module.get(ECONOMIC_EVENT_CONSUMER)).toBe(consumer);
      const publisher = module.get<{
        economicConsumer?: unknown;
      }>(OutboxPublisherService);
      expect(publisher.economicConsumer).toBe(consumer);
    } finally {
      await module.close();
    }
  });
});

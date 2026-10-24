import { Module } from '@nestjs/common';
import { EventsModule } from '../../events/events.module';
import { BackgroundJobsModule } from '../background-jobs/background-jobs.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OutboxRepository } from './repositories/outbox.repository';
import { OutboxEconomicEventReader } from './repositories/outbox-economic-event.reader';
import { EconomicEventLedgerRepository } from './repositories/economic-event-ledger.repository';
import { EconomicFactPublisher } from './services/economic-fact.publisher';
import { OutboxDomainEventWriter } from './services/outbox-domain-event.writer';
import { OutboxPublisherService } from './services/outbox-publisher.service';
import { OutboxPublisherWorkerService } from './services/outbox-publisher.worker.service';
import { ECONOMIC_OUTBOX_READER } from './domain/economic-outbox-reader.port';

/**
 * F1.1 — a porta `ECONOMIC_EVENT_CONSUMER` é satisfeita pelo módulo que a fornece
 * (ACCOUNTING). A outbox NÃO importa o módulo de ACCOUNTING: ela recebe o provider
 * já resolvido pelo container global de quem montou a aplicação.
 *
 * Um evento econômico NÃO pode ser marcado PUBLISHED sem decisão contábil — por
 * isso `OutboxPublisherService` exige o consumidor no construtor (sem `@Optional`).
 * O módulo que monta a aplicação (AppModule / harness de teste) precisa, portanto,
 * incluir `AccountingModule` junto de `OutboxModule`; é ordem de composição, não
 * acoplamento de fronteira.
 */
@Module({
  imports: [DatabaseModule, EventsModule, BackgroundJobsModule],
  providers: [
    OutboxRepository,
    OutboxEconomicEventReader,
    EconomicFactPublisher,
    EconomicEventLedgerRepository,
    {
      provide: ECONOMIC_OUTBOX_READER,
      useExisting: OutboxEconomicEventReader,
    },
    OutboxDomainEventWriter,
    OutboxPublisherService,
    OutboxPublisherWorkerService,
  ],
  exports: [
    OutboxRepository,
    OutboxEconomicEventReader,
    EconomicFactPublisher,
    EconomicEventLedgerRepository,
    ECONOMIC_OUTBOX_READER,
    OutboxDomainEventWriter,
    OutboxPublisherService,
    OutboxPublisherWorkerService,
  ],
})
export class OutboxModule {}


/**
 * F1.1 — PORTA DO CONSUMIDOR DE FATO ECONÔMICO.
 *
 * O `OutboxPublisherService` vive em `platform/outbox` (PLATFORM). O consumidor real
 * (decisão contábil + journal) vive em `accounting/`. PLATFORM não pode depender de
 * ACCOUNTING — o grafo de bounded contexts proíbe, e o gate `module-boundary-rules`
 * falha o build se a seta existir.
 *
 * A porta é o mecanismo de inversão: PLATFORM declara o CONTRATO, ACCOUNTING
 * implementa e o módulo de boot faz o binding. É o mesmo padrão já usado em
 * `enterprise-core-ports` (AccountingLedgerPort): vocabulário de fronteira em
 * `platform/bounded-contexts`, implementação no contexto dono.
 *
 * A porta é OBRIGATÓRIA (não `@Optional`): um evento econômico não pode ser
 * considerado publicado sem decisão contábil. Porta opcional reintroduziria o
 * "best-effort silencioso" que esta fase elimina.
 */

export const ECONOMIC_EVENT_CONSUMER = Symbol('ECONOMIC_EVENT_CONSUMER');

export type EconomicEventConsumptionResult = {
  outcome: string;
  journalEntryId: string;
  postingRequestId: string;
};

export type EconomicEventConsumerPort = {
  /** Consome o payload do evento. DEVE lançar em falha — nunca engolir. */
  consume(rawPayload: unknown): Promise<EconomicEventConsumptionResult>;
};

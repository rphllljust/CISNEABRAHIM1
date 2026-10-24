/**
 * F1.1 — PORTA DE LEITURA DA OUTBOX, do ponto de vista de ACCOUNTING.
 *
 * O reprocessamento autorizado (`EconomicPostingService.retryFromOutbox`) precisa
 * reler o evento persistido para reentregá-lo ao consumo. ACCOUNTING não deve importar
 * o repositório de PLATFORM (seta proibida no grafo), então depende desta porta — o
 * mesmo padrão do `EconomicEventConsumerPort`, invertido.
 *
 * A implementação fica em PLATFORM (`OutboxRepository` já satisfaz o contrato).
 */

export const ECONOMIC_OUTBOX_READER = Symbol('ECONOMIC_OUTBOX_READER');

export type PersistedEconomicEvent = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: string;
};

export type EconomicOutboxReaderPort = {
  findById(outboxEventId: string): Promise<PersistedEconomicEvent | null>;
  /**
   * Fecha o transporte quando o reprocessamento teve êxito.
   *
   * Um evento FAILED que acabou de ser contabilizado com sucesso precisa sair de
   * FAILED — senão a worklist continuaria mostrando uma exceção já resolvida. Isto é
   * o inverso de "esconder a falha": a falha fica visível ATÉ ser resolvida.
   */
  markPublishedIfPending(outboxEventId: string): Promise<void>;
  /**
   * F1.2 — regrava o MOTIVO da falha após uma tentativa manual malsucedida.
   *
   * Atualiza `last_error` (a causa diagnosticável). NÃO altera `status`: converter
   * falha em sucesso, ou rebaixar FAILED para PENDING por aqui, seria mudar a
   * semântica do transporte — quem governa status é o publisher, com backoff e limite.
   */
  recordFailureReason(outboxEventId: string, reason: string): Promise<void>;
};

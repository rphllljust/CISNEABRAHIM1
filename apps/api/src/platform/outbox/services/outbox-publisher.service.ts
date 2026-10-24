import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DomainEventsRepository } from '../../../events/repositories/domain-events.repository';
import { isEconomicDomainEventType } from '../../../events/domain/domain-event-type';
import { BackgroundJobEnqueueService } from '../../background-jobs/services/background-job-enqueue.service';
import {
  computeOutboxBackoffDelayMs,
  loadOutboxPublisherConfig,
  type OutboxPublisherConfig,
} from '../config/outbox-publisher.config';
import { OUTBOX_EVENT_STATUSES } from '../domain/outbox-status';
import type { OutboxEventRow } from '../domain/outbox-event.types';
import { OutboxRepository } from '../repositories/outbox.repository';
import {
  ECONOMIC_EVENT_CONSUMER,
  type EconomicEventConsumerPort,
} from '../domain/economic-event-consumer.port';

@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly config: OutboxPublisherConfig;

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly domainEventsRepository: DomainEventsRepository,
    private readonly backgroundJobEnqueueService: BackgroundJobEnqueueService,
    /**
     * F1.1 — consumidor contábil do fato econômico.
     *
     * `@Optional()` é deliberado e NÃO enfraquece a garantia: a ausência do
     * consumidor é falha FECHADA no ponto de uso. Em `publishClaimedEvent`, um evento
     * econômico sem consumidor registrado LANÇA `ECONOMIC_EVENT_CONSUMER_UNAVAILABLE`
     * e o evento vai para retry/FAILED — nunca é marcado PUBLISHED em silêncio.
     *
     * A opcionalidade serve só à composição de módulos que não incluem ACCOUNTING
     * (ex.: um worker que só publica eventos operacionais). Um `@Optional` que
     * permitisse publicar sem decidir seria exatamente o `try*` que esta fase remove.
     */
    @Optional()
    @Inject(ECONOMIC_EVENT_CONSUMER)
    private readonly economicConsumer?: EconomicEventConsumerPort,
  ) {
    this.config = loadOutboxPublisherConfig();
  }

  /**
   * Publica UM evento reivindicado.
   *
   * ─────────────────────────────────────────────────────────────────────────────────
   * ORDEM DAS RESPONSABILIDADES (F1.1)
   *
   * 1. FATO ECONÔMICO → ACCOUNTING decide posting ANTES de o evento ser considerado
   *    publicado. Se a decisão contábil falhar, o evento NÃO é marcado PUBLISHED: ele
   *    volta para retry ou vira FAILED com `last_error`. Era exatamente aqui que o
   *    `try*` engolia a falha.
   * 2. Registro em `evt.domain_events` (notificação/leitores gerais) — inalterado.
   * 3. Intenções de notificação → background job — inalterado.
   *
   * A exceção do consumidor contábil PROPAGA para o `catch` deste método, que já
   * aplica retry com backoff e FAILED com motivo. Nenhum caminho retorna sucesso sem
   * consequência contábil quando ela é devida.
   */
  async publishClaimedEvent(event: OutboxEventRow): Promise<void> {
    try {
      if (isEconomicDomainEventType(event.event_type)) {
        // Falha aqui NÃO é engolida: sobe para o catch e vira retry/FAILED.
        // Ausência do consumidor também é falha — nunca marca PUBLISHED em silêncio.
        if (!this.economicConsumer) {
          throw new Error(
            'ECONOMIC_EVENT_CONSUMER_UNAVAILABLE: ACCOUNTING module is not composed with the outbox',
          );
        }
        await this.economicConsumer.consume(event.payload);
      }

      const publishResult = await this.domainEventsRepository.recordDomainEvent({
        eventType: event.event_type,
        aggregateType: event.aggregate_type,
        aggregateId: event.aggregate_id,
        payload: event.payload,
        occurredAt: event.occurred_at,
        idempotencyKey: event.idempotency_key,
      });

      for (const notificationIntentId of publishResult.notificationIntentIds) {
        const intents = await this.domainEventsRepository.listNotificationIntents(
          publishResult.domainEventId,
        );
        const intent = intents.find((row) => row.id === notificationIntentId);
        if (!intent) {
          continue;
        }
        await this.backgroundJobEnqueueService.enqueueNotificationDispatch({
          notificationIntentId: intent.id,
          domainEventId: publishResult.domainEventId,
          templateKey: intent.template_key,
        });
      }

      await this.outboxRepository.markPublished(event.id);
      this.logger.log(`Outbox event published id=${event.id} type=${event.event_type}`);
    } catch (error) {
      const message = describePostingFailure(error);
      if (event.attempts >= event.max_attempts) {
        await this.outboxRepository.markFailed(event.id, message);
        this.logger.warn(`Outbox event failed permanently id=${event.id}: ${message}`);
        return;
      }
      const delayMs = computeOutboxBackoffDelayMs(
        event.attempts,
        this.config.backoffBaseMs,
        this.config.backoffMaxMs,
      );
      const runAfter = new Date(Date.now() + delayMs).toISOString();
      await this.outboxRepository.scheduleRetry(event.id, message, runAfter);
      this.logger.warn(
        `Outbox event scheduled for retry id=${event.id} attempt=${event.attempts}/${event.max_attempts}: ${message}`,
      );
    }
  }

  async publishBatch(workerId: string, limit: number): Promise<number> {
    const claimed = await this.outboxRepository.claimPending(
      workerId,
      limit,
      this.config.leaseDurationMs,
    );
    for (const event of claimed) {
      await this.publishClaimedEvent(event);
    }
    return claimed.length;
  }

  getConfig(): OutboxPublisherConfig {
    return this.config;
  }

  getStatusLabel(status: string): string {
    return status === OUTBOX_EVENT_STATUSES.Published ? 'published' : status.toLowerCase();
  }
}

export { ECONOMIC_EVENT_CONSUMER };

/**
 * F1.2 — CAUSA DE FALHA EM LINGUAGEM DIAGNOSTICÁVEL.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ISTO CORRIGE
 *
 * `error.message` numa `HttpException` do Nest é o NOME DA CLASSE, não a causa. A fila
 * de exceções exibia literalmente "Accounting Http Exception" — o operador via que algo
 * falhou e não tinha como saber O QUÊ. Uma falha que não diz a causa não é observável.
 *
 * O código de negócio real vive no corpo (`getResponse()`): `{ code, message }`. É dele
 * que a mensagem precisa sair — `ACCOUNTING_RULE_NOT_CONFIGURED` é acionável;
 * "Accounting Http Exception" não é.
 *
 * `last_error` é persistido na outbox e mostrado na Central de Contabilidade, então
 * este texto é superfície de operador: precisa ser curto e concreto.
 */
export function describePostingFailure(error: unknown): string {
  /**
   * Nome de classe do próprio erro nunca é detalhe de negócio.
   *
   * Uma `HttpException` do Nest tem `message === "Accounting Http Exception"` — o NOME
   * da classe. Quando o corpo traz `code`, esse nome é ruído e não entra na mensagem:
   * `ACCOUNTING_RULE_NOT_CONFIGURED: Accounting Http Exception` informa menos que
   * `ACCOUNTING_RULE_NOT_CONFIGURED` sozinho, porque sugere uma segunda causa que não
   * existe. Aqui descartamos explicitamente esse eco.
   */
  const className = error instanceof Error ? error.constructor?.name : null;
  /**
   * Reconhece o eco do nome de classe mesmo sem `constructor` confiável.
   *
   * `HttpException` do Nest monta `message` a partir do NOME da própria classe
   * (`"AccountingHttpException"` → `"Accounting Http Exception"`). Comparar apenas com
   * `error.constructor.name` falha quando o erro atravessa uma fronteira e chega
   * reconstruído — e então o ruído volta para a tela do operador. Aqui o próprio
   * TEXTO é a evidência: se termina em "Exception"/"Error" e o corpo já traz um
   * `code`, ele é rótulo de framework, não causa de negócio.
   */
  const isClassEcho = (value: string): boolean => {
    const trimmed = value.trim();
    if (className) {
      // "AccountingHttpException" → "Accounting Http Exception"
      const spaced = className.replace(/([a-z])([A-Z])/g, '$1 $2');
      if (trimmed === className || trimmed === spaced) {
        return true;
      }
    }
    return /^[A-Z][A-Za-z0-9]*(?:\s+[A-Za-z0-9]+)*\s+(?:Exception|Error)$/.test(trimmed);
  };

  /**
   * HttpException: o corpo carrega o código de domínio.
   *
   * Duas formas circulam no projeto e ambas precisam ser lidas, senão a extração
   * "funciona em teste isolado e falha em produção":
   *
   *  1. PLANO   — `{ code, message }`
   *  2. ANINHADO — `{ error: { code, message } }` (é o que
   *     `buildDomainHttpExceptionBody` produz, portanto todo
   *     `AccountingHttpException` real cai aqui)
   *
   * Ler só o plano fazia o código nunca ser encontrado, e a função caía no
   * `error.message` da HttpException — que é o NOME da classe. O operador via
   * `... : Accounting Http Exception` em vez da causa.
   */
  const response = (error as { getResponse?: () => unknown })?.getResponse?.();
  if (response && typeof response === 'object') {
    const outer = response as {
      code?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const nested =
      outer.error && typeof outer.error === 'object'
        ? (outer.error as { code?: unknown; message?: unknown })
        : null;

    const code =
      typeof outer.code === 'string'
        ? outer.code
        : typeof nested?.code === 'string'
          ? nested.code
          : null;
    const rawDetail =
      typeof outer.message === 'string'
        ? outer.message
        : typeof nested?.message === 'string'
          ? nested.message
          : typeof outer.error === 'string'
            ? outer.error
            : null;
    const detail = rawDetail && !isClassEcho(rawDetail) && rawDetail !== code ? rawDetail : null;
    if (code && detail) {
      return `${code}: ${detail}`;
    }
    if (code) {
      return code;
    }
    if (detail) {
      return detail;
    }
  }
  if (error instanceof Error) {
    // Erro de domínio (AccountingError etc.) já traz o código em `message`.
    const maybeCode = (error as { code?: unknown }).code;
    if (typeof maybeCode === 'string') {
      return error.message === maybeCode ? maybeCode : `${maybeCode}: ${error.message}`;
    }
    return error.message;
  }
  return String(error);
}

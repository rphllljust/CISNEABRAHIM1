import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { isEconomicDomainEventType } from '../../events/domain/domain-event-type';
import { AccountingError } from '../domain/ledger';
import { POSTING_EVENTS, originForEvent, type PostingEventKind } from '../domain/posting';
import {
  ECONOMIC_EVENT_KINDS,
  type EconomicEventKind,
  type EconomicEventPayloadV1,
  assertEconomicEventPayloadV1,
  isReversalEconomicEvent,
  originalEventKindForEconomicReversal,
} from '../../platform/bounded-contexts/economic-event-contract';

/**
 * Origem do lançamento derivada do evento de posting.
 *
 * Substitui o `'FINANCE'` fixo da F1.1. Com FISCAL e PAYROLL publicando pelo mesmo
 * mecanismo, uma origem fixa faria `assertPostingOrigin` recusar o fato — ou, pior,
 * gravaria origem errada no posting e quebraria a trilha.
 */
function postingOriginForEvent(eventKind: PostingEventKind): string {
  return originForEvent(eventKind);
}
import {
  ECONOMIC_OUTBOX_READER,
  type EconomicOutboxReaderPort,
} from '../../platform/outbox/domain/economic-outbox-reader.port';
import { describePostingFailure } from '../../platform/outbox/services/outbox-publisher.service';
import { AccountingAccessService } from './accounting-access.service';
import { AccountingAccessAuthz } from './accounting-access.authz';

/**
 * F1.1 — CONSUMIDOR CONTÁBIL DO FATO ECONÔMICO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O QUE MUDOU, E POR QUÊ
 *
 * ANTES: FINANCE chamava `tryPost*` e ENGOLIA a falha. O posting podia não acontecer
 * e ninguém sabia — nem o operador, nem o fechamento, nem a trilha.
 *
 * AGORA: o fato econômico chega pela outbox (transacionalmente ligado ao commit
 * financeiro). Este serviço decide o posting e devolve um RESULTADO EXPLÍCITO:
 *
 *   POSTED     — journal emitido (ou já existente: replay idempotente)
 *   REVERSED   — journal compensatório emitido
 *   NOT_POSTED — a decisão contábil foi tomada e recusada/proibida, COM MOTIVO
 *
 * `NOT_POSTED` NÃO é silêncio: o erro sobe, o evento da outbox é marcado FAILED com
 * `last_error` e fica reprocessável. Nada é engolido.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O QUE FINANCE **NÃO** FAZ COM ISSO
 *
 * FINANCE nunca chama `posting` diretamente. Ele publica o fato; este consumo é do
 * ACCOUNTING. É a razão de o serviço viver em `accounting/`.
 */

export const ECONOMIC_POSTING_OUTCOME = {
  Posted: 'POSTED',
  Reversed: 'REVERSED',
  /** Já existia journal para o fato (redelivery) — não duplicou. */
  AlreadyPosted: 'ALREADY_POSTED',
} as const;

export type EconomicPostingOutcome =
  (typeof ECONOMIC_POSTING_OUTCOME)[keyof typeof ECONOMIC_POSTING_OUTCOME];

export type EconomicPostingResult = {
  outcome: EconomicPostingOutcome;
  journalEntryId: string;
  postingRequestId: string;
};

/**
 * Mapa evento econômico → evento de posting contábil.
 *
 * O conjunto é FECHADO e explícito: um evento econômico sem regra contábil conhecida
 * falha com `ACCOUNTING_ECONOMIC_EVENT_UNSUPPORTED` em vez de ser ignorado. Evento
 * ignorado em silêncio é exatamente o defeito que esta fase existe para eliminar.
 */
const POSTING_EVENT_FOR_ECONOMIC_EVENT: Partial<Record<EconomicEventKind, PostingEventKind>> = {
  // ── FINANCE ────────────────────────────────────────────────────────────────
  [ECONOMIC_EVENT_KINDS.SettlementConfirmed]: POSTING_EVENTS.SettlementConfirmed,
  /**
   * F1.1 — o estorno tem evento de posting PRÓPRIO.
   *
   * Antes ele reusava `SettlementConfirmed`. Como `acc.accounting_posting_requests` é
   * único por (origin, event, source), o registro da compensação colidia com o do
   * fato original: a reversão era lida como "já postada" e o journal compensatório
   * nunca nascia. `SETTLEMENT_REVERSED` / `PAYMENT_REVERSED` dão chave própria.
   */
  [ECONOMIC_EVENT_KINDS.SettlementReversed]: POSTING_EVENTS.SettlementReversed,
  [ECONOMIC_EVENT_KINDS.PaymentConfirmed]: POSTING_EVENTS.PaymentConfirmed,
  [ECONOMIC_EVENT_KINDS.PaymentReversed]: POSTING_EVENTS.PaymentReversed,
  // ── F1.2 — FISCAL ──────────────────────────────────────────────────────────
  [ECONOMIC_EVENT_KINDS.FiscalDocumentAuthorized]: POSTING_EVENTS.FiscalDocumentAuthorized,
  [ECONOMIC_EVENT_KINDS.FiscalDocumentCancelled]: POSTING_EVENTS.FiscalDocumentCancelled,
  [ECONOMIC_EVENT_KINDS.TaxCalculationConfirmed]: POSTING_EVENTS.TaxCalculationConfirmed,
  // ── F1.2 — INVENTORY / PAYROLL ─────────────────────────────────────────────
  [ECONOMIC_EVENT_KINDS.InventoryMovementPosted]: POSTING_EVENTS.InventoryMovementPosted,
  [ECONOMIC_EVENT_KINDS.PayrollClosed]: POSTING_EVENTS.PayrollClosed,
  [ECONOMIC_EVENT_KINDS.PayrollReopened]: POSTING_EVENTS.PayrollReopened,
};

export function postingEventForEconomicEvent(eventKind: EconomicEventKind): PostingEventKind {
  const mapped = POSTING_EVENT_FOR_ECONOMIC_EVENT[eventKind];
  if (!mapped) {
    throw new AccountingError('ACCOUNTING_ECONOMIC_EVENT_UNSUPPORTED');
  }
  return mapped;
}

@Injectable()
export class EconomicPostingService {
  private readonly logger = new Logger(EconomicPostingService.name);

  constructor(
    private readonly accounting: AccountingAccessService,
    private readonly authz: AccountingAccessAuthz,
    @Inject(ECONOMIC_OUTBOX_READER)
    private readonly outboxReader: EconomicOutboxReaderPort,
  ) {}

  /**
   * Consome o payload do evento econômico e aplica a decisão contábil.
   *
   * IDEMPOTENTE por construção: `postConfirmedEvent` deriva o `postingIdempotencyKey`
   * e o índice único `posting_requests_event_source_uidx` devolve o posting existente.
   * Redelivery da outbox NÃO duplica journal.
   *
   * LANÇA em caso de falha — o chamador (publisher da outbox) transforma em retry ou
   * FAILED, com motivo. Nunca retorna silenciosamente sem journal.
   */
  async consume(rawPayload: unknown): Promise<EconomicPostingResult> {
    const payload = assertEconomicEventPayloadV1(rawPayload);
    const reversal = isReversalEconomicEvent(payload.eventKind);
    const postingEventKind = postingEventForEconomicEvent(payload.eventKind);

    if (reversal) {
      return this.applyReversal(payload, postingEventKind);
    }
    return this.applyPosting(payload, postingEventKind);
  }

  /**
   * F1.1 — REPROCESSAMENTO AUTORIZADO de um fato econômico.
   *
   * É o comando que a worklist oferece quando o posting falhou. Ele NÃO é um "força
   * posting": é a reentrega do MESMO evento persistido, com a decisão contábil sendo
   * reavaliada (regra publicada, período aberto). A idempotência do posting garante
   * que reprocessar cinco vezes não cria cinco journals.
   *
   * Autorização: exige `accounting:posting-request:create` — quem pode pedir posting
   * pode reprocessar; quem não pode, recebe negação do próprio ACCOUNTING.
   *
   * Falha aqui PROPAGA (não engole). Quem chama sabe que continua falhando.
   */
  async retryFromOutbox(
    actor: IdentityAuthzContext,
    outboxEventId: string,
  ): Promise<EconomicPostingResult> {
    await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingPostingRequest, {
      id: actor.identityId,
      unitId: '',
    });
    const event = await this.outboxReader.findById(outboxEventId);
    if (!event) {
      throw new AccountingError('ACCOUNTING_NOT_FOUND');
    }
    if (!isEconomicDomainEventType(event.event_type)) {
      throw new AccountingError('ACCOUNTING_ECONOMIC_EVENT_UNSUPPORTED');
    }
    /**
     * F1.2 — a falha do reprocessamento ATUALIZA a causa persistida.
     *
     * Antes, reprocessar e falhar de novo deixava o `last_error` antigo na outbox: o
     * operador corrigia o problema, tentava de novo e via a MESMA mensagem velha sem
     * saber se algo mudou. Agora o motivo é regravado a cada tentativa.
     *
     * O STATUS não é tocado aqui: quem decide FAILED/RETRY é o publisher (backoff e
     * limite de tentativas). Isto atualiza MOTIVO, nunca converte falha em sucesso.
     */
    try {
      const result = await this.consume(event.payload);
      // Sucesso = o transporte pode ser fechado.
      await this.outboxReader.markPublishedIfPending(outboxEventId);
      return result;
    } catch (error) {
      await this.outboxReader.recordFailureReason(outboxEventId, describePostingFailure(error));
      throw error;
    }
  }

  private async applyPosting(
    payload: EconomicEventPayloadV1,
    postingEventKind: PostingEventKind,
  ): Promise<EconomicPostingResult> {
    const posted = await this.accounting.postConfirmedEvent({
      originKind: postingOriginForEvent(postingEventKind),
      eventKind: postingEventKind,
      sourceId: payload.sourceId,
      unitId: payload.unitId,
      amount: payload.amount,
      currencyCode: payload.currencyCode,
      occurredOn: payload.occurredOn,
      sourceReference: payload.sourceReference ?? payload.sourceId,
      actorIdentityId: payload.actorIdentityId,
      context: payload.context,
    });
    this.logger.log(
      `Economic event posted kind=${payload.eventKind} source=${payload.sourceId} journal=${posted.journalEntryId} idempotent=${posted.idempotent}`,
    );
    return {
      outcome: posted.idempotent
        ? ECONOMIC_POSTING_OUTCOME.AlreadyPosted
        : ECONOMIC_POSTING_OUTCOME.Posted,
      journalEntryId: posted.journalEntryId,
      postingRequestId: posted.postingRequestId,
    };
  }

  /**
   * Reversão: journal COMPENSATÓRIO.
   *
   * `reverseConfirmedEvent` cria um `acc.journal_entries` de `kind = 'REVERSAL'`
   * apontando o original (`reverses_entry_id`). O journal original permanece POSTED,
   * com seus valores. Nunca DELETE, nunca UPDATE de histórico — a trilha contábil é
   * append-only por construção.
   *
   * F1.2 — a busca do fato original usa o `eventKind` DERIVADO do evento de estorno
   * (`originalEventKindForEconomicReversal`), não o valor cru. Um cancelamento fiscal
   * compensa a AUTORIZAÇÃO — comparar com `FISCAL_DOCUMENT_CANCELLED` nunca acharia
   * o posting original.
   */
  private async applyReversal(
    payload: EconomicEventPayloadV1,
    postingEventKind: PostingEventKind,
  ): Promise<EconomicPostingResult> {
    const originalSourceId = payload.reversesSourceId;
    if (!originalSourceId) {
      throw new AccountingError('ACCOUNTING_ECONOMIC_REVERSAL_WITHOUT_ORIGIN');
    }
    const originalPostingEvent = POSTING_EVENT_FOR_ECONOMIC_EVENT[
      originalEventKindForEconomicReversal(payload.eventKind) ?? payload.eventKind
    ];
    if (!originalPostingEvent) {
      throw new AccountingError('ACCOUNTING_ECONOMIC_EVENT_UNSUPPORTED');
    }
    const reversed = await this.accounting.reverseConfirmedEvent({
      originKind: postingOriginForEvent(originalPostingEvent),
      eventKind: postingEventKind,
      sourceId: originalSourceId,
      unitId: payload.unitId,
      actorIdentityId: payload.actorIdentityId,
      reason: `Economic event ${payload.eventKind} for source ${payload.sourceId}`,
    });
    if (!reversed.journalEntryId || !reversed.postingRequestId) {
      // O fato original não tinha posting: a reversão não tem o que compensar.
      // Isso é um estado DIAGNOSTICÁVEL, não um sucesso silencioso.
      throw new AccountingError('ACCOUNTING_ECONOMIC_REVERSAL_WITHOUT_POSTING');
    }
    this.logger.log(
      `Economic reversal posted kind=${payload.eventKind} source=${payload.sourceId} journal=${reversed.journalEntryId} idempotent=${reversed.idempotent}`,
    );
    return {
      outcome: reversed.idempotent
        ? ECONOMIC_POSTING_OUTCOME.AlreadyPosted
        : ECONOMIC_POSTING_OUTCOME.Reversed,
      journalEntryId: reversed.journalEntryId,
      postingRequestId: reversed.postingRequestId,
    };
  }
}

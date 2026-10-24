import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { OutboxDomainEventWriter } from '../services/outbox-domain-event.writer';
import {
  ECONOMIC_EVENT_SCHEMA_VERSION,
  assertEconomicEventPayloadV1,
  economicEventIdempotencyKey,
  type EconomicEventKind,
  type EconomicEventPayloadV1,
  type EconomicEventSourceKind,
} from '../../bounded-contexts/economic-event-contract';

/**
 * F1.2 — PUBLICADOR ATÔMICO DO FATO ECONÔMICO (MECANISMO GENÉRICO).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Na F1.1, FINANCE publicava o fato dentro da própria transação e isso estava certo —
 * mas o código que fazia isso morava em `finance/repositories/economic-events.repository.ts`
 * e era específico daquele domínio. Quando FISCAL, INVENTORY e PAYROLL precisaram do
 * MESMO comportamento, a saída óbvia seria copiar. Copiar criaria uma SEGUNDA espinha
 * econômica: dois lugares com a mesma chave de idempotência, prontos para divergir.
 *
 * Aqui está o mecanismo, em PLATFORM, sem conhecer domínio nenhum:
 *
 *   DOMAIN TRANSACTION (o chamador é dono do BEGIN/COMMIT)
 *     → este método grava o EVENTO na outbox
 *     → se o chamador der ROLLBACK, o evento desaparece junto
 *     → se este método falhar, o fato NÃO é confirmado
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO **NÃO** FAZ
 *
 * - Não decide contabilidade, conta, competência ou journal. Isso é ACCOUNTING.
 * - Não abre transação: recebe o `PoolClient` do chamador. Abrir aqui quebraria a
 *   atomicidade — exatamente o defeito que a F1.2 elimina.
 * - Não importa nenhum contexto de negócio. `PLATFORM → BUSINESS DOMAIN` é proibido.
 */
export type EconomicFactInput = {
  unitId: string;
  eventKind: EconomicEventKind;
  sourceKind: EconomicEventSourceKind;
  sourceId: string;
  amount: string;
  currencyCode: string;
  /** Data civil (`YYYY-MM-DD`) ou o instante do fato — normalizado no contrato. */
  occurredOn: string | Date;
  actorIdentityId: string;
  sourceReference?: string | null;
  reversesSourceId?: string | null;
  context?: Record<string, unknown>;
};

export type PublishedEconomicFact = {
  outboxEventId: string;
  idempotencyKey: string;
  /** `true` quando o mesmo fato já estava na outbox (replay idempotente). */
  idempotent: boolean;
};

const AGGREGATE_TYPE = 'economic-fact';

@Injectable()
export class EconomicFactPublisher {
  constructor(private readonly outboxWriter: OutboxDomainEventWriter) {}

  /**
   * Publica o fato na outbox DENTRO da transação do chamador.
   *
   * Chamar fora de uma transação não é proibido pelo tipo, mas é um erro de uso: o
   * evento poderia commitar sem o fato. Todos os chamadores do repositório de domínio
   * passam o `PoolClient` aberto do próprio comando.
   */
  async publish(client: PoolClient, input: EconomicFactInput): Promise<PublishedEconomicFact> {
    const occurredOn = toCivilDate(input.occurredOn);

    const payload: EconomicEventPayloadV1 = assertEconomicEventPayloadV1({
      schemaVersion: ECONOMIC_EVENT_SCHEMA_VERSION,
      eventKind: input.eventKind,
      unitId: input.unitId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      amount: input.amount,
      currencyCode: input.currencyCode,
      occurredOn,
      actorIdentityId: input.actorIdentityId,
      sourceReference: input.sourceReference ?? null,
      reversesSourceId: input.reversesSourceId ?? null,
      ...(input.context ? { context: input.context } : {}),
    });

    const idempotencyKey = economicEventIdempotencyKey({
      eventKind: input.eventKind,
      sourceId: input.sourceId,
      reversesSourceId: input.reversesSourceId,
    });

    const outboxEventId = await this.outboxWriter.appendEconomicEvent(client, {
      aggregateType: AGGREGATE_TYPE,
      aggregateId: input.sourceId,
      occurredAt: `${occurredOn}T00:00:00.000Z`,
      payload,
    });

    return { outboxEventId, idempotencyKey, idempotent: false };
  }
}

/**
 * Normaliza a data do fato para `YYYY-MM-DD` civil.
 *
 * Aceita `Date` porque `timestamptz` chega assim do driver `pg` — a F1.1 quebrou
 * exatamente aqui (`occurredOn.slice is not a function`). A normalização fica no
 * MECANISMO para que nenhum domínio precise repetir essa armadilha.
 */
export function toCivilDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('ECONOMIC_EVENT_OCCURRED_ON_INVALID');
    }
    return value.toISOString().slice(0, 10);
  }
  const trimmed = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  throw new Error('ECONOMIC_EVENT_OCCURRED_ON_INVALID');
}

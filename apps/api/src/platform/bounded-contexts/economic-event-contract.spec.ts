import { describe, expect, it } from 'vitest';
import { JOURNAL_SOURCE_KINDS } from '../../accounting/domain/ledger';
import { ECONOMIC_JOURNAL_SOURCE_KINDS } from './economic-journal-source';
import {
  ECONOMIC_EVENT_KINDS,
  ECONOMIC_EVENT_SCHEMA_VERSION,
  ECONOMIC_EVENT_SOURCE_KINDS,
  assertEconomicEventPayloadV1,
  economicEventIdempotencyKey,
  isEconomicEventKind,
  isReversalEconomicEvent,
  journalSourceKindForEconomicEvent,
  type EconomicEventPayloadV1,
} from './economic-event-contract';
import { isEconomicDomainEventType } from '../../events/domain/domain-event-type';

/**
 * F1.1 — CONTRATO DO FATO ECONÔMICO.
 *
 * Estes testes são a prova de que a fronteira FINANCE → ACCOUNTING tem contrato
 * explícito, fechado e idempotente. Eles falham se o espelho divergir da fonte real,
 * se um payload inválido atravessar, ou se a identidade do fato deixar de ser estável
 * (estabilidade é o que impede redelivery de duplicar journal).
 */

function validPayload(overrides: Partial<EconomicEventPayloadV1> = {}): EconomicEventPayloadV1 {
  return {
    schemaVersion: ECONOMIC_EVENT_SCHEMA_VERSION,
    eventKind: ECONOMIC_EVENT_KINDS.SettlementConfirmed,
    unitId: 'unit-1',
    sourceKind: ECONOMIC_EVENT_SOURCE_KINDS.ReceivableSettlement,
    sourceId: 'settlement-1',
    amount: '1500.0000',
    currencyCode: 'BRL',
    occurredOn: '2026-10-16',
    actorIdentityId: 'actor-1',
    sourceReference: 'REC-001',
    reversesSourceId: null,
    ...overrides,
  };
}

describe('economic event contract — espelho de JournalSourceKind', () => {
  it('espelha EXATAMENTE JOURNAL_SOURCE_KINDS de accounting', () => {
    // Se ACCOUNTING ganhar uma origem nova sem atualizar o contrato, este teste falha
    // — de propósito: o espelho existe para não obrigar PLATFORM a importar ACCOUNTING,
    // não para permitir que os dois divirjam em silêncio.
    expect(Object.values(ECONOMIC_JOURNAL_SOURCE_KINDS).sort()).toEqual(
      Object.values(JOURNAL_SOURCE_KINDS).sort(),
    );
  });

  it('mapeia cada evento econômico para uma origem de lançamento existente', () => {
    const allowed = new Set(Object.values(JOURNAL_SOURCE_KINDS));
    for (const kind of Object.values(ECONOMIC_EVENT_KINDS)) {
      expect(allowed.has(journalSourceKindForEconomicEvent(kind))).toBe(true);
    }
  });
});

describe('economic event contract — classificação de estorno', () => {
  it('marca apenas os eventos REVERSED como reversão', () => {
    expect(isReversalEconomicEvent(ECONOMIC_EVENT_KINDS.SettlementReversed)).toBe(true);
    expect(isReversalEconomicEvent(ECONOMIC_EVENT_KINDS.PaymentReversed)).toBe(true);
    expect(isReversalEconomicEvent(ECONOMIC_EVENT_KINDS.SettlementConfirmed)).toBe(false);
    expect(isReversalEconomicEvent(ECONOMIC_EVENT_KINDS.PaymentConfirmed)).toBe(false);
  });
});

describe('economic event contract — identidade do fato (idempotência)', () => {
  it('é estável para o MESMO fato, para que redelivery não duplique posting', () => {
    const first = economicEventIdempotencyKey({
      eventKind: ECONOMIC_EVENT_KINDS.SettlementConfirmed,
      sourceId: 'settlement-1',
    });
    const replay = economicEventIdempotencyKey({
      eventKind: ECONOMIC_EVENT_KINDS.SettlementConfirmed,
      sourceId: 'settlement-1',
    });
    expect(replay).toBe(first);
  });

  it('distingue fatos diferentes', () => {
    const a = economicEventIdempotencyKey({
      eventKind: ECONOMIC_EVENT_KINDS.SettlementConfirmed,
      sourceId: 'settlement-1',
    });
    const b = economicEventIdempotencyKey({
      eventKind: ECONOMIC_EVENT_KINDS.SettlementConfirmed,
      sourceId: 'settlement-2',
    });
    expect(a).not.toBe(b);
  });

  it('trata o ESTORNO como fato distinto do original', () => {
    const original = economicEventIdempotencyKey({
      eventKind: ECONOMIC_EVENT_KINDS.SettlementConfirmed,
      sourceId: 'settlement-1',
    });
    const reversal = economicEventIdempotencyKey({
      eventKind: ECONOMIC_EVENT_KINDS.SettlementReversed,
      sourceId: 'settlement-1',
      reversesSourceId: 'settlement-1',
    });
    expect(reversal).not.toBe(original);
  });
});

describe('economic event contract — validação de payload', () => {
  it('aceita um payload V1 completo', () => {
    expect(assertEconomicEventPayloadV1(validPayload())).toMatchObject({
      schemaVersion: 1,
      eventKind: 'SETTLEMENT_CONFIRMED',
    });
  });

  it('recusa versão de schema desconhecida', () => {
    expect(() => assertEconomicEventPayloadV1({ ...validPayload(), schemaVersion: 99 })).toThrow(
      /SCHEMA_VERSION_UNSUPPORTED/,
    );
  });

  it('recusa evento fora do vocabulário fechado', () => {
    expect(() => assertEconomicEventPayloadV1({ ...validPayload(), eventKind: 'ALGO_NOVO' })).toThrow(
      /KIND_INVALID/,
    );
  });

  it('recusa valor não positivo — posting contábil de zero não existe', () => {
    expect(() => assertEconomicEventPayloadV1({ ...validPayload(), amount: '0' })).toThrow(
      /AMOUNT_INVALID/,
    );
    expect(() => assertEconomicEventPayloadV1({ ...validPayload(), amount: '-10' })).toThrow(
      /AMOUNT_INVALID/,
    );
  });

  it('recusa moeda fora de 3 letras e data fora de YYYY-MM-DD', () => {
    expect(() => assertEconomicEventPayloadV1({ ...validPayload(), currencyCode: 'REAL' })).toThrow(
      /CURRENCY_INVALID/,
    );
    expect(() =>
      assertEconomicEventPayloadV1({ ...validPayload(), occurredOn: '16/10/2026' }),
    ).toThrow(/OCCURRED_ON_INVALID/);
  });

  it('recusa payload sem unidade, sem origem ou sem ator', () => {
    expect(() => assertEconomicEventPayloadV1({ ...validPayload(), unitId: '  ' })).toThrow(
      /UNIT_REQUIRED/,
    );
    expect(() => assertEconomicEventPayloadV1({ ...validPayload(), sourceId: '' })).toThrow(
      /SOURCE_ID_REQUIRED/,
    );
    expect(() => assertEconomicEventPayloadV1({ ...validPayload(), actorIdentityId: '' })).toThrow(
      /ACTOR_REQUIRED/,
    );
  });
});

describe('economic event contract — tipos de transporte', () => {
  it('reconhece os quatro tipos de evento econômico na outbox', () => {
    expect(isEconomicDomainEventType('SETTLEMENT_CONFIRMED')).toBe(true);
    expect(isEconomicDomainEventType('SETTLEMENT_REVERSED')).toBe(true);
    expect(isEconomicDomainEventType('PAYMENT_CONFIRMED')).toBe(true);
    expect(isEconomicDomainEventType('PAYMENT_REVERSED')).toBe(true);
  });

  it('NÃO classifica eventos operacionais como econômicos', () => {
    expect(isEconomicDomainEventType('SERVICE_ORDER_RELEASED')).toBe(false);
    expect(isEconomicDomainEventType('BILLING_READY')).toBe(false);
    expect(isEconomicDomainEventType('PAYMENT_OVERDUE')).toBe(false);
  });
});

describe('economic event contract — vocabulário fechado', () => {
  it('reconhece apenas eventos declarados', () => {
    expect(isEconomicEventKind('SETTLEMENT_CONFIRMED')).toBe(true);
    expect(isEconomicEventKind('settlement_confirmed')).toBe(false);
    expect(isEconomicEventKind('FEATURE_INVENTADA')).toBe(false);
  });
});

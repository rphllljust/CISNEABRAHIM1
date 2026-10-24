/**
 * F1.1 — CONTRATO CANÔNICO DO FATO ECONÔMICO (ECONOMIC EVENT V1)
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * A FRONTEIRA, EM UMA FRASE
 *
 * FINANCE publica o FATO econômico que aconteceu. ACCOUNTING é o dono da decisão
 * contábil, do posting e do journal. Este arquivo é o CONTRATO de dados que atravessa
 * essa fronteira — nada aqui decide contabilidade.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ELE VIVE AQUI E NÃO EM `finance/`
 *
 * O produtor é FINANCE e o consumidor é ACCOUNTING. Um contrato que mora do lado do
 * produtor obriga o consumidor a importar o produtor (viola `module-boundary-rules`,
 * OPERATIONS/FINANCE não podem ser dependidos por ACCOUNTING sem direção declarada).
 * Ele mora em `platform/bounded-contexts/` — o mesmo lugar dos `enterprise-core-ports`,
 * que é o vocabulário COMPARTILHADO de fronteira, não infraestrutura de um contexto.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO NÃO FAZ
 *
 * - Não escolhe conta contábil. Conta é decisão da POSTING RULE, versionada em `acc.*`.
 * - Não escreve journal. Journal é de ACCOUNTING.
 * - Não lê `fin.*`. O fato chega pelo evento, com o payload abaixo.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * IDEMPOTÊNCIA / REDELIVERY
 *
 * `idempotencyKey` é a identidade do FATO, não do envelope. A mesma liquidação
 * reentregue pela outbox produz o MESMO `idempotencyKey`. Do lado de ACCOUNTING, o
 * `postingIdempotencyKey` (acc) deriva desse valor e o índice único
 * `posting_requests_event_source_uidx` garante UM posting por fato. Redelivery não
 * duplica journal — é propriedade do contrato, não do transport.
 */

import type { JournalSourceKind } from './economic-journal-source';

/**
 * FATOS ECONÔMICOS que qualquer domínio pode declarar.
 *
 * O conjunto é FECHADO: um fato novo entra aqui com fonte e decisão registrada, nunca
 * por conveniência de um chamador.
 *
 * F1.1 abriu com FINANCE (liquidação/pagamento). F1.2 estende aos demais produtores
 * que já tinham fato econômico com consequência contábil devida mas publicavam por
 * caminho síncrono acoplado: FISCAL, INVENTORY, PAYROLL e ACTIVE (imobilizado).
 * O mecanismo é o MESMO — não há segunda espinha econômica.
 */
export const ECONOMIC_EVENT_KINDS = {
  // ── FINANCE ────────────────────────────────────────────────────────────────
  ReceivableRecognized: 'RECEIVABLE_RECOGNIZED',
  SettlementConfirmed: 'SETTLEMENT_CONFIRMED',
  SettlementReversed: 'SETTLEMENT_REVERSED',
  PayableRecognized: 'PAYABLE_RECOGNIZED',
  PaymentConfirmed: 'PAYMENT_CONFIRMED',
  PaymentReversed: 'PAYMENT_REVERSED',
  // ── FISCAL ─────────────────────────────────────────────────────────────────
  FiscalDocumentAuthorized: 'FISCAL_DOCUMENT_AUTHORIZED',
  FiscalDocumentCancelled: 'FISCAL_DOCUMENT_CANCELLED',
  TaxCalculationConfirmed: 'TAX_CALCULATION_CONFIRMED',
  // ── INVENTORY ──────────────────────────────────────────────────────────────
  InventoryMovementPosted: 'INVENTORY_MOVEMENT_POSTED',
  // ── PAYROLL ────────────────────────────────────────────────────────────────
  PayrollClosed: 'PAYROLL_CLOSED',
  PayrollReopened: 'PAYROLL_REOPENED',
  // ── ACCOUNTING (imobilizado — o fato é do próprio registro contábil) ───────
  FixedAssetAcquired: 'FIXED_ASSET_ACQUIRED',
  FixedAssetDisposed: 'FIXED_ASSET_DISPOSED',
  FixedAssetTransferred: 'FIXED_ASSET_TRANSFERRED',
  FixedAssetDepreciated: 'FIXED_ASSET_DEPRECIATED',
} as const;

export type EconomicEventKind =
  (typeof ECONOMIC_EVENT_KINDS)[keyof typeof ECONOMIC_EVENT_KINDS];

const EVENT_KIND_SET = new Set<string>(Object.values(ECONOMIC_EVENT_KINDS));

export function isEconomicEventKind(value: string): value is EconomicEventKind {
  return EVENT_KIND_SET.has(value);
}

/**
 * De onde o fato veio. É a coluna `source_kind` do ledger e a chave de correlação na
 * trilha `fato → evento → posting → journal`.
 */
export const ECONOMIC_EVENT_SOURCE_KINDS = {
  ReceivableSettlement: 'RECEIVABLE_SETTLEMENT',
  Receivable: 'RECEIVABLE',
  Payment: 'PAYMENT',
  Payable: 'PAYABLE',
  FiscalDocument: 'FISCAL_DOCUMENT',
  TaxCalculation: 'TAX_CALCULATION',
  InventoryMovement: 'INVENTORY_MOVEMENT',
  PayrollPeriod: 'PAYROLL_PERIOD',
  FixedAssetMovement: 'FIXED_ASSET_MOVEMENT',
} as const;

export type EconomicEventSourceKind =
  (typeof ECONOMIC_EVENT_SOURCE_KINDS)[keyof typeof ECONOMIC_EVENT_SOURCE_KINDS];

/**
 * Payload versionado que viaja no evento da outbox.
 *
 * `schemaVersion` existe porque o contrato atravessa contexto e precisa versionar sem
 * quebrar consumidor. Mudança incompatível sobe a versão; o consumidor decide se
 * aceita. Nunca reaproveitar a versão para outro shape.
 */
export const ECONOMIC_EVENT_SCHEMA_VERSION = 1;

export type EconomicEventPayloadV1 = {
  schemaVersion: typeof ECONOMIC_EVENT_SCHEMA_VERSION;
  eventKind: EconomicEventKind;
  unitId: string;
  sourceKind: EconomicEventSourceKind;
  sourceId: string;
  amount: string;
  currencyCode: string;
  /** Data civil do fato (YYYY-MM-DD) — competência da decisão contábil. */
  occurredOn: string;
  actorIdentityId: string;
  /** Referência humana para a trilha (documento, título, pagamento). */
  sourceReference: string | null;
  /** Quando o evento é de estorno, aponta o fato original. Nunca apaga o original. */
  reversesSourceId: string | null;
  /** Contexto adicional do domínio; a posting rule decide se exige. */
  context?: Record<string, unknown>;
};

export class EconomicEventContractError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida o payload na BORDA do contrato.
 *
 * Falhar aqui é preferível a publicar um fato que o ACCOUNTING não consegue decidir:
 * um evento inválido na outbox vira linha FAILED com motivo obscuro muito depois do
 * commit financeiro. A validação é do contrato, não do consumidor.
 */
export function assertEconomicEventPayloadV1(payload: unknown): EconomicEventPayloadV1 {
  if (typeof payload !== 'object' || payload === null) {
    throw new EconomicEventContractError('ECONOMIC_EVENT_PAYLOAD_REQUIRED');
  }
  const value = payload as Record<string, unknown>;

  if (value['schemaVersion'] !== ECONOMIC_EVENT_SCHEMA_VERSION) {
    throw new EconomicEventContractError('ECONOMIC_EVENT_SCHEMA_VERSION_UNSUPPORTED');
  }
  const eventKind = value['eventKind'];
  if (typeof eventKind !== 'string' || !isEconomicEventKind(eventKind)) {
    throw new EconomicEventContractError('ECONOMIC_EVENT_KIND_INVALID');
  }
  const unitId = value['unitId'];
  if (typeof unitId !== 'string' || unitId.trim().length === 0) {
    throw new EconomicEventContractError('ECONOMIC_EVENT_UNIT_REQUIRED');
  }
  const sourceKind = value['sourceKind'];
  if (typeof sourceKind !== 'string' || sourceKind.trim().length === 0) {
    throw new EconomicEventContractError('ECONOMIC_EVENT_SOURCE_KIND_REQUIRED');
  }
  const sourceId = value['sourceId'];
  if (typeof sourceId !== 'string' || sourceId.trim().length === 0) {
    throw new EconomicEventContractError('ECONOMIC_EVENT_SOURCE_ID_REQUIRED');
  }
  const amount = value['amount'];
  if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
    throw new EconomicEventContractError('ECONOMIC_EVENT_AMOUNT_INVALID');
  }
  const currencyCode = value['currencyCode'];
  if (typeof currencyCode !== 'string' || currencyCode.trim().length !== 3) {
    throw new EconomicEventContractError('ECONOMIC_EVENT_CURRENCY_INVALID');
  }
  const occurredOn = value['occurredOn'];
  if (typeof occurredOn !== 'string' || !DATE_ONLY.test(occurredOn)) {
    throw new EconomicEventContractError('ECONOMIC_EVENT_OCCURRED_ON_INVALID');
  }
  const actorIdentityId = value['actorIdentityId'];
  if (typeof actorIdentityId !== 'string' || actorIdentityId.trim().length === 0) {
    throw new EconomicEventContractError('ECONOMIC_EVENT_ACTOR_REQUIRED');
  }

  return value as unknown as EconomicEventPayloadV1;
}

/**
 * Identidade do FATO. Usada como `idempotency_key` da outbox E como base do
 * `postingIdempotencyKey` contábil.
 *
 * A chave NÃO inclui timestamp: o mesmo fato reentregue tem de colidir, senão
 * redelivery duplicaria journal. Ela inclui `reversesSourceId` quando há estorno,
 * porque um estorno é um fato DIFERENTE do original — e precisa postar compensação
 * própria, nunca sobrescrever o original.
 */
export function economicEventIdempotencyKey(input: {
  eventKind: EconomicEventKind;
  sourceId: string;
  reversesSourceId?: string | null;
}): string {
  const suffix = input.reversesSourceId ? `:reverses:${input.reversesSourceId}` : '';
  /**
   * F1.2 — o prefixo é neutro de domínio.
   *
   * Era `fin-economic:` na F1.1, quando só FINANCE publicava. Agora FISCAL, INVENTORY
   * e PAYROLL publicam pelo MESMO mecanismo, e um prefixo de domínio no
   * `idempotency_key` da outbox faria parecer que existe uma segunda espinha — ou,
   * pior, dois domínios com a mesma `sourceId` colidindo. `economic:` identifica o
   * FATO, que é o que a chave representa.
   */
  return `economic:${input.eventKind}:${input.sourceId}${suffix}`;
}

/**
 * Mapa evento econômico → `JournalSourceKind`.
 *
 * O `JournalSourceKind` é vocabulário de ACCOUNTING (`accounting/domain/ledger.ts`).
 * Reexportá-lo aqui, a partir do contrato, evita que um domínio produtor precise
 * importar o interior de ACCOUNTING para publicar um fato — ele importa o CONTRATO.
 */
export function journalSourceKindForEconomicEvent(
  eventKind: EconomicEventKind,
): JournalSourceKind {
  switch (eventKind) {
    case ECONOMIC_EVENT_KINDS.SettlementConfirmed:
    case ECONOMIC_EVENT_KINDS.SettlementReversed:
      return 'SETTLEMENT';
    case ECONOMIC_EVENT_KINDS.PaymentConfirmed:
    case ECONOMIC_EVENT_KINDS.PaymentReversed:
    case ECONOMIC_EVENT_KINDS.PayableRecognized:
      return 'PAYMENT';
    case ECONOMIC_EVENT_KINDS.ReceivableRecognized:
      return 'BILLING';
    case ECONOMIC_EVENT_KINDS.FiscalDocumentAuthorized:
    case ECONOMIC_EVENT_KINDS.FiscalDocumentCancelled:
    case ECONOMIC_EVENT_KINDS.TaxCalculationConfirmed:
      return 'TAX';
    case ECONOMIC_EVENT_KINDS.InventoryMovementPosted:
      return 'INVENTORY';
    case ECONOMIC_EVENT_KINDS.PayrollClosed:
    case ECONOMIC_EVENT_KINDS.PayrollReopened:
      return 'PAYROLL';
    case ECONOMIC_EVENT_KINDS.FixedAssetAcquired:
    case ECONOMIC_EVENT_KINDS.FixedAssetDisposed:
    case ECONOMIC_EVENT_KINDS.FixedAssetTransferred:
    case ECONOMIC_EVENT_KINDS.FixedAssetDepreciated:
      return 'FIXED_ASSET';
    default: {
      const exhaustive: never = eventKind;
      return exhaustive;
    }
  }
}

/**
 * O evento é um estorno? Decide se ACCOUNTING chama `postConfirmedEvent` (fato
 * novo) ou `reverseConfirmedEvent` (compensação).
 *
 * Um estorno NUNCA apaga o journal original — ele produz lançamento compensatório.
 */
export function isReversalEconomicEvent(eventKind: EconomicEventKind): boolean {
  return (
    eventKind === ECONOMIC_EVENT_KINDS.SettlementReversed ||
    eventKind === ECONOMIC_EVENT_KINDS.PaymentReversed ||
    eventKind === ECONOMIC_EVENT_KINDS.FiscalDocumentCancelled ||
    eventKind === ECONOMIC_EVENT_KINDS.PayrollReopened
  );
}

/** Fato que o próprio estorno compensa. `null` para fatos não-compensatórios. */
export function originalEventKindForEconomicReversal(
  eventKind: EconomicEventKind,
): EconomicEventKind | null {
  switch (eventKind) {
    case ECONOMIC_EVENT_KINDS.SettlementReversed:
      return ECONOMIC_EVENT_KINDS.SettlementConfirmed;
    case ECONOMIC_EVENT_KINDS.PaymentReversed:
      return ECONOMIC_EVENT_KINDS.PaymentConfirmed;
    case ECONOMIC_EVENT_KINDS.FiscalDocumentCancelled:
      return ECONOMIC_EVENT_KINDS.FiscalDocumentAuthorized;
    case ECONOMIC_EVENT_KINDS.PayrollReopened:
      return ECONOMIC_EVENT_KINDS.PayrollClosed;
    default:
      return null;
  }
}

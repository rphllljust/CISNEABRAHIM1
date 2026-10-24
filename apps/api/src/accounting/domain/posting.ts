import { JOURNAL_SOURCE_KINDS, type JournalSourceKind, AccountingError } from './ledger';

export const POSTING_ORIGINS = {
  Finance: 'FINANCE',
  Fiscal: 'FISCAL',
  Inventory: 'INVENTORY',
  Payroll: 'PAYROLL',
  FixedAsset: 'FIXED_ASSET',
} as const;

export type PostingOriginKind = (typeof POSTING_ORIGINS)[keyof typeof POSTING_ORIGINS];

export const POSTING_EVENTS = {
  ReceivableRecognized: 'RECEIVABLE_RECOGNIZED',
  SettlementConfirmed: 'SETTLEMENT_CONFIRMED',
  PayableRecognized: 'PAYABLE_RECOGNIZED',
  PaymentConfirmed: 'PAYMENT_CONFIRMED',
  /**
   * F1.1 — eventos de ESTORNO, distintos do fato original.
   *
   * Antes o estorno reutilizava o `eventKind` do fato original. Como
   * `acc.accounting_posting_requests` é único por
   * `(origin_kind, event_kind, source_id)`, o registro da compensação colidia com o
   * registro do fato original: o estorno não conseguia existir como posting próprio,
   * a busca de idempotência o confundia com o original, e a compensação contábil
   * simplesmente não acontecia. `REVERSAL` é um FATO CONTÁBIL DIFERENTE e precisa de
   * chave própria.
   */
  SettlementReversed: 'SETTLEMENT_REVERSED',
  PaymentReversed: 'PAYMENT_REVERSED',
  FiscalDocumentAuthorized: 'FISCAL_DOCUMENT_AUTHORIZED',
  FiscalDocumentCancelled: 'FISCAL_DOCUMENT_CANCELLED',
  TaxCalculationConfirmed: 'TAX_CALCULATION_CONFIRMED',
  InventoryMovementPosted: 'INVENTORY_MOVEMENT_POSTED',
  PayrollClosed: 'PAYROLL_CLOSED',
  PayrollReopened: 'PAYROLL_REOPENED',
  FixedAssetAcquired: 'FIXED_ASSET_ACQUIRED',
  FixedAssetDisposed: 'FIXED_ASSET_DISPOSED',
  FixedAssetTransferred: 'FIXED_ASSET_TRANSFERRED',
  FixedAssetDepreciated: 'FIXED_ASSET_DEPRECIATED',
} as const;

export type PostingEventKind = (typeof POSTING_EVENTS)[keyof typeof POSTING_EVENTS];

export const POSTING_RULE_STATUSES = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;

export const POSTING_VERSION_STATUSES = {
  Draft: 'DRAFT',
  Published: 'PUBLISHED',
} as const;

export const POSTING_REQUEST_STATUSES = {
  Pending: 'PENDING',
  Posted: 'POSTED',
  Rejected: 'REJECTED',
} as const;

export const DEFAULT_POSTING_CONTEXT_KEYS = ['amount', 'occurredOn', 'currencyCode'] as const;

const ORIGIN_SET = new Set<string>(Object.values(POSTING_ORIGINS));
const EVENT_SET = new Set<string>(Object.values(POSTING_EVENTS));

const EVENT_ORIGIN: Record<PostingEventKind, PostingOriginKind> = {
  RECEIVABLE_RECOGNIZED: POSTING_ORIGINS.Finance,
  SETTLEMENT_CONFIRMED: POSTING_ORIGINS.Finance,
  SETTLEMENT_REVERSED: POSTING_ORIGINS.Finance,
  PAYABLE_RECOGNIZED: POSTING_ORIGINS.Finance,
  PAYMENT_CONFIRMED: POSTING_ORIGINS.Finance,
  PAYMENT_REVERSED: POSTING_ORIGINS.Finance,
  FISCAL_DOCUMENT_AUTHORIZED: POSTING_ORIGINS.Fiscal,
  FISCAL_DOCUMENT_CANCELLED: POSTING_ORIGINS.Fiscal,
  TAX_CALCULATION_CONFIRMED: POSTING_ORIGINS.Fiscal,
  INVENTORY_MOVEMENT_POSTED: POSTING_ORIGINS.Inventory,
  PAYROLL_CLOSED: POSTING_ORIGINS.Payroll,
  PAYROLL_REOPENED: POSTING_ORIGINS.Payroll,
  FIXED_ASSET_ACQUIRED: POSTING_ORIGINS.FixedAsset,
  FIXED_ASSET_DISPOSED: POSTING_ORIGINS.FixedAsset,
  FIXED_ASSET_TRANSFERRED: POSTING_ORIGINS.FixedAsset,
  FIXED_ASSET_DEPRECIATED: POSTING_ORIGINS.FixedAsset,
};

const EVENT_JOURNAL_SOURCE: Record<PostingEventKind, JournalSourceKind> = {
  RECEIVABLE_RECOGNIZED: JOURNAL_SOURCE_KINDS.Billing,
  SETTLEMENT_CONFIRMED: JOURNAL_SOURCE_KINDS.Settlement,
  SETTLEMENT_REVERSED: JOURNAL_SOURCE_KINDS.Settlement,
  PAYABLE_RECOGNIZED: JOURNAL_SOURCE_KINDS.Payment,
  PAYMENT_CONFIRMED: JOURNAL_SOURCE_KINDS.Payment,
  PAYMENT_REVERSED: JOURNAL_SOURCE_KINDS.Payment,
  FISCAL_DOCUMENT_AUTHORIZED: JOURNAL_SOURCE_KINDS.Tax,
  FISCAL_DOCUMENT_CANCELLED: JOURNAL_SOURCE_KINDS.Tax,
  TAX_CALCULATION_CONFIRMED: JOURNAL_SOURCE_KINDS.Tax,
  INVENTORY_MOVEMENT_POSTED: JOURNAL_SOURCE_KINDS.Inventory,
  PAYROLL_CLOSED: JOURNAL_SOURCE_KINDS.Payroll,
  PAYROLL_REOPENED: JOURNAL_SOURCE_KINDS.Payroll,
  FIXED_ASSET_ACQUIRED: JOURNAL_SOURCE_KINDS.FixedAsset,
  FIXED_ASSET_DISPOSED: JOURNAL_SOURCE_KINDS.FixedAsset,
  FIXED_ASSET_TRANSFERRED: JOURNAL_SOURCE_KINDS.FixedAsset,
  FIXED_ASSET_DEPRECIATED: JOURNAL_SOURCE_KINDS.FixedAsset,
};

export function assertPostingOrigin(value: string): PostingOriginKind {
  const normalized = value.trim().toUpperCase();
  if (!ORIGIN_SET.has(normalized)) {
    throw new AccountingError('ACCOUNTING_INVALID_SOURCE');
  }
  return normalized as PostingOriginKind;
}

export function assertPostingEvent(value: string): PostingEventKind {
  const normalized = value.trim().toUpperCase();
  if (!EVENT_SET.has(normalized)) {
    throw new AccountingError('ACCOUNTING_INVALID_SOURCE');
  }
  return normalized as PostingEventKind;
}

export function originForEvent(eventKind: string): PostingOriginKind {
  const event = assertPostingEvent(eventKind);
  return EVENT_ORIGIN[event];
}

export function journalSourceKindForEvent(eventKind: string): JournalSourceKind {
  const event = assertPostingEvent(eventKind);
  return EVENT_JOURNAL_SOURCE[event];
}

const REVERSAL_ORIGINAL_EVENT: Partial<Record<PostingEventKind, PostingEventKind>> = {
  SETTLEMENT_REVERSED: POSTING_EVENTS.SettlementConfirmed,
  PAYMENT_REVERSED: POSTING_EVENTS.PaymentConfirmed,
  FISCAL_DOCUMENT_CANCELLED: POSTING_EVENTS.FiscalDocumentAuthorized,
  PAYROLL_REOPENED: POSTING_EVENTS.PayrollClosed,
};

/** O evento é um ESTORNO (compensação), não um fato novo original. */
const REVERSAL_EVENTS = new Set<PostingEventKind>([
  POSTING_EVENTS.SettlementReversed,
  POSTING_EVENTS.PaymentReversed,
  POSTING_EVENTS.FiscalDocumentCancelled,
  POSTING_EVENTS.PayrollReopened,
]);

export function isReversalPostingEvent(eventKind: string): boolean {
  return REVERSAL_EVENTS.has(assertPostingEvent(eventKind));
}

export function originalEventKindForReversal(eventKind: string): PostingEventKind {
  const event = assertPostingEvent(eventKind);
  return REVERSAL_ORIGINAL_EVENT[event] ?? event;
}

export function assertPublishedPostingVersionImmutable(status: string): void {
  if (status === POSTING_VERSION_STATUSES.Published) {
    throw new AccountingError('ACCOUNTING_RULE_VERSION_IMMUTABLE');
  }
}

export function assertPostingRuleConfigured(found: boolean): void {
  if (!found) {
    throw new AccountingError('ACCOUNTING_RULE_NOT_CONFIGURED');
  }
}

export function assertRequiredPostingContext(
  required: string[],
  context: Record<string, unknown>,
): void {
  for (const key of required) {
    const value = context[key];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      throw new AccountingError('ACCOUNTING_INVALID_CONTEXT');
    }
  }
}

export function postingIdempotencyKey(input: {
  originKind: string;
  eventKind: string;
  sourceId: string;
  idempotencyKey?: string;
}): string {
  if (input.idempotencyKey?.trim()) {
    return input.idempotencyKey.trim();
  }
  return `acc-post:${assertPostingOrigin(input.originKind)}:${assertPostingEvent(input.eventKind)}:${input.sourceId}`;
}

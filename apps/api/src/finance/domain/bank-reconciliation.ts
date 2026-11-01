import { moneyAmountsEqual, normalizeMoneyAmount } from '../../platform/kernel/money-math';
import { TREASURY_ORIGIN_KINDS } from './treasury';

export const BANK_STATEMENT_SOURCE_KINDS = {
  Manual: 'MANUAL',
  Ofx: 'OFX',
  Cnab: 'CNAB',
  BankApi: 'BANK_API',
  AuthorizedFile: 'AUTHORIZED_FILE',
} as const;

export const BANK_LINE_MATCH_STATUSES = {
  Unmatched: 'UNMATCHED',
  ReviewRequired: 'REVIEW_REQUIRED',
  Suggested: 'SUGGESTED',
  Matched: 'MATCHED',
} as const;

export const RECONCILIATION_STATUSES = {
  Draft: 'DRAFT',
  Confirmed: 'CONFIRMED',
  Unreconciled: 'UNRECONCILED',
} as const;

export const RECONCILIATION_MATCH_METHODS = {
  AutoExact: 'AUTO_EXACT',
  Manual: 'MANUAL',
} as const;

export const RECONCILIATION_TARGET_KINDS = {
  ReceivableSettlement: 'RECEIVABLE_SETTLEMENT',
  PayablePayment: 'PAYABLE_PAYMENT',
  Transfer: 'TRANSFER',
  FinancialTransaction: 'FINANCIAL_TRANSACTION',
} as const;

export const AUTO_EXACT_MATCH_CRITERIA = 'ACCOUNT+AMOUNT+DIRECTION+OCCURRED_ON';

const SOURCE_KIND_SET = new Set<string>(Object.values(BANK_STATEMENT_SOURCE_KINDS));
const ERP_SOURCE_KINDS = new Set(['ERP', 'DYGNUS', 'EXTERNAL_ERP']);

export class BankReconciliationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type EligibleMovement = {
  id: string;
  accountId: string;
  direction: string;
  amount: string;
  occurredOn: string;
  originKind: string;
  originId: string;
  transferId: string | null;
};

export type BankLineCandidate = {
  id: string;
  accountId: string;
  direction: string;
  amount: string;
  occurredOn: string;
};

export function assertBankStatementSourceKind(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (ERP_SOURCE_KINDS.has(normalized)) {
    throw new BankReconciliationError('BANK_RECON_ERP_FORBIDDEN');
  }
  if (!SOURCE_KIND_SET.has(normalized)) {
    throw new BankReconciliationError('BANK_RECON_INVALID_SOURCE');
  }
  return normalized;
}

/**
 * A bank statement is denominated in the same currency as its financial account.
 * Compare actual currency codes; equal nominal amounts are not convertible values.
 * The access layer calls this only after the account authorization decision.
 */
export function assertBankStatementAccountCurrency(
  statementCurrencyCode: string,
  accountCurrencyCode: string,
): void {
  if (statementCurrencyCode.trim().toUpperCase() !== accountCurrencyCode.trim().toUpperCase()) {
    throw new BankReconciliationError('BANK_RECON_CURRENCY_MISMATCH');
  }
}

export function assertNotAmountApproximation(left: string, right: string): void {
  if (!moneyAmountsEqual(normalizeMoneyAmount(left), normalizeMoneyAmount(right))) {
    throw new BankReconciliationError('BANK_RECON_AMOUNT_NOT_EXACT');
  }
}

export function isExactMatchCandidate(line: BankLineCandidate, movement: EligibleMovement): boolean {
  return (
    line.accountId === movement.accountId &&
    line.direction === movement.direction &&
    line.occurredOn === movement.occurredOn &&
    moneyAmountsEqual(normalizeMoneyAmount(line.amount), normalizeMoneyAmount(movement.amount))
  );
}

export function classifyAutoMatch(candidates: EligibleMovement[]): {
  status: string;
  selected: EligibleMovement | null;
} {
  if (candidates.length === 0) {
    return { status: BANK_LINE_MATCH_STATUSES.Unmatched, selected: null };
  }
  if (candidates.length > 1) {
    return { status: BANK_LINE_MATCH_STATUSES.ReviewRequired, selected: null };
  }
  return { status: BANK_LINE_MATCH_STATUSES.Suggested, selected: candidates[0] ?? null };
}

export function targetKindFromOrigin(originKind: string, transferId: string | null): string {
  if (originKind === TREASURY_ORIGIN_KINDS.ReceivableSettlement) {
    return RECONCILIATION_TARGET_KINDS.ReceivableSettlement;
  }
  if (originKind === TREASURY_ORIGIN_KINDS.PayablePayment) {
    return RECONCILIATION_TARGET_KINDS.PayablePayment;
  }
  if (originKind === TREASURY_ORIGIN_KINDS.Transfer || transferId) {
    return RECONCILIATION_TARGET_KINDS.Transfer;
  }
  return RECONCILIATION_TARGET_KINDS.FinancialTransaction;
}

export function targetIdFromMovement(movement: EligibleMovement): string {
  const kind = targetKindFromOrigin(movement.originKind, movement.transferId);
  if (kind === RECONCILIATION_TARGET_KINDS.Transfer) {
    return movement.transferId ?? movement.id;
  }
  if (
    kind === RECONCILIATION_TARGET_KINDS.ReceivableSettlement ||
    kind === RECONCILIATION_TARGET_KINDS.PayablePayment
  ) {
    return movement.originId;
  }
  return movement.id;
}

export function assertReconciliationConfirmable(status: string): void {
  if (status === RECONCILIATION_STATUSES.Confirmed) {
    return;
  }
  if (status !== RECONCILIATION_STATUSES.Draft) {
    throw new BankReconciliationError('BANK_RECON_NOT_DRAFT');
  }
}

export function assertReconciliationUnreconcilable(status: string): void {
  if (status !== RECONCILIATION_STATUSES.Confirmed) {
    throw new BankReconciliationError('BANK_RECON_NOT_CONFIRMED');
  }
}

export function assertConfirmedImmutable(status: string, mutating: boolean): void {
  if (mutating && status === RECONCILIATION_STATUSES.Confirmed) {
    throw new BankReconciliationError('BANK_RECON_CONFIRMED_IMMUTABLE');
  }
}

export function occurredOnFromTimestamp(value: string): string {
  return value.slice(0, 10);
}

export function assertFinancialReconciliationIntegrity(input: {
  confirmedLineIds: string[];
  uniqueConfirmedLineIds: string[];
  confirmedAmountsEqual: boolean;
}): void {
  if (input.confirmedLineIds.length !== input.uniqueConfirmedLineIds.length) {
    throw new BankReconciliationError('BANK_RECON_DOUBLE_MATCH');
  }
  if (!input.confirmedAmountsEqual) {
    throw new BankReconciliationError('BANK_RECON_AMOUNT_NOT_EXACT');
  }
}

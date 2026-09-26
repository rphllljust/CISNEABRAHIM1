import {
  assertCurrencyCode,
  compareMoneyAmounts,
  isPositiveMoneyAmount,
  isZeroMoneyAmount,
  moneyAmountsEqual,
  normalizeMoneyAmount,
  subtractMoneyAmounts,
  sumMoneyAmounts,
} from '../../platform/kernel/money-math';

export const RECEIVABLE_STATUSES = {
  Open: 'OPEN',
  PartiallyPaid: 'PARTIALLY_PAID',
  Paid: 'PAID',
  Overdue: 'OVERDUE',
  Cancelled: 'CANCELLED',
} as const;

export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[keyof typeof RECEIVABLE_STATUSES];

export const RECEIVABLE_LIFECYCLES = {
  Active: 'ACTIVE',
  Cancelled: 'CANCELLED',
} as const;

export type ReceivableLifecycle = (typeof RECEIVABLE_LIFECYCLES)[keyof typeof RECEIVABLE_LIFECYCLES];

export const SETTLEMENT_STATUSES = {
  Posted: 'POSTED',
  Reversed: 'REVERSED',
} as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[keyof typeof SETTLEMENT_STATUSES];

export const RECEIVABLE_ORIGIN_KINDS = {
  BillingDocument: 'BILLING_DOCUMENT',
} as const;

export const RECEIVABLE_COMMANDS = {
  Open: 'OPEN',
  Settle: 'SETTLE',
  ReverseSettlement: 'REVERSE_SETTLEMENT',
  Cancel: 'CANCEL',
} as const;

export class ReceivableError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type ReceivableInstallmentDraft = {
  installmentNumber: number;
  principal: string;
  dueDate: string;
};

export type PostedSettlement = {
  amount: string;
  status: string;
  installmentId?: string | null;
};

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export function remainingBalance(principal: string, postedAmounts: string[]): string {
  const settled = sumMoneyAmounts(postedAmounts);
  return subtractMoneyAmounts(normalizeMoneyAmount(principal), settled);
}

export function deriveReceivableStatus(input: {
  lifecycle: string;
  principal: string;
  postedAmounts: string[];
  dueDate: string;
  asOf?: Date;
}): ReceivableStatus {
  if (input.lifecycle === RECEIVABLE_LIFECYCLES.Cancelled) {
    return RECEIVABLE_STATUSES.Cancelled;
  }
  const remaining = remainingBalance(input.principal, input.postedAmounts);
  if (isZeroMoneyAmount(remaining) || compareMoneyAmounts(remaining, '0') <= 0) {
    return RECEIVABLE_STATUSES.Paid;
  }
  const asOf = input.asOf ?? new Date();
  const asOfDate = asOf.toISOString().slice(0, 10);
  if (dateOnly(input.dueDate) < asOfDate) {
    return RECEIVABLE_STATUSES.Overdue;
  }
  const settled = sumMoneyAmounts(input.postedAmounts);
  if (isPositiveMoneyAmount(settled)) {
    return RECEIVABLE_STATUSES.PartiallyPaid;
  }
  return RECEIVABLE_STATUSES.Open;
}

export function assertReceivableActive(lifecycle: string): void {
  if (lifecycle !== RECEIVABLE_LIFECYCLES.Active) {
    throw new ReceivableError('RECEIVABLE_CANCELLED');
  }
}

export function assertSettlementCurrency(receivableCurrency: string, settlementCurrency: string): void {
  if (assertCurrencyCode(receivableCurrency) !== assertCurrencyCode(settlementCurrency)) {
    throw new ReceivableError('RECEIVABLE_CURRENCY_MISMATCH');
  }
}

export function assertSettlementAmount(amount: string): string {
  const normalized = normalizeMoneyAmount(amount);
  if (!isPositiveMoneyAmount(normalized)) {
    throw new ReceivableError('RECEIVABLE_INVALID_SETTLEMENT_AMOUNT');
  }
  return normalized;
}

export function assertNoOverpayment(principal: string, postedAmounts: string[], incomingAmount: string): string {
  const remaining = remainingBalance(principal, postedAmounts);
  if (compareMoneyAmounts(incomingAmount, remaining) > 0) {
    throw new ReceivableError('RECEIVABLE_OVERPAYMENT');
  }
  return remaining;
}

export function assertInstallmentSchedule(principal: string, installments: ReceivableInstallmentDraft[]): ReceivableInstallmentDraft[] {
  if (installments.length < 1) {
    throw new ReceivableError('RECEIVABLE_INSTALLMENTS_REQUIRED');
  }
  const seen = new Set<number>();
  for (const installment of installments) {
    if (!Number.isInteger(installment.installmentNumber) || installment.installmentNumber < 1) {
      throw new ReceivableError('RECEIVABLE_INVALID_INSTALLMENT');
    }
    if (seen.has(installment.installmentNumber)) {
      throw new ReceivableError('RECEIVABLE_DUPLICATE_INSTALLMENT');
    }
    seen.add(installment.installmentNumber);
    assertSettlementAmount(installment.principal);
  }
  const total = sumMoneyAmounts(installments.map((item) => item.principal));
  if (!moneyAmountsEqual(total, principal)) {
    throw new ReceivableError('RECEIVABLE_INSTALLMENT_TOTAL_MISMATCH');
  }
  return [...installments].sort((left, right) => left.installmentNumber - right.installmentNumber);
}

export function defaultInstallment(principal: string, dueDate: string): ReceivableInstallmentDraft {
  return {
    installmentNumber: 1,
    principal: normalizeMoneyAmount(principal),
    dueDate: dateOnly(dueDate),
  };
}

export function postedSettlementAmounts(settlements: PostedSettlement[]): string[] {
  return settlements
    .filter((item) => item.status === SETTLEMENT_STATUSES.Posted)
    .map((item) => item.amount);
}

/**
 * Motivo da reversao de recebimento. Obrigatorio e nao trivial: a reversao
 * precisa permanecer auditavel ("quem reverteu e por que").
 */
export function assertSettlementReversalReason(reason: string): string {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 3) {
    throw new ReceivableError('RECEIVABLE_REVERSAL_REASON_REQUIRED');
  }
  return trimmed;
}

/** Somente recebimento POSTED pode ser revertido, e uma unica vez. */
export function assertSettlementReversible(status: string): void {
  if (status === SETTLEMENT_STATUSES.Reversed) {
    throw new ReceivableError('RECEIVABLE_SETTLEMENT_ALREADY_REVERSED');
  }
  if (status !== SETTLEMENT_STATUSES.Posted) {
    throw new ReceivableError('RECEIVABLE_SETTLEMENT_NOT_REVERSIBLE');
  }
}

/** Conciliação confirmada nao pode ser alterada em silencio (regra vigente). */
export function assertSettlementNotReconciled(confirmedReconciliationCount: number): void {
  if (confirmedReconciliationCount > 0) {
    throw new ReceivableError('RECEIVABLE_SETTLEMENT_RECONCILED');
  }
}

export function reconcileReceivable(input: {
  principal: string;
  postedAmounts: string[];
}): { remaining: string; settled: string; negativeBalance: boolean } {
  const settled = sumMoneyAmounts(input.postedAmounts);
  const remaining = remainingBalance(input.principal, input.postedAmounts);
  return {
    remaining,
    settled,
    negativeBalance: compareMoneyAmounts(remaining, '0') < 0,
  };
}

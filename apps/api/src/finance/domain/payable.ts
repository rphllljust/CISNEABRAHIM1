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

export const PAYABLE_STATUSES = {
  Open: 'OPEN',
  PartiallyPaid: 'PARTIALLY_PAID',
  Paid: 'PAID',
  Overdue: 'OVERDUE',
  Cancelled: 'CANCELLED',
} as const;

export type PayableStatus = (typeof PAYABLE_STATUSES)[keyof typeof PAYABLE_STATUSES];

export const PAYABLE_LIFECYCLES = {
  Active: 'ACTIVE',
  Cancelled: 'CANCELLED',
} as const;

export type PayableLifecycle = (typeof PAYABLE_LIFECYCLES)[keyof typeof PAYABLE_LIFECYCLES];

/**
 * Status de categoria de despesa — espelha `fin.expense_category_status` do banco.
 *
 * Declarado no DOMINIO porque a regra de "quais status existem" e do dominio, nao da borda HTTP.
 * Ha um teste de contrato que compara esta lista com o enum do schema; valor fora dela e
 * recusado na listagem em vez de virar filtro silenciosamente ignorado.
 */
export const EXPENSE_CATEGORY_STATUSES = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;

export type ExpenseCategoryStatus =
  (typeof EXPENSE_CATEGORY_STATUSES)[keyof typeof EXPENSE_CATEGORY_STATUSES];

const EXPENSE_CATEGORY_STATUS_SET: ReadonlySet<string> = new Set(
  Object.values(EXPENSE_CATEGORY_STATUSES),
);

/**
 * Predicado do conjunto FECHADO de status de categoria de despesa.
 *
 * Usado na borda da listagem: valor desconhecido e recusado ali, em vez de descer ao SQL como
 * comparação que nunca casa — o que devolveria lista vazia e seria lido como "não há categoria".
 */
export function isExpenseCategoryStatus(value: string): value is ExpenseCategoryStatus {
  return EXPENSE_CATEGORY_STATUS_SET.has(value);
}

/**
 * Status de centro de custo — espelha `fin.cost_center_status` do banco (migration 0118).
 *
 * Mesma disciplina da categoria de despesa: conjunto FECHADO no dominio, recusa na borda.
 */
export const COST_CENTER_STATUSES = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;

export type CostCenterStatus = (typeof COST_CENTER_STATUSES)[keyof typeof COST_CENTER_STATUSES];

const COST_CENTER_STATUS_SET: ReadonlySet<string> = new Set(Object.values(COST_CENTER_STATUSES));

export function isCostCenterStatus(value: string): value is CostCenterStatus {
  return COST_CENTER_STATUS_SET.has(value);
}

export const PAYMENT_KINDS = {
  Payment: 'PAYMENT',
  Reversal: 'REVERSAL',
} as const;

export type PaymentKind = (typeof PAYMENT_KINDS)[keyof typeof PAYMENT_KINDS];

export const PAYABLE_ORIGIN_KINDS = {
  SupplierInvoice: 'SUPPLIER_INVOICE',
  Purchase: 'PURCHASE',
  OperationalExpense: 'OPERATIONAL_EXPENSE',
  PayrollObligation: 'PAYROLL_OBLIGATION',
  TaxObligation: 'TAX_OBLIGATION',
  ManualAuthorizedExpense: 'MANUAL_AUTHORIZED_EXPENSE',
} as const;

export type PayableOriginKind = (typeof PAYABLE_ORIGIN_KINDS)[keyof typeof PAYABLE_ORIGIN_KINDS];

const ORIGIN_KIND_SET = new Set<string>(Object.values(PAYABLE_ORIGIN_KINDS));

/** Client PurchaseOrder is a commercial document, not a payable origin. */
export const FORBIDDEN_PAYABLE_ORIGIN_KINDS = [
  'CLIENT_PURCHASE_ORDER',
  'COMMERCIAL_PURCHASE_ORDER',
  'PURCHASE_ORDER',
  'BILLING_DOCUMENT',
  'RECEIVABLE',
] as const;

export const PAYABLE_AGING_BUCKETS = {
  Settled: 'SETTLED',
  Cancelled: 'CANCELLED',
  Current: 'CURRENT',
  Days1To30: '1_30',
  Days31To60: '31_60',
  Days61To90: '61_90',
  Days90Plus: '90_PLUS',
} as const;

export type PayableAgingBucket = (typeof PAYABLE_AGING_BUCKETS)[keyof typeof PAYABLE_AGING_BUCKETS];

export const PAYABLE_COMMANDS = {
  Open: 'OPEN',
  Pay: 'PAY',
  Reverse: 'REVERSE',
  Cancel: 'CANCEL',
} as const;

export class PayableError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type PayableInstallmentDraft = {
  installmentNumber: number;
  principal: string;
  dueDate: string;
};

export type PostedPayment = {
  kind: string;
  amount: string;
  installmentId: string;
  reversesPaymentId?: string | null;
};

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export function assertPayableOriginKind(kind: string): PayableOriginKind {
  const normalized = kind.trim().toUpperCase();
  if ((FORBIDDEN_PAYABLE_ORIGIN_KINDS as readonly string[]).includes(normalized)) {
    throw new PayableError('PAYABLE_FORBIDDEN_ORIGIN');
  }
  if (!ORIGIN_KIND_SET.has(normalized)) {
    throw new PayableError('PAYABLE_INVALID_ORIGIN');
  }
  return normalized as PayableOriginKind;
}

export function netPaidAmount(payments: PostedPayment[]): string {
  const paid = sumMoneyAmounts(
    payments.filter((item) => item.kind === PAYMENT_KINDS.Payment).map((item) => item.amount),
  );
  const reversed = sumMoneyAmounts(
    payments.filter((item) => item.kind === PAYMENT_KINDS.Reversal).map((item) => item.amount),
  );
  return subtractMoneyAmounts(paid, reversed);
}

export function remainingBalance(principal: string, payments: PostedPayment[]): string {
  return subtractMoneyAmounts(normalizeMoneyAmount(principal), netPaidAmount(payments));
}

export function installmentRemaining(
  installmentPrincipal: string,
  payments: PostedPayment[],
  installmentId: string,
): string {
  return remainingBalance(
    installmentPrincipal,
    payments.filter((item) => item.installmentId === installmentId),
  );
}

export function derivePayableStatus(input: {
  lifecycle: string;
  principal: string;
  payments: PostedPayment[];
  dueDate: string;
  asOf?: Date;
}): PayableStatus {
  if (input.lifecycle === PAYABLE_LIFECYCLES.Cancelled) {
    return PAYABLE_STATUSES.Cancelled;
  }
  const remaining = remainingBalance(input.principal, input.payments);
  if (isZeroMoneyAmount(remaining) || compareMoneyAmounts(remaining, '0') <= 0) {
    return PAYABLE_STATUSES.Paid;
  }
  const asOf = input.asOf ?? new Date();
  const asOfDate = asOf.toISOString().slice(0, 10);
  if (dateOnly(input.dueDate) < asOfDate) {
    return PAYABLE_STATUSES.Overdue;
  }
  if (isPositiveMoneyAmount(netPaidAmount(input.payments))) {
    return PAYABLE_STATUSES.PartiallyPaid;
  }
  return PAYABLE_STATUSES.Open;
}

export function calendarDaysOverdue(dueDate: string, asOf: Date): number {
  const due = dateOnly(dueDate);
  const [year, month, day] = due.split('-').map((part) => Number.parseInt(part, 10));
  const dueUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const asOfUtc = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.floor((asOfUtc - dueUtc) / 86_400_000);
}

export function classifyPayableAging(input: {
  lifecycle: string;
  principal: string;
  payments: PostedPayment[];
  dueDate: string;
  asOf?: Date;
}): PayableAgingBucket {
  if (input.lifecycle === PAYABLE_LIFECYCLES.Cancelled) {
    return PAYABLE_AGING_BUCKETS.Cancelled;
  }
  const remaining = remainingBalance(input.principal, input.payments);
  if (isZeroMoneyAmount(remaining) || compareMoneyAmounts(remaining, '0') <= 0) {
    return PAYABLE_AGING_BUCKETS.Settled;
  }
  const days = calendarDaysOverdue(input.dueDate, input.asOf ?? new Date());
  if (days <= 0) {
    return PAYABLE_AGING_BUCKETS.Current;
  }
  if (days <= 30) {
    return PAYABLE_AGING_BUCKETS.Days1To30;
  }
  if (days <= 60) {
    return PAYABLE_AGING_BUCKETS.Days31To60;
  }
  if (days <= 90) {
    return PAYABLE_AGING_BUCKETS.Days61To90;
  }
  return PAYABLE_AGING_BUCKETS.Days90Plus;
}

export type PayableAgingSummary = Record<PayableAgingBucket, { count: number; remaining: string }>;

export function emptyPayableAgingSummary(): PayableAgingSummary {
  return {
    [PAYABLE_AGING_BUCKETS.Settled]: { count: 0, remaining: '0.0000' },
    [PAYABLE_AGING_BUCKETS.Cancelled]: { count: 0, remaining: '0.0000' },
    [PAYABLE_AGING_BUCKETS.Current]: { count: 0, remaining: '0.0000' },
    [PAYABLE_AGING_BUCKETS.Days1To30]: { count: 0, remaining: '0.0000' },
    [PAYABLE_AGING_BUCKETS.Days31To60]: { count: 0, remaining: '0.0000' },
    [PAYABLE_AGING_BUCKETS.Days61To90]: { count: 0, remaining: '0.0000' },
    [PAYABLE_AGING_BUCKETS.Days90Plus]: { count: 0, remaining: '0.0000' },
  };
}

export function summarizePayableAging(
  items: Array<{
    lifecycle: string;
    principal: string;
    payments: PostedPayment[];
    dueDate: string;
  }>,
  asOf?: Date,
): PayableAgingSummary {
  const summary = emptyPayableAgingSummary();
  for (const item of items) {
    const bucket = classifyPayableAging({ ...item, asOf });
    const remaining = remainingBalance(item.principal, item.payments);
    summary[bucket].count += 1;
    summary[bucket].remaining = sumMoneyAmounts([summary[bucket].remaining, remaining]);
  }
  return summary;
}

export function assertPayableActive(lifecycle: string): void {
  if (lifecycle !== PAYABLE_LIFECYCLES.Active) {
    throw new PayableError('PAYABLE_CANCELLED');
  }
}

export function assertPaymentCurrency(payableCurrency: string, paymentCurrency: string): void {
  if (assertCurrencyCode(payableCurrency) !== assertCurrencyCode(paymentCurrency)) {
    throw new PayableError('PAYABLE_CURRENCY_MISMATCH');
  }
}

export function assertPaymentAmount(amount: string): string {
  const normalized = normalizeMoneyAmount(amount);
  if (!isPositiveMoneyAmount(normalized)) {
    throw new PayableError('PAYABLE_INVALID_PAYMENT_AMOUNT');
  }
  return normalized;
}

export function assertNoOverpayment(
  principal: string,
  payments: PostedPayment[],
  incomingAmount: string,
): string {
  const remaining = remainingBalance(principal, payments);
  if (compareMoneyAmounts(incomingAmount, remaining) > 0) {
    throw new PayableError('PAYABLE_OVERPAYMENT');
  }
  return remaining;
}

export function assertNoInstallmentOverpayment(
  installmentPrincipal: string,
  payments: PostedPayment[],
  installmentId: string,
  incomingAmount: string,
): string {
  const remaining = installmentRemaining(installmentPrincipal, payments, installmentId);
  if (compareMoneyAmounts(incomingAmount, remaining) > 0) {
    throw new PayableError('PAYABLE_OVERPAYMENT');
  }
  return remaining;
}

export function assertInstallmentSchedule(
  principal: string,
  installments: PayableInstallmentDraft[],
): PayableInstallmentDraft[] {
  if (installments.length < 1) {
    throw new PayableError('PAYABLE_INSTALLMENTS_REQUIRED');
  }
  const seen = new Set<number>();
  for (const installment of installments) {
    if (!Number.isInteger(installment.installmentNumber) || installment.installmentNumber < 1) {
      throw new PayableError('PAYABLE_INVALID_INSTALLMENT');
    }
    if (seen.has(installment.installmentNumber)) {
      throw new PayableError('PAYABLE_DUPLICATE_INSTALLMENT');
    }
    seen.add(installment.installmentNumber);
    assertPaymentAmount(installment.principal);
  }
  const total = sumMoneyAmounts(installments.map((item) => item.principal));
  if (!moneyAmountsEqual(total, principal)) {
    throw new PayableError('PAYABLE_INSTALLMENT_TOTAL_MISMATCH');
  }
  return [...installments].sort((left, right) => left.installmentNumber - right.installmentNumber);
}

export function defaultInstallment(principal: string, dueDate: string): PayableInstallmentDraft {
  return {
    installmentNumber: 1,
    principal: normalizeMoneyAmount(principal),
    dueDate: dateOnly(dueDate),
  };
}

export function reconcilePayable(input: {
  principal: string;
  payments: PostedPayment[];
}): { remaining: string; paid: string; negativeBalance: boolean } {
  const paid = netPaidAmount(input.payments);
  const remaining = remainingBalance(input.principal, input.payments);
  return {
    remaining,
    paid,
    negativeBalance: compareMoneyAmounts(remaining, '0') < 0,
  };
}

export function reversalCapacity(originalAmount: string, existingReversals: string[]): string {
  return subtractMoneyAmounts(normalizeMoneyAmount(originalAmount), sumMoneyAmounts(existingReversals));
}

export function assertReversalAmount(originalAmount: string, existingReversals: string[], incomingAmount: string): string {
  const amount = assertPaymentAmount(incomingAmount);
  const capacity = reversalCapacity(originalAmount, existingReversals);
  if (compareMoneyAmounts(amount, capacity) > 0) {
    throw new PayableError('PAYABLE_REVERSAL_EXCEEDS_PAYMENT');
  }
  if (isZeroMoneyAmount(capacity)) {
    throw new PayableError('PAYMENT_ALREADY_REVERSED');
  }
  return amount;
}

export function assertPaymentImmutable(): never {
  throw new PayableError('PAYMENT_IMMUTABLE');
}

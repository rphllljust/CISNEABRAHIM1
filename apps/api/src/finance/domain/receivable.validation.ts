import { assertUuid } from '../../platform/kernel/uuid';
import { assertCurrencyCode, normalizeMoneyAmount } from '../../platform/kernel/money-math';
import {
  assertInstallmentSchedule,
  assertSettlementAmount,
  assertSettlementReversalReason,
  defaultInstallment,
} from './receivable';

export class ReceivableValidationError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

export type SettleReceivableInput = {
  amount: string;
  rowVersion: number;
  idempotencyKey: string;
  installmentId?: string;
  externalReference?: string;
  settledAt?: string;
};

export type CancelReceivableInput = {
  rowVersion: number;
  cancelReason: string;
  idempotencyKey?: string;
};

export type ReverseSettlementInput = {
  reason: string;
  idempotencyKey: string;
};

function requireDueDate(value: string | undefined | null, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    throw new ReceivableValidationError(field);
  }
  return trimmed.slice(0, 10);
}

export function validateSettleReceivableInput(input: SettleReceivableInput): SettleReceivableInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new ReceivableValidationError('rowVersion');
  }
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey) {
    throw new ReceivableValidationError('idempotencyKey');
  }
  let amount: string;
  try {
    amount = assertSettlementAmount(input.amount);
  } catch {
    throw new ReceivableValidationError('amount');
  }
  if (input.installmentId !== undefined) {
    assertUuid(input.installmentId, 'installmentId');
  }
  if (input.externalReference !== undefined && input.externalReference.trim().length === 0) {
    throw new ReceivableValidationError('externalReference');
  }
  if (input.settledAt !== undefined) {
    const parsed = Date.parse(input.settledAt);
    if (Number.isNaN(parsed)) {
      throw new ReceivableValidationError('settledAt');
    }
  }
  return {
    amount,
    rowVersion: input.rowVersion,
    idempotencyKey,
    installmentId: input.installmentId,
    externalReference: input.externalReference?.trim() || undefined,
    settledAt: input.settledAt,
  };
}

export function validateCancelReceivableInput(input: CancelReceivableInput): CancelReceivableInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new ReceivableValidationError('rowVersion');
  }
  const cancelReason = input.cancelReason?.trim();
  if (!cancelReason || cancelReason.length < 3) {
    throw new ReceivableValidationError('cancelReason');
  }
  if (input.idempotencyKey !== undefined && input.idempotencyKey.trim().length === 0) {
    throw new ReceivableValidationError('idempotencyKey');
  }
  return {
    rowVersion: input.rowVersion,
    cancelReason,
    idempotencyKey: input.idempotencyKey?.trim() || undefined,
  };
}

export function validateReverseSettlementInput(
  input: ReverseSettlementInput,
): ReverseSettlementInput {
  let reason: string;
  try {
    reason = assertSettlementReversalReason(input.reason);
  } catch {
    throw new ReceivableValidationError('reason');
  }
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey) {
    throw new ReceivableValidationError('idempotencyKey');
  }
  return { reason, idempotencyKey };
}

export function normalizeOpenReceivableMoney(principal: string, currencyCode: string): {
  principal: string;
  currencyCode: string;
} {
  return {
    principal: normalizeMoneyAmount(principal),
    currencyCode: assertCurrencyCode(currencyCode),
  };
}

export function resolveOpenInstallments(
  principal: string,
  dueDate: string,
  installments?: Array<{ installmentNumber: number; principal: string; dueDate: string }>,
) {
  const resolvedDueDate = requireDueDate(dueDate, 'dueDate');
  if (!installments || installments.length === 0) {
    return [defaultInstallment(principal, resolvedDueDate)];
  }
  return assertInstallmentSchedule(
    principal,
    installments.map((item) => ({
      installmentNumber: item.installmentNumber,
      principal: normalizeMoneyAmount(item.principal),
      dueDate: requireDueDate(item.dueDate, 'installments.dueDate'),
    })),
  );
}

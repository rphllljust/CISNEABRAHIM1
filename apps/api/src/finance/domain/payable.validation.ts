import { assertUuid } from '../../platform/kernel/uuid';
import { assertCurrencyCode, normalizeMoneyAmount } from '../../platform/kernel/money-math';
import {
  PayableError,
  assertInstallmentSchedule,
  assertPayableOriginKind,
  assertPaymentAmount,
  defaultInstallment,
} from './payable';

export class PayableValidationError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

export type OpenPayableInput = {
  unitId: string;
  counterpartyId?: string;
  supplierId?: string;
  originKind: string;
  originId: string;
  originReference: string;
  expenseCategoryId: string;
  costCenterId: string;
  costCenterCode: string;
  principal: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  externalReference?: string | null;
  installments?: Array<{ installmentNumber: number; principal: string; dueDate: string }>;
};

export type PayPayableInput = {
  amount: string;
  rowVersion: number;
  idempotencyKey: string;
  paymentReference: string;
  installmentId?: string;
  paidAt?: string;
};

export type ReversePaymentInput = {
  rowVersion: number;
  idempotencyKey: string;
  paymentReference: string;
  amount?: string;
  reason: string;
};

export type CancelPayableInput = {
  rowVersion: number;
  cancelReason: string;
  idempotencyKey?: string;
};

export type CreateExpenseCategoryInput = {
  code: string;
  name: string;
};

function requireDueDate(value: string | undefined | null, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    throw new PayableValidationError(field);
  }
  return trimmed.slice(0, 10);
}

function requireNonEmpty(value: string | undefined | null, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new PayableValidationError(field);
  }
  return trimmed;
}

export function validateCreateExpenseCategoryInput(
  input: CreateExpenseCategoryInput,
): CreateExpenseCategoryInput {
  return {
    code: requireNonEmpty(input.code, 'code'),
    name: requireNonEmpty(input.name, 'name'),
  };
}

export type CreateCostCenterInput = {
  code: string;
  name: string;
};

/**
 * Validacao do cadastro de centro de custo.
 *
 * O codigo e o identificador HUMANO: e por ele que o operador escolhe o centro de custo no
 * lancamento. Por isso e obrigatorio e nao pode ser so espaco — um codigo vazio criaria uma
 * referencia que ninguem consegue distinguir de outra na busca.
 */
export function validateCreateCostCenterInput(input: CreateCostCenterInput): CreateCostCenterInput {
  return {
    code: requireNonEmpty(input.code, 'code'),
    name: requireNonEmpty(input.name, 'name'),
  };
}

export function validateOpenPayableInput(
  input: OpenPayableInput,
): OpenPayableInput & { counterpartyId: string } {
  const unitId = requireNonEmpty(input.unitId, 'unitId');
  const supplierId = input.supplierId ? (assertUuid(input.supplierId, 'supplierId'), input.supplierId) : undefined;
  const counterpartyId = supplierId ?? input.counterpartyId;
  if (!counterpartyId) {
    throw new PayableValidationError('counterpartyId');
  }
  assertUuid(counterpartyId, 'counterpartyId');
  assertUuid(input.originId, 'originId');
  assertUuid(input.expenseCategoryId, 'expenseCategoryId');
  assertUuid(input.costCenterId, 'costCenterId');
  let originKind: string;
  try {
    originKind = assertPayableOriginKind(input.originKind);
  } catch (error) {
    if (error instanceof PayableError && error.code === 'PAYABLE_FORBIDDEN_ORIGIN') {
      throw error;
    }
    throw new PayableValidationError('originKind');
  }
  const originReference = requireNonEmpty(input.originReference, 'originReference');
  const costCenterCode = requireNonEmpty(input.costCenterCode, 'costCenterCode');
  const paymentTerms = requireNonEmpty(input.paymentTerms, 'paymentTerms');
  let principal: string;
  let currencyCode: string;
  try {
    principal = normalizeMoneyAmount(input.principal);
    currencyCode = assertCurrencyCode(input.currencyCode);
  } catch {
    throw new PayableValidationError('principal');
  }
  const dueDate = requireDueDate(input.dueDate, 'dueDate');
  const installments = resolveOpenInstallments(principal, dueDate, input.installments);
  return {
    unitId,
    counterpartyId,
    supplierId,
    originKind,
    originId: input.originId,
    originReference,
    expenseCategoryId: input.expenseCategoryId,
    costCenterId: input.costCenterId,
    costCenterCode,
    principal,
    currencyCode,
    dueDate,
    paymentTerms,
    externalReference: input.externalReference?.trim() || null,
    installments,
  };
}

export function validatePayPayableInput(input: PayPayableInput): PayPayableInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new PayableValidationError('rowVersion');
  }
  const idempotencyKey = requireNonEmpty(input.idempotencyKey, 'idempotencyKey');
  const paymentReference = requireNonEmpty(input.paymentReference, 'paymentReference');
  let amount: string;
  try {
    amount = assertPaymentAmount(input.amount);
  } catch {
    throw new PayableValidationError('amount');
  }
  if (input.installmentId !== undefined) {
    assertUuid(input.installmentId, 'installmentId');
  }
  if (input.paidAt !== undefined) {
    const parsed = Date.parse(input.paidAt);
    if (Number.isNaN(parsed)) {
      throw new PayableValidationError('paidAt');
    }
  }
  return {
    amount,
    rowVersion: input.rowVersion,
    idempotencyKey,
    paymentReference,
    installmentId: input.installmentId,
    paidAt: input.paidAt,
  };
}

export function validateReversePaymentInput(input: ReversePaymentInput): ReversePaymentInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new PayableValidationError('rowVersion');
  }
  const idempotencyKey = requireNonEmpty(input.idempotencyKey, 'idempotencyKey');
  const paymentReference = requireNonEmpty(input.paymentReference, 'paymentReference');
  const reason = requireNonEmpty(input.reason, 'reason');
  if (reason.length < 3) {
    throw new PayableValidationError('reason');
  }
  if (input.amount !== undefined) {
    try {
      assertPaymentAmount(input.amount);
    } catch {
      throw new PayableValidationError('amount');
    }
  }
  return {
    rowVersion: input.rowVersion,
    idempotencyKey,
    paymentReference,
    amount: input.amount,
    reason,
  };
}

export function validateCancelPayableInput(input: CancelPayableInput): CancelPayableInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new PayableValidationError('rowVersion');
  }
  const cancelReason = input.cancelReason?.trim();
  if (!cancelReason || cancelReason.length < 3) {
    throw new PayableValidationError('cancelReason');
  }
  if (input.idempotencyKey !== undefined && input.idempotencyKey.trim().length === 0) {
    throw new PayableValidationError('idempotencyKey');
  }
  return {
    rowVersion: input.rowVersion,
    cancelReason,
    idempotencyKey: input.idempotencyKey?.trim() || undefined,
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

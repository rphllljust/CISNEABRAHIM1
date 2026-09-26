import { APPROVAL_OPERATIONS, type ApprovalOperation, assertNotSelfApproval } from './approval-matrix';
import { isOperationalAuthorityAction } from './operational-authority';

/**
 * Critical SOD catalog — capabilities and roles, never person names.
 * SRC-008 operational-authority pairs (OS create/release, measurement submit/approve)
 * are intentionally absent: BR-046 / BR-050 do not require maker-checker there.
 */
export const SOD_CONFLICT_KINDS = {
  CreateApprove: 'CREATE_APPROVE',
  RequestPay: 'REQUEST_PAY',
  PrepareConfirm: 'PREPARE_CONFIRM',
  PostApprove: 'POST_APPROVE',
} as const;

export type SodConflictKind = (typeof SOD_CONFLICT_KINDS)[keyof typeof SOD_CONFLICT_KINDS];

export const SOD_CAPABILITIES = {
  SupplierActivate: 'supplier.activate',
  PurchaseApprove: 'purchase.approve',
  ExpenseApprove: 'expense.approve',
  PaymentApprove: 'payment.approve',
  WriteOffApprove: 'payment.approve',
  ReconciliationConfirm: 'reconciliation.confirm',
  AdjustmentApprove: 'adjustment.approve',
  ReopenApprove: 'reopen.approve',
  FiscalSubmit: 'fiscal.submit',
  TaxFinalize: 'fiscal.finalize',
  PayrollClose: 'payroll.close',
  BudgetApprove: 'budget.approve',
  TreasuryTransfer: 'treasury.transfer',
  TreasuryReverse: 'treasury.reverse',
} as const;

/** Unit of work for non-monetary SOD operations that still go through the approval matrix. */
export const SOD_NON_MONETARY_AMOUNT = '1.0000';

export const SOD_ROLE_CODES = {
  FinancialController: 'FINANCIAL_CONTROLLER',
} as const;

export type SodDuty = {
  id: string;
  domain: string;
  conflictKind: SodConflictKind;
  approvalOperation: ApprovalOperation;
  capability: string;
};

export const SOD_DUTIES = {
  SupplierActivate: {
    id: 'SOD-SUPPLIER-ACTIVATE',
    domain: 'supplier',
    conflictKind: SOD_CONFLICT_KINDS.CreateApprove,
    approvalOperation: APPROVAL_OPERATIONS.Purchase,
    capability: SOD_CAPABILITIES.SupplierActivate,
  },
  PurchaseApprove: {
    id: 'SOD-PURCHASE-APPROVE',
    domain: 'purchase',
    conflictKind: SOD_CONFLICT_KINDS.CreateApprove,
    approvalOperation: APPROVAL_OPERATIONS.Purchase,
    capability: SOD_CAPABILITIES.PurchaseApprove,
  },
  ExpenseApprove: {
    id: 'SOD-EXPENSE-APPROVE',
    domain: 'expense',
    conflictKind: SOD_CONFLICT_KINDS.CreateApprove,
    approvalOperation: APPROVAL_OPERATIONS.Expense,
    capability: SOD_CAPABILITIES.ExpenseApprove,
  },
  PayablePay: {
    id: 'SOD-PAYABLE-PAY',
    domain: 'payment',
    conflictKind: SOD_CONFLICT_KINDS.RequestPay,
    approvalOperation: APPROVAL_OPERATIONS.Payment,
    capability: SOD_CAPABILITIES.PaymentApprove,
  },
  PayableReverse: {
    id: 'SOD-PAYABLE-REVERSE',
    domain: 'write-off',
    conflictKind: SOD_CONFLICT_KINDS.PostApprove,
    approvalOperation: APPROVAL_OPERATIONS.Adjustment,
    capability: SOD_CAPABILITIES.AdjustmentApprove,
  },
  ReceivableSettle: {
    id: 'SOD-RECEIVABLE-SETTLE',
    domain: 'write-off',
    conflictKind: SOD_CONFLICT_KINDS.RequestPay,
    approvalOperation: APPROVAL_OPERATIONS.Payment,
    capability: SOD_CAPABILITIES.WriteOffApprove,
  },
  ReceivableReverse: {
    id: 'SOD-RECEIVABLE-REVERSE',
    domain: 'write-off',
    conflictKind: SOD_CONFLICT_KINDS.PostApprove,
    approvalOperation: APPROVAL_OPERATIONS.Adjustment,
    capability: SOD_CAPABILITIES.AdjustmentApprove,
  },
  ReconciliationConfirm: {
    id: 'SOD-RECON-CONFIRM',
    domain: 'reconciliation',
    conflictKind: SOD_CONFLICT_KINDS.PrepareConfirm,
    approvalOperation: APPROVAL_OPERATIONS.Payment,
    capability: SOD_CAPABILITIES.ReconciliationConfirm,
  },
  JournalPost: {
    id: 'SOD-JOURNAL-POST',
    domain: 'accounting-adjustment',
    conflictKind: SOD_CONFLICT_KINDS.PostApprove,
    approvalOperation: APPROVAL_OPERATIONS.Adjustment,
    capability: SOD_CAPABILITIES.AdjustmentApprove,
  },
  AccountingPeriodReopen: {
    id: 'SOD-ACCOUNTING-REOPEN',
    domain: 'period-reopen',
    conflictKind: SOD_CONFLICT_KINDS.PrepareConfirm,
    approvalOperation: APPROVAL_OPERATIONS.Reopen,
    capability: SOD_CAPABILITIES.ReopenApprove,
  },
  FiscalSubmit: {
    id: 'SOD-FISCAL-SUBMIT',
    domain: 'fiscal',
    conflictKind: SOD_CONFLICT_KINDS.PrepareConfirm,
    approvalOperation: APPROVAL_OPERATIONS.Adjustment,
    capability: SOD_CAPABILITIES.FiscalSubmit,
  },
  TaxAssessmentFinalize: {
    id: 'SOD-TAX-FINALIZE',
    domain: 'fiscal',
    conflictKind: SOD_CONFLICT_KINDS.CreateApprove,
    approvalOperation: APPROVAL_OPERATIONS.Adjustment,
    capability: SOD_CAPABILITIES.TaxFinalize,
  },
  FiscalPeriodReopen: {
    id: 'SOD-FISCAL-REOPEN',
    domain: 'period-reopen',
    conflictKind: SOD_CONFLICT_KINDS.PrepareConfirm,
    approvalOperation: APPROVAL_OPERATIONS.Reopen,
    capability: SOD_CAPABILITIES.ReopenApprove,
  },
  PayrollClose: {
    id: 'SOD-PAYROLL-CLOSE',
    domain: 'payroll',
    conflictKind: SOD_CONFLICT_KINDS.PrepareConfirm,
    approvalOperation: APPROVAL_OPERATIONS.Adjustment,
    capability: SOD_CAPABILITIES.PayrollClose,
  },
  PayrollReopen: {
    id: 'SOD-PAYROLL-REOPEN',
    domain: 'period-reopen',
    conflictKind: SOD_CONFLICT_KINDS.PrepareConfirm,
    approvalOperation: APPROVAL_OPERATIONS.Reopen,
    capability: SOD_CAPABILITIES.ReopenApprove,
  },
  BudgetApprove: {
    id: 'SOD-BUDGET-APPROVE',
    domain: 'expense',
    conflictKind: SOD_CONFLICT_KINDS.CreateApprove,
    approvalOperation: APPROVAL_OPERATIONS.Budget,
    capability: SOD_CAPABILITIES.BudgetApprove,
  },
  TreasuryTransfer: {
    id: 'SOD-TREASURY-TRANSFER',
    domain: 'treasury',
    conflictKind: SOD_CONFLICT_KINDS.RequestPay,
    approvalOperation: APPROVAL_OPERATIONS.Payment,
    capability: SOD_CAPABILITIES.TreasuryTransfer,
  },
  TreasuryReverse: {
    id: 'SOD-TREASURY-REVERSE',
    domain: 'treasury',
    conflictKind: SOD_CONFLICT_KINDS.PostApprove,
    approvalOperation: APPROVAL_OPERATIONS.Adjustment,
    capability: SOD_CAPABILITIES.TreasuryReverse,
  },
} as const satisfies Record<string, SodDuty>;

export type SodDutyId = (typeof SOD_DUTIES)[keyof typeof SOD_DUTIES]['id'];

export class SodError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function assertSodOriginator(originatorIdentityId: string | null | undefined): string {
  const trimmed = originatorIdentityId?.trim() ?? '';
  if (!trimmed) {
    throw new SodError('SOD_ORIGINATOR_MISSING');
  }
  return trimmed;
}

export function assertSodDistinctActors(actorIdentityId: string, originatorIdentityId: string): void {
  assertNotSelfApproval(actorIdentityId, assertSodOriginator(originatorIdentityId));
}

export function listSodDuties(): SodDuty[] {
  return Object.values(SOD_DUTIES);
}

export function sodDutyConflictsWithOperationalAuthority(action: string): boolean {
  return isOperationalAuthorityAction(action);
}

export function resolveSodScope(unitId?: string | null): {
  scopeType: 'UNIT' | 'GLOBAL';
  scopeAnchor: string | null;
} {
  const trimmed = unitId?.trim() ?? '';
  if (trimmed) {
    return { scopeType: 'UNIT', scopeAnchor: trimmed };
  }
  return { scopeType: 'GLOBAL', scopeAnchor: null };
}

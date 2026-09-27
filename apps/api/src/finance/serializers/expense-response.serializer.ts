import type { ExpenseAggregate } from '../repositories/expense.repository';
import type { ExpenseRow } from '../repositories/expense.repository.types';

export type ExpenseResponse = {
  id: string;
  unitId: string;
  requesterIdentityId: string;
  expenseCategoryId: string;
  costCenterId: string;
  costCenterCode: string;
  totalAmount: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  description: string;
  receiptDocumentId: string | null;
  reimbursable: boolean;
  status: string;
  version: number;
  items: Array<{ id: string; lineNumber: number; description: string; amount: string }>;
  approval: {
    id: string;
    decision: string;
    actorIdentityId: string;
    approvalRuleId: string | null;
    reason: string | null;
  } | null;
  reimbursement: {
    id: string;
    payableId: string;
    amount: string;
    currencyCode: string;
  } | null;
};

export type ExpenseSummaryResponse = {
  id: string;
  unitId: string;
  description: string;
  costCenterCode: string;
  totalAmount: string;
  currencyCode: string;
  dueDate: string;
  status: string;
  version: number;
  createdAt: string;
};

export type ExpenseListResponse = {
  items: ExpenseSummaryResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

/** Linha de lista: a despesa é identificada pela descrição, centro de custo, valor e estado. */
export function toExpenseSummaryResponse(row: ExpenseRow): ExpenseSummaryResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    description: row.description,
    costCenterCode: row.cost_center_code,
    totalAmount: row.total_amount,
    currencyCode: row.currency_code,
    dueDate: String(row.due_date).slice(0, 10),
    status: row.status,
    version: row.version,
    createdAt: String(row.created_at),
  };
}

export function toExpenseResponse(aggregate: ExpenseAggregate): ExpenseResponse {
  return {
    id: aggregate.expense.id,
    unitId: aggregate.expense.unit_id,
    requesterIdentityId: aggregate.expense.requester_identity_id,
    expenseCategoryId: aggregate.expense.expense_category_id,
    costCenterId: aggregate.expense.cost_center_id,
    costCenterCode: aggregate.expense.cost_center_code,
    totalAmount: aggregate.expense.total_amount,
    currencyCode: aggregate.expense.currency_code,
    dueDate: String(aggregate.expense.due_date).slice(0, 10),
    paymentTerms: aggregate.expense.payment_terms,
    description: aggregate.expense.description,
    receiptDocumentId: aggregate.expense.receipt_document_id,
    reimbursable: aggregate.expense.reimbursable,
    status: aggregate.expense.status,
    version: aggregate.expense.version,
    items: aggregate.items.map((item) => ({
      id: item.id,
      lineNumber: item.line_number,
      description: item.description,
      amount: item.amount,
    })),
    approval: aggregate.approval
      ? {
          id: aggregate.approval.id,
          decision: aggregate.approval.decision,
          actorIdentityId: aggregate.approval.actor_identity_id,
          approvalRuleId: aggregate.approval.approval_rule_id,
          reason: aggregate.approval.reason,
        }
      : null,
    reimbursement: aggregate.reimbursement
      ? {
          id: aggregate.reimbursement.id,
          payableId: aggregate.reimbursement.payable_id,
          amount: aggregate.reimbursement.amount,
          currencyCode: aggregate.reimbursement.currency_code,
        }
      : null,
  };
}

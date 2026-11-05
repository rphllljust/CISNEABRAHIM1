export type ExpenseCategoryRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  created_by_identity_id: string;
  updated_by_identity_id: string;
};

export type PayableRow = {
  id: string;
  unit_id: string;
  counterparty_id: string;
  origin_kind: string;
  origin_id: string;
  origin_reference: string;
  expense_category_id: string;
  cost_center_id: string;
  cost_center_code: string;
  principal: string;
  currency_code: string;
  due_date: string;
  payment_terms: string;
  external_reference: string | null;
  lifecycle: string;
  cancelled_at: string | null;
  cancelled_by_identity_id: string | null;
  cancel_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  created_by_identity_id: string;
  updated_by_identity_id: string;
};

export type PayableInstallmentRow = {
  id: string;
  payable_id: string;
  installment_number: number;
  principal: string;
  due_date: string;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  payable_id: string;
  installment_id: string;
  kind: string;
  amount: string;
  currency_code: string;
  paid_at: string;
  idempotency_key: string;
  payment_reference: string;
  origin_kind: string;
  origin_id: string;
  origin_reference: string;
  reverses_payment_id: string | null;
  actor_identity_id: string;
  created_at: string;
};

export type OpenPayablePersistenceInput = {
  unitId: string;
  counterpartyId: string;
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
  externalReference: string | null;
  actorIdentityId: string;
  installments: Array<{ installmentNumber: number; principal: string; dueDate: string }>;
};

export type PayPayablePersistenceInput = {
  payableId: string;
  amount: string;
  currencyCode: string;
  rowVersion: number;
  idempotencyKey: string;
  paymentReference: string;
  installmentId?: string;
  paidAt: string;
  actorIdentityId: string;
};

export type ReversePaymentPersistenceInput = {
  payableId: string;
  paymentId: string;
  amount?: string;
  rowVersion: number;
  idempotencyKey: string;
  paymentReference: string;
  reason: string;
  actorIdentityId: string;
};

export type CancelPayablePersistenceInput = {
  payableId: string;
  rowVersion: number;
  cancelReason: string;
  actorIdentityId: string;
};

export type CreateExpenseCategoryPersistenceInput = {
  code: string;
  name: string;
  actorIdentityId: string;
};

/** Recorte de leitura da listagem de categorias de despesa (cadastro global, sem unidade). */
export type ListExpenseCategoriesInput = {
  search?: string;
  status?: string;
  limit: number;
  offset: number;
};

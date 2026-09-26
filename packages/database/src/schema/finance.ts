import { boolean, integer, jsonb, numeric, pgSchema, text, timestamp, uuid, date } from 'drizzle-orm/pg-core';
import { identities } from './identity';

export const finSchema = pgSchema('fin');

export const receivableLifecycleEnum = finSchema.enum('receivable_lifecycle', ['ACTIVE', 'CANCELLED']);

export const receivableOriginKindEnum = finSchema.enum('receivable_origin_kind', ['BILLING_DOCUMENT']);

export const settlementStatusEnum = finSchema.enum('settlement_status', ['POSTED', 'REVERSED']);

export const receivables = finSchema.table('receivables', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: text('unit_id').notNull(),
  clientId: uuid('client_id').notNull(),
  originKind: receivableOriginKindEnum('origin_kind').notNull(),
  originBillingDocumentId: uuid('origin_billing_document_id').notNull(),
  originBillingRecordId: uuid('origin_billing_record_id').notNull(),
  originServiceOrderId: uuid('origin_service_order_id').notNull(),
  originMeasurementId: uuid('origin_measurement_id').notNull(),
  principal: numeric('principal', { precision: 18, scale: 4 }).notNull(),
  currencyCode: text('currency_code').notNull(),
  dueDate: date('due_date').notNull(),
  paymentTerms: text('payment_terms').notNull(),
  externalReference: text('external_reference'),
  lifecycle: receivableLifecycleEnum('lifecycle').notNull().default('ACTIVE'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledByIdentityId: uuid('cancelled_by_identity_id').references(() => identities.id),
  cancelReason: text('cancel_reason'),
  rowVersion: integer('row_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
  updatedByIdentityId: uuid('updated_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const receivableInstallments = finSchema.table('receivable_installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  receivableId: uuid('receivable_id')
    .notNull()
    .references(() => receivables.id, { onDelete: 'cascade' }),
  installmentNumber: integer('installment_number').notNull(),
  principal: numeric('principal', { precision: 18, scale: 4 }).notNull(),
  dueDate: date('due_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settlements = finSchema.table('settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  receivableId: uuid('receivable_id')
    .notNull()
    .references(() => receivables.id),
  installmentId: uuid('installment_id').references(() => receivableInstallments.id),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  currencyCode: text('currency_code').notNull(),
  status: settlementStatusEnum('status').notNull().default('POSTED'),
  settledAt: timestamp('settled_at', { withTimezone: true }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  externalReference: text('external_reference'),
  actorIdentityId: uuid('actor_identity_id')
    .notNull()
    .references(() => identities.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  reversedByIdentityId: uuid('reversed_by_identity_id').references(() => identities.id),
  reversalReason: text('reversal_reason'),
  reversalIdempotencyKey: text('reversal_idempotency_key'),
});

export const payableLifecycleEnum = finSchema.enum('payable_lifecycle', ['ACTIVE', 'CANCELLED']);

export const payableOriginKindEnum = finSchema.enum('payable_origin_kind', [
  'SUPPLIER_INVOICE',
  'PURCHASE',
  'OPERATIONAL_EXPENSE',
  'PAYROLL_OBLIGATION',
  'TAX_OBLIGATION',
  'MANUAL_AUTHORIZED_EXPENSE',
]);

export const expenseCategoryStatusEnum = finSchema.enum('expense_category_status', [
  'ACTIVE',
  'INACTIVE',
]);

export const paymentKindEnum = finSchema.enum('payment_kind', ['PAYMENT', 'REVERSAL']);

export const expenseCategories = finSchema.table('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  status: expenseCategoryStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
  updatedByIdentityId: uuid('updated_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const payables = finSchema.table('payables', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: text('unit_id').notNull(),
  counterpartyId: uuid('counterparty_id').notNull(),
  originKind: payableOriginKindEnum('origin_kind').notNull(),
  originId: uuid('origin_id').notNull(),
  originReference: text('origin_reference').notNull(),
  expenseCategoryId: uuid('expense_category_id')
    .notNull()
    .references(() => expenseCategories.id),
  costCenterId: uuid('cost_center_id').notNull(),
  costCenterCode: text('cost_center_code').notNull(),
  principal: numeric('principal', { precision: 18, scale: 4 }).notNull(),
  currencyCode: text('currency_code').notNull(),
  dueDate: date('due_date').notNull(),
  paymentTerms: text('payment_terms').notNull(),
  externalReference: text('external_reference'),
  lifecycle: payableLifecycleEnum('lifecycle').notNull().default('ACTIVE'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledByIdentityId: uuid('cancelled_by_identity_id').references(() => identities.id),
  cancelReason: text('cancel_reason'),
  rowVersion: integer('row_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
  updatedByIdentityId: uuid('updated_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const payableInstallments = finSchema.table('payable_installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  payableId: uuid('payable_id')
    .notNull()
    .references(() => payables.id, { onDelete: 'cascade' }),
  installmentNumber: integer('installment_number').notNull(),
  principal: numeric('principal', { precision: 18, scale: 4 }).notNull(),
  dueDate: date('due_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payments = finSchema.table('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  payableId: uuid('payable_id')
    .notNull()
    .references(() => payables.id),
  installmentId: uuid('installment_id')
    .notNull()
    .references(() => payableInstallments.id),
  kind: paymentKindEnum('kind').notNull().default('PAYMENT'),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  currencyCode: text('currency_code').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  paymentReference: text('payment_reference').notNull(),
  originKind: payableOriginKindEnum('origin_kind').notNull(),
  originId: uuid('origin_id').notNull(),
  originReference: text('origin_reference').notNull(),
  reversesPaymentId: uuid('reverses_payment_id'),
  actorIdentityId: uuid('actor_identity_id')
    .notNull()
    .references(() => identities.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const financialAccountKindEnum = finSchema.enum('financial_account_kind', ['BANK', 'CASH']);

export const financialAccountLifecycleEnum = finSchema.enum('financial_account_lifecycle', [
  'ACTIVE',
  'CLOSED',
]);

export const financialDirectionEnum = finSchema.enum('financial_direction', ['CREDIT', 'DEBIT']);

export const financialTransactionStatusEnum = finSchema.enum('financial_transaction_status', [
  'POSTED',
]);

export const treasuryTransferKindEnum = finSchema.enum('treasury_transfer_kind', [
  'TRANSFER',
  'REVERSAL',
]);

export const treasuryOriginKindEnum = finSchema.enum('treasury_origin_kind', [
  'OPENING_BALANCE',
  'MANUAL_AUTHORIZED',
  'PAYABLE_PAYMENT',
  'RECEIVABLE_SETTLEMENT',
  'TRANSFER',
  'REVERSAL',
]);

export const financialAccounts = finSchema.table('financial_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: text('unit_id').notNull(),
  kind: financialAccountKindEnum('kind').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  currencyCode: text('currency_code').notNull(),
  overdraftAllowed: boolean('overdraft_allowed').notNull().default(false),
  lifecycle: financialAccountLifecycleEnum('lifecycle').notNull().default('ACTIVE'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedByIdentityId: uuid('closed_by_identity_id').references(() => identities.id),
  closeReason: text('close_reason'),
  rowVersion: integer('row_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
  updatedByIdentityId: uuid('updated_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const bankAccounts = finSchema.table('bank_accounts', {
  financialAccountId: uuid('financial_account_id')
    .primaryKey()
    .references(() => financialAccounts.id, { onDelete: 'cascade' }),
  bankCode: text('bank_code').notNull(),
  agency: text('agency').notNull(),
  accountNumber: text('account_number').notNull(),
});

export const cashAccounts = finSchema.table('cash_accounts', {
  financialAccountId: uuid('financial_account_id')
    .primaryKey()
    .references(() => financialAccounts.id, { onDelete: 'cascade' }),
  locationCode: text('location_code').notNull(),
});

export const treasuryTransfers = finSchema.table('treasury_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromAccountId: uuid('from_account_id')
    .notNull()
    .references(() => financialAccounts.id),
  toAccountId: uuid('to_account_id')
    .notNull()
    .references(() => financialAccounts.id),
  kind: treasuryTransferKindEnum('kind').notNull().default('TRANSFER'),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  currencyCode: text('currency_code').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  reference: text('reference').notNull(),
  originKind: treasuryOriginKindEnum('origin_kind').notNull(),
  originId: uuid('origin_id').notNull(),
  originReference: text('origin_reference').notNull(),
  reversesTransferId: uuid('reverses_transfer_id'),
  actorIdentityId: uuid('actor_identity_id')
    .notNull()
    .references(() => identities.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bankStatementSourceKindEnum = finSchema.enum('bank_statement_source_kind', [
  'MANUAL',
  'OFX',
  'CNAB',
  'BANK_API',
  'AUTHORIZED_FILE',
]);
export const bankStatementStatusEnum = finSchema.enum('bank_statement_status', ['OPEN', 'CLOSED']);
export const bankStatementLineMatchStatusEnum = finSchema.enum('bank_statement_line_match_status', [
  'UNMATCHED',
  'REVIEW_REQUIRED',
  'SUGGESTED',
  'MATCHED',
]);
export const reconciliationStatusEnum = finSchema.enum('reconciliation_status', [
  'DRAFT',
  'CONFIRMED',
  'UNRECONCILED',
]);
export const reconciliationMatchMethodEnum = finSchema.enum('reconciliation_match_method', [
  'AUTO_EXACT',
  'MANUAL',
]);
export const reconciliationTargetKindEnum = finSchema.enum('reconciliation_target_kind', [
  'RECEIVABLE_SETTLEMENT',
  'PAYABLE_PAYMENT',
  'TRANSFER',
  'FINANCIAL_TRANSACTION',
]);
export const bankImportFormatEnum = finSchema.enum('bank_import_format', [
  'CISNE_STATEMENT_V1',
  'OFX',
  'CNAB',
  'UNKNOWN',
]);
export const bankImportStatusEnum = finSchema.enum('bank_import_status', [
  'UPLOADED',
  'VALIDATED',
  'PARSED',
  'NORMALIZED',
  'IMPORTED',
  'REJECTED',
]);
export const bankLineIdentityKindEnum = finSchema.enum('bank_line_identity_kind', [
  'SUFFICIENT',
  'FILE_LOCAL',
]);

export const bankStatements = finSchema.table('bank_statements', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: text('unit_id').notNull(),
  financialAccountId: uuid('financial_account_id')
    .notNull()
    .references(() => financialAccounts.id),
  sourceKind: bankStatementSourceKindEnum('source_kind').notNull(),
  sourceReference: text('source_reference').notNull(),
  periodStartsOn: date('period_starts_on').notNull(),
  periodEndsOn: date('period_ends_on').notNull(),
  currencyCode: text('currency_code').notNull(),
  status: bankStatementStatusEnum('status').notNull().default('OPEN'),
  idempotencyKey: text('idempotency_key').notNull(),
  fileChecksum: text('file_checksum'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const bankStatementLines = finSchema.table('bank_statement_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  bankStatementId: uuid('bank_statement_id')
    .notNull()
    .references(() => bankStatements.id),
  lineNumber: integer('line_number').notNull(),
  occurredOn: date('occurred_on').notNull(),
  direction: financialDirectionEnum('direction').notNull(),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  description: text('description').notNull(),
  sourceLineKey: text('source_line_key').notNull(),
  externalReference: text('external_reference'),
  matchStatus: bankStatementLineMatchStatusEnum('match_status').notNull().default('UNMATCHED'),
  fingerprint: text('fingerprint'),
  identityKind: bankLineIdentityKindEnum('identity_kind').notNull().default('FILE_LOCAL'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bankStatementImports = finSchema.table('bank_statement_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: text('unit_id').notNull(),
  financialAccountId: uuid('financial_account_id')
    .notNull()
    .references(() => financialAccounts.id),
  bankStatementId: uuid('bank_statement_id').references(() => bankStatements.id),
  format: bankImportFormatEnum('format').notNull(),
  fileName: text('file_name').notNull(),
  fileChecksum: text('file_checksum').notNull(),
  byteSize: integer('byte_size').notNull(),
  status: bankImportStatusEnum('status').notNull(),
  rejectionCode: text('rejection_code'),
  lineCount: integer('line_count').notNull().default(0),
  importedLineCount: integer('imported_line_count').notNull().default(0),
  duplicateLineCount: integer('duplicate_line_count').notNull().default(0),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const reconciliations = finSchema.table('reconciliations', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: text('unit_id').notNull(),
  bankStatementId: uuid('bank_statement_id')
    .notNull()
    .references(() => bankStatements.id),
  bankStatementLineId: uuid('bank_statement_line_id')
    .notNull()
    .references(() => bankStatementLines.id),
  status: reconciliationStatusEnum('status').notNull().default('DRAFT'),
  matchMethod: reconciliationMatchMethodEnum('match_method').notNull(),
  matchCriteria: text('match_criteria').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  confirmedByIdentityId: uuid('confirmed_by_identity_id').references(() => identities.id),
  unreconciledAt: timestamp('unreconciled_at', { withTimezone: true }),
  unreconciledByIdentityId: uuid('unreconciled_by_identity_id').references(() => identities.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const reconciliationMatches = finSchema.table('reconciliation_matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  reconciliationId: uuid('reconciliation_id')
    .notNull()
    .references(() => reconciliations.id),
  bankStatementLineId: uuid('bank_statement_line_id')
    .notNull()
    .references(() => bankStatementLines.id),
  targetKind: reconciliationTargetKindEnum('target_kind').notNull(),
  targetId: uuid('target_id').notNull(),
  financialTransactionId: uuid('financial_transaction_id')
    .notNull()
    .references(() => financialTransactions.id),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const financialTransactions = finSchema.table('financial_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => financialAccounts.id),
  direction: financialDirectionEnum('direction').notNull(),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  currencyCode: text('currency_code').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  status: financialTransactionStatusEnum('status').notNull().default('POSTED'),
  idempotencyKey: text('idempotency_key').notNull(),
  reference: text('reference').notNull(),
  originKind: treasuryOriginKindEnum('origin_kind').notNull(),
  originId: uuid('origin_id').notNull(),
  originReference: text('origin_reference').notNull(),
  transferId: uuid('transfer_id').references(() => treasuryTransfers.id),
  reversesTransactionId: uuid('reverses_transaction_id'),
  actorIdentityId: uuid('actor_identity_id')
    .notNull()
    .references(() => identities.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const budgetStatusEnum = finSchema.enum('budget_status', ['ACTIVE', 'INACTIVE']);
export const budgetVersionStatusEnum = finSchema.enum('budget_version_status', ['DRAFT', 'APPROVED']);
export const budgetPeriodStatusEnum = finSchema.enum('budget_period_status', ['OPEN', 'CLOSED']);

export const budgets = finSchema.table('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: text('unit_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  currencyCode: text('currency_code').notNull(),
  status: budgetStatusEnum('status').notNull().default('ACTIVE'),
  rowVersion: integer('row_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
  updatedByIdentityId: uuid('updated_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const budgetVersions = finSchema.table('budget_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  budgetId: uuid('budget_id')
    .notNull()
    .references(() => budgets.id),
  versionNumber: integer('version_number').notNull(),
  status: budgetVersionStatusEnum('status').notNull().default('DRAFT'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedByIdentityId: uuid('approved_by_identity_id').references(() => identities.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const budgetPeriods = finSchema.table('budget_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  budgetVersionId: uuid('budget_version_id')
    .notNull()
    .references(() => budgetVersions.id),
  periodKey: text('period_key').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  status: budgetPeriodStatusEnum('status').notNull().default('OPEN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const budgetLines = finSchema.table('budget_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  budgetPeriodId: uuid('budget_period_id')
    .notNull()
    .references(() => budgetPeriods.id),
  lineNumber: integer('line_number').notNull(),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  currencyCode: text('currency_code').notNull(),
  costCenterCode: text('cost_center_code'),
  expenseCategoryId: uuid('expense_category_id').references(() => expenseCategories.id),
  accountId: uuid('account_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const expenseStatusEnum = finSchema.enum('expense_status', [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
]);

export const expenseApprovalDecisionEnum = finSchema.enum('expense_approval_decision', [
  'APPROVED',
  'REJECTED',
]);

export const expenses = finSchema.table('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: text('unit_id').notNull(),
  requesterIdentityId: uuid('requester_identity_id')
    .notNull()
    .references(() => identities.id),
  expenseCategoryId: uuid('expense_category_id')
    .notNull()
    .references(() => expenseCategories.id),
  costCenterId: uuid('cost_center_id').notNull(),
  costCenterCode: text('cost_center_code').notNull(),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).notNull(),
  currencyCode: text('currency_code').notNull().default('BRL'),
  dueDate: date('due_date').notNull(),
  paymentTerms: text('payment_terms').notNull(),
  description: text('description').notNull(),
  receiptDocumentId: uuid('receipt_document_id'),
  reimbursable: boolean('reimbursable').notNull().default(true),
  status: expenseStatusEnum('status').notNull().default('DRAFT'),
  version: integer('version').notNull().default(1),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdByIdentityId: uuid('created_by_identity_id')
    .notNull()
    .references(() => identities.id),
  updatedByIdentityId: uuid('updated_by_identity_id')
    .notNull()
    .references(() => identities.id),
});

export const expenseItems = finSchema.table('expense_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id')
    .notNull()
    .references(() => expenses.id),
  lineNumber: integer('line_number').notNull(),
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
});

export const expenseApprovals = finSchema.table('expense_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id')
    .notNull()
    .references(() => expenses.id),
  decision: expenseApprovalDecisionEnum('decision').notNull(),
  actorIdentityId: uuid('actor_identity_id')
    .notNull()
    .references(() => identities.id),
  approvalRuleId: uuid('approval_rule_id'),
  reason: text('reason'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export const expenseReimbursements = finSchema.table('expense_reimbursements', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id')
    .notNull()
    .references(() => expenses.id),
  payableId: uuid('payable_id')
    .notNull()
    .references(() => payables.id),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  currencyCode: text('currency_code').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const collectionCaseStatusEnum = finSchema.enum('collection_case_status', ['OPEN', 'CLOSED']);

export const collectionActionKindEnum = finSchema.enum('collection_action_kind', [
  'CONTACT',
  'NOTICE',
  'PROMISE_TO_PAY',
  'RENEGOTIATION',
]);

export const collectionPromiseStatusEnum = finSchema.enum('collection_promise_status', [
  'OPEN',
  'KEPT',
  'BROKEN',
]);

export const receivableCollections = finSchema.table('receivable_collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  receivableId: uuid('receivable_id')
    .notNull()
    .references(() => receivables.id),
  unitId: text('unit_id').notNull(),
  clientId: uuid('client_id').notNull(),
  status: collectionCaseStatusEnum('status').notNull().default('OPEN'),
  openedBecauseOverdue: boolean('opened_because_overdue').notNull().default(true),
  promisedDueDate: date('promised_due_date'),
  version: integer('version').notNull().default(1),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  openedByIdentityId: uuid('opened_by_identity_id')
    .notNull()
    .references(() => identities.id),
  closedByIdentityId: uuid('closed_by_identity_id').references(() => identities.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const collectionActions = finSchema.table('collection_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => receivableCollections.id),
  kind: collectionActionKindEnum('kind').notNull(),
  notes: text('notes'),
  actorIdentityId: uuid('actor_identity_id')
    .notNull()
    .references(() => identities.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  idempotencyKey: text('idempotency_key').notNull(),
});

export const collectionPromises = finSchema.table('collection_promises', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => receivableCollections.id),
  actionId: uuid('action_id')
    .notNull()
    .references(() => collectionActions.id),
  promisedAmount: numeric('promised_amount', { precision: 18, scale: 4 }).notNull(),
  promisedOn: date('promised_on').notNull(),
  status: collectionPromiseStatusEnum('status').notNull().default('OPEN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const collectionHistory = finSchema.table('collection_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => receivableCollections.id),
  eventKind: text('event_kind').notNull(),
  payload: jsonb('payload').notNull(),
  actorIdentityId: uuid('actor_identity_id')
    .notNull()
    .references(() => identities.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

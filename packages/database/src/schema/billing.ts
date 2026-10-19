import { integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { proposals } from './commercial-proposals';
import { purchaseOrders } from './commercial-purchase-orders';
import { clients } from './clients';
import { identities } from './identity';
import { measurementItems, measurements } from './measurements';
import { executionEntries } from './service-order-execution';
import { serviceOrders } from './service-orders';

export const bilSchema = pgSchema('bil');

export const billingRecordStatusEnum = bilSchema.enum('billing_record_status', ['PREPARED', 'VOIDED']);

export const paymentTermsSourceEnum = bilSchema.enum('payment_terms_source', [
  'PURCHASE_ORDER',
  'PROPOSAL_SNAPSHOT',
  'CONTRACT_SNAPSHOT',
  'DECLARED',
]);

export const billingRecords = bilSchema.table('billing_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceOrderId: uuid('service_order_id')
    .notNull()
    .references(() => serviceOrders.id),
  measurementId: uuid('measurement_id').references(() => measurements.id),
  entitlementPolicy: text('entitlement_policy').notNull().default('MEASUREMENT_APPROVED'),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id),
  unitId: text('unit_id').notNull(),
  status: billingRecordStatusEnum('status').notNull().default('PREPARED'),
  proposalId: uuid('proposal_id').references(() => proposals.id),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
  contractReference: text('contract_reference'),
  clientLegalNameSnapshot: text('client_legal_name_snapshot').notNull(),
  clientTaxIdSnapshot: text('client_tax_id_snapshot'),
  billingAddressSnapshot: jsonb('billing_address_snapshot').notNull().default({}),
  commercialReferenceSnapshot: jsonb('commercial_reference_snapshot').notNull().default({}),
  currencyCode: text('currency_code').notNull().default('BRL'),
  paymentTerms: text('payment_terms').notNull(),
  paymentTermsSource: paymentTermsSourceEnum('payment_terms_source').notNull(),
  paymentTermsAuthoritative: text('payment_terms_authoritative'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).notNull(),
  preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull().defaultNow(),
  preparedByIdentityId: uuid('prepared_by_identity_id')
    .notNull()
    .references(() => identities.id),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedByIdentityId: uuid('voided_by_identity_id').references(() => identities.id),
  voidReason: text('void_reason'),
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

export const billingItems = bilSchema.table('billing_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  billingRecordId: uuid('billing_record_id')
    .notNull()
    .references(() => billingRecords.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),
  measurementItemId: uuid('measurement_item_id').references(() => measurementItems.id),
  sourceExecutionEntryId: uuid('source_execution_entry_id').references(() => executionEntries.id),
  unitCode: text('unit_code').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 6 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }),
  lineAmount: numeric('line_amount', { precision: 18, scale: 4 }).notNull(),
  pricingLineSnapshot: jsonb('pricing_line_snapshot').notNull().default({}),
  lineLabel: text('line_label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const billingHistoryEvents = bilSchema.table('billing_history_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  billingRecordId: uuid('billing_record_id')
    .notNull()
    .references(() => billingRecords.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  actorIdentityId: uuid('actor_identity_id').references(() => identities.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export const billingCommandIdempotency = bilSchema.table('billing_command_idempotency', {
  id: uuid('id').primaryKey().defaultRandom(),
  billingRecordId: uuid('billing_record_id').references(() => billingRecords.id, { onDelete: 'cascade' }),
  serviceOrderId: uuid('service_order_id')
    .notNull()
    .references(() => serviceOrders.id),
  commandName: text('command_name').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  responsePayload: jsonb('response_payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const billingDocumentStatusEnum = bilSchema.enum('billing_document_status', [
  'FINALIZED',
  'CANCELLED',
]);

export const billingDocumentNumberSequences = bilSchema.table('billing_document_number_sequences', {
  sequenceYear: integer('sequence_year').primaryKey(),
  nextNumber: integer('next_number').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const billingDocuments = bilSchema.table('billing_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  billingRecordId: uuid('billing_record_id')
    .notNull()
    .references(() => billingRecords.id),
  serviceOrderId: uuid('service_order_id')
    .notNull()
    .references(() => serviceOrders.id),
  measurementId: uuid('measurement_id')
    .notNull()
    .references(() => measurements.id),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id),
  unitId: text('unit_id').notNull(),
  documentNumber: text('document_number').notNull(),
  sequenceYear: integer('sequence_year').notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
  versionNumber: integer('version_number').notNull().default(1),
  replacesDocumentId: uuid('replaces_document_id'),
  status: billingDocumentStatusEnum('status').notNull().default('FINALIZED'),
  documentCategory: text('document_category').notNull().default('NOTA_FATURA'),
  emitterLegalName: text('emitter_legal_name').notNull(),
  emitterTaxId: text('emitter_tax_id').notNull(),
  emitterAddressSnapshot: jsonb('emitter_address_snapshot').notNull().default({}),
  clientLegalNameSnapshot: text('client_legal_name_snapshot').notNull(),
  clientTaxIdSnapshot: text('client_tax_id_snapshot'),
  billingAddressSnapshot: jsonb('billing_address_snapshot').notNull().default({}),
  commercialReferenceSnapshot: jsonb('commercial_reference_snapshot').notNull().default({}),
  proposalId: uuid('proposal_id').references(() => proposals.id),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
  purchaseOrderNumberSnapshot: text('purchase_order_number_snapshot'),
  /*
    PEDIDO DE COMPRA DO CLIENTE no instante da emissão.

    Deliberadamente SEPARADO de `purchase_order_number_snapshot` acima: aquele é a compra que a
    CISNE fez de um fornecedor, este é o pedido que o cliente fez à CISNE. Os dois podem coexistir
    na mesma cobrança e significam coisas opostas — juntá-los faria o número de um aparecer como se
    fosse o do outro, e é justamente este que precisa constar no documento fiscal quando o cliente
    o exige.
  */
  customerPurchaseOrderNumberSnapshot: text('customer_purchase_order_number_snapshot'),
  contractReference: text('contract_reference'),
  currencyCode: text('currency_code').notNull().default('BRL'),
  paymentTerms: text('payment_terms').notNull(),
  dueDate: text('due_date'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  storedDocumentId: uuid('stored_document_id'),
  artifactSha256: text('artifact_sha256'),
  artifactByteSize: integer('artifact_byte_size'),
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

export const billingDocumentItems = bilSchema.table('billing_document_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  billingDocumentId: uuid('billing_document_id')
    .notNull()
    .references(() => billingDocuments.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),
  billingItemId: uuid('billing_item_id').references(() => billingItems.id),
  measurementItemId: uuid('measurement_item_id').references(() => measurementItems.id),
  unitCode: text('unit_code').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 6 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }),
  lineAmount: numeric('line_amount', { precision: 18, scale: 4 }).notNull(),
  lineLabel: text('line_label').notNull(),
  pricingLineSnapshot: jsonb('pricing_line_snapshot').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const billingDocumentHistoryEvents = bilSchema.table('billing_document_history_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  billingDocumentId: uuid('billing_document_id')
    .notNull()
    .references(() => billingDocuments.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  actorIdentityId: uuid('actor_identity_id').references(() => identities.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export const billingDocumentCommandIdempotency = bilSchema.table('billing_document_command_idempotency', {
  id: uuid('id').primaryKey().defaultRandom(),
  billingDocumentId: uuid('billing_document_id').references(() => billingDocuments.id, {
    onDelete: 'cascade',
  }),
  billingRecordId: uuid('billing_record_id')
    .notNull()
    .references(() => billingRecords.id),
  commandName: text('command_name').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  responsePayload: jsonb('response_payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

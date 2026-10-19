import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { proposals } from './commercial-proposals';
import { purchaseOrders } from './commercial-purchase-orders';
import { serviceDefinitions, serviceDefinitionVersions } from './service-catalog';
import { clients } from './clients';
import { identities } from './identity';
import { serviceRequests } from './service-requests';

export const soSchema = pgSchema('so');

export const serviceOrderStatusEnum = soSchema.enum('service_order_status', [
  'DRAFT',
  'PREPARED',
  'RELEASED',
  'IN_EXECUTION',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
]);

export const serviceOrderOriginEnum = soSchema.enum('service_order_origin', [
  'SERVICE_REQUEST',
  'PROPOSAL',
  'PURCHASE_ORDER',
  'AUTHORIZED_DIRECT',
]);

export const serviceOrders = soSchema.table(
  'service_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    internalCode: text('internal_code').notNull(),
    orderNumber: text('order_number').notNull(),
    unitId: text('unit_id').notNull(),
    status: serviceOrderStatusEnum('status').notNull().default('DRAFT'),
    origin: serviceOrderOriginEnum('origin').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }),
    clientSnapshot: jsonb('client_snapshot'),
    serviceDefinitionId: uuid('service_definition_id').references(() => serviceDefinitions.id, {
      onDelete: 'restrict',
    }),
    serviceDefinitionVersionId: uuid('service_definition_version_id').references(
      () => serviceDefinitionVersions.id,
      { onDelete: 'restrict' },
    ),
    serviceSnapshot: jsonb('service_snapshot').notNull().default({}),
    description: text('description'),
    location: jsonb('location').notNull().default({}),
    priority: text('priority'),
    operationalNotes: text('operational_notes'),
    serviceRequestId: uuid('service_request_id').references(() => serviceRequests.id, {
      onDelete: 'restrict',
    }),
    proposalId: uuid('proposal_id').references(() => proposals.id, { onDelete: 'restrict' }),
    proposalSnapshot: jsonb('proposal_snapshot'),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, {
      onDelete: 'restrict',
    }),
    purchaseOrderSnapshot: jsonb('purchase_order_snapshot'),
    /*
      PEDIDO DE COMPRA DO CLIENTE — o outro lado da relação.

      `purchase_order_id` acima é o Purchase Order INTERNO: a compra que a CISNE faz de um
      fornecedor. Este campo é o documento oposto — o pedido que o CLIENTE emite contra a CISNE,
      onde a CISNE é FORNECEDORA (ex.: pedido 41926266 da AMAGGI).

      Opcional e sem unicidade global de propósito: nem toda OS nasce de pedido do cliente, e
      clientes diferentes podem usar o mesmo número.
    */
    customerPurchaseOrderNumber: text('customer_purchase_order_number'),
    rcNumber: text('rc_number'),
    contractReference: text('contract_reference'),
    contractSnapshot: jsonb('contract_snapshot'),
    preparedAt: timestamp('prepared_at', { withTimezone: true, mode: 'string' }),
    preparedByIdentityId: uuid('prepared_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    releasedAt: timestamp('released_at', { withTimezone: true, mode: 'string' }),
    releasedByIdentityId: uuid('released_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
    cancelledByIdentityId: uuid('cancelled_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    cancellationReason: text('cancellation_reason'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    startedByIdentityId: uuid('started_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    pausedAt: timestamp('paused_at', { withTimezone: true, mode: 'string' }),
    pausedByIdentityId: uuid('paused_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    completedByIdentityId: uuid('completed_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    statusBeforeCancel: serviceOrderStatusEnum('status_before_cancel'),
    reopenedAt: timestamp('reopened_at', { withTimezone: true, mode: 'string' }),
    reopenedByIdentityId: uuid('reopened_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    reopenReason: text('reopen_reason'),
    statusBeforeReopen: serviceOrderStatusEnum('status_before_reopen'),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    createdByIdentityId: uuid('created_by_identity_id')
      .notNull()
      .references(() => identities.id, { onDelete: 'restrict' }),
    updatedByIdentityId: uuid('updated_by_identity_id')
      .notNull()
      .references(() => identities.id, { onDelete: 'restrict' }),
  },
  (table) => [
    uniqueIndex('service_orders_internal_code_uidx').on(table.internalCode),
    uniqueIndex('service_orders_order_number_uidx').on(table.orderNumber),
    index('service_orders_service_request_id_idx').on(table.serviceRequestId),
    index('service_orders_status_idx').on(table.status),
    index('service_orders_unit_id_idx').on(table.unitId),
    index('service_orders_client_id_idx').on(table.clientId),
    check(
      'service_orders_internal_code_not_empty_chk',
      sql`length(trim(${table.internalCode})) > 0`,
    ),
    check('service_orders_order_number_not_empty_chk', sql`length(trim(${table.orderNumber})) > 0`),
    check('service_orders_unit_id_not_empty_chk', sql`length(trim(${table.unitId})) > 0`),
    check('service_orders_row_version_positive_chk', sql`${table.rowVersion} >= 1`),
  ],
);

export const serviceOrderHistoryEvents = soSchema.table(
  'service_order_history_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceOrderId: uuid('service_order_id')
      .notNull()
      .references(() => serviceOrders.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    actorIdentityId: uuid('actor_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('service_order_history_events_service_order_id_idx').on(
      table.serviceOrderId,
      table.occurredAt,
    ),
    check(
      'service_order_history_events_event_type_not_empty_chk',
      sql`length(trim(${table.eventType})) > 0`,
    ),
  ],
);

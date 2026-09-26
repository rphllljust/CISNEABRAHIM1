import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { physicalAssets } from './physical-assets';
import { identities } from './identity';
import { serviceOrders, soSchema } from './service-orders';
import { workforceMembers } from './workforce';

export const resSchema = pgSchema('res');

export const plannedResourceKindEnum = soSchema.enum('planned_resource_kind', [
  'PHYSICAL_RESOURCE',
  'LABOR',
]);

export const plannedResourceStatusEnum = soSchema.enum('planned_resource_status', [
  'PLANNED',
  'REMOVED',
]);

export const resourceAllocationStatusEnum = resSchema.enum('resource_allocation_status', [
  'ACTIVE',
  'REALLOCATED',
  'REMOVED',
]);

export const plannedResources = soSchema.table(
  'planned_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceOrderId: uuid('service_order_id')
      .notNull()
      .references(() => serviceOrders.id, { onDelete: 'restrict' }),
    requirementKind: plannedResourceKindEnum('requirement_kind').notNull(),
    resourceTypeCode: text('resource_type_code'),
    laborTypeCode: text('labor_type_code'),
    plannedQuantity: numeric('planned_quantity', { precision: 12, scale: 4 }).notNull(),
    operationalStart: timestamp('operational_start', { withTimezone: true, mode: 'string' }),
    operationalEnd: timestamp('operational_end', { withTimezone: true, mode: 'string' }),
    notes: text('notes'),
    status: plannedResourceStatusEnum('status').notNull().default('PLANNED'),
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
    index('planned_resources_service_order_id_idx').on(table.serviceOrderId),
    check('planned_resources_planned_quantity_positive_chk', sql`${table.plannedQuantity} > 0`),
    check('planned_resources_row_version_positive_chk', sql`${table.rowVersion} >= 1`),
  ],
);

export const resourceAllocations = resSchema.table(
  'resource_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceOrderId: uuid('service_order_id')
      .notNull()
      .references(() => serviceOrders.id, { onDelete: 'restrict' }),
    plannedResourceId: uuid('planned_resource_id').references(() => plannedResources.id, {
      onDelete: 'restrict',
    }),
    physicalAssetId: uuid('physical_asset_id').references(() => physicalAssets.id, {
      onDelete: 'restrict',
    }),
    workforceMemberId: uuid('workforce_member_id').references(() => workforceMembers.id, {
      onDelete: 'restrict',
    }),
    resourceTypeCode: text('resource_type_code').notNull(),
    operationalStart: timestamp('operational_start', { withTimezone: true, mode: 'string' }).notNull(),
    operationalEnd: timestamp('operational_end', { withTimezone: true, mode: 'string' }).notNull(),
    status: resourceAllocationStatusEnum('status').notNull().default('ACTIVE'),
    rowVersion: integer('row_version').notNull().default(1),
    allocatedAt: timestamp('allocated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    allocatedByIdentityId: uuid('allocated_by_identity_id')
      .notNull()
      .references(() => identities.id, { onDelete: 'restrict' }),
    removedAt: timestamp('removed_at', { withTimezone: true, mode: 'string' }),
    removedByIdentityId: uuid('removed_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    reallocatedToAllocationId: uuid('reallocated_to_allocation_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (table) => [
    index('resource_allocations_service_order_id_idx').on(table.serviceOrderId),
    index('resource_allocations_physical_asset_id_idx').on(table.physicalAssetId),
    index('resource_allocations_workforce_member_id_idx').on(table.workforceMemberId),
    check(
      'resource_allocations_exactly_one_resource_chk',
      sql`((${table.physicalAssetId} IS NOT NULL)::int + (${table.workforceMemberId} IS NOT NULL)::int) = 1`,
    ),
    check(
      'resource_allocations_operational_window_chk',
      sql`${table.operationalStart} < ${table.operationalEnd}`,
    ),
    check(
      'resource_allocations_resource_type_code_not_empty_chk',
      sql`length(trim(${table.resourceTypeCode})) > 0`,
    ),
    check('resource_allocations_row_version_positive_chk', sql`${table.rowVersion} >= 1`),
  ],
);

export const resourceAllocationHistoryEvents = resSchema.table(
  'resource_allocation_history_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceAllocationId: uuid('resource_allocation_id')
      .notNull()
      .references(() => resourceAllocations.id, { onDelete: 'restrict' }),
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
    index('resource_allocation_history_events_allocation_id_idx').on(
      table.resourceAllocationId,
      table.occurredAt,
    ),
    check(
      'resource_allocation_history_events_event_type_not_empty_chk',
      sql`length(trim(${table.eventType})) > 0`,
    ),
  ],
);

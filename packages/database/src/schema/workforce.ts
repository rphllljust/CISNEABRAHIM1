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
import { operationalLaborTypes } from './service-catalog';
import { identities } from './identity';

/**
 * Cadastro de pessoa executora operacional (TERM-006 — candidato de domínio).
 * Distinto de identity.identities (usuário do sistema) e de cat.operational_labor_types (função/tipo).
 */
export const wrkSchema = pgSchema('wrk');

export const workforceMemberStatusEnum = wrkSchema.enum('workforce_member_status', [
  'ACTIVE',
  'INACTIVE',
]);

export const workforceMembers = wrkSchema.table(
  'workforce_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberCode: text('member_code').notNull(),
    legalName: text('legal_name').notNull(),
    preferredName: text('preferred_name'),
    defaultLaborTypeCode: text('default_labor_type_code').references(
      () => operationalLaborTypes.code,
      { onDelete: 'restrict', onUpdate: 'cascade' },
    ),
    externalErpId: text('external_erp_id'),
    identityId: uuid('identity_id').references(() => identities.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    status: workforceMemberStatusEnum('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'string' }),
    deactivatedByIdentityId: uuid('deactivated_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    deactivationReason: text('deactivation_reason'),
  },
  (table) => [
    check('workforce_members_legal_name_not_empty_chk', sql`length(trim(${table.legalName})) > 0`),
    check(
      'workforce_members_member_code_not_empty_chk',
      sql`length(trim(${table.memberCode})) > 0`,
    ),
    check('workforce_members_version_positive_chk', sql`${table.version} >= 1`),
    uniqueIndex('workforce_members_member_code_uidx').on(table.memberCode),
    uniqueIndex('workforce_members_external_erp_id_uidx')
      .on(table.externalErpId)
      .where(sql`${table.externalErpId} IS NOT NULL`),
    uniqueIndex('workforce_members_identity_id_uidx')
      .on(table.identityId)
      .where(sql`${table.identityId} IS NOT NULL`),
    index('workforce_members_status_created_at_idx').on(table.status, table.createdAt),
    index('workforce_members_default_labor_type_code_idx').on(table.defaultLaborTypeCode),
  ],
);

export const workforceMemberHistoryEvents = wrkSchema.table(
  'workforce_member_history_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workforceMemberId: uuid('workforce_member_id')
      .notNull()
      .references(() => workforceMembers.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    actorIdentityId: uuid('actor_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('workforce_member_history_events_member_id_idx').on(
      table.workforceMemberId,
      table.occurredAt,
    ),
  ],
);

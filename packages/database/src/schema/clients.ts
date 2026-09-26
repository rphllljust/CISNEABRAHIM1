import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { identities } from './identity';

/**
 * Cadastro de clientes PJ (Prompt 29 — SRC-002 aprovado).
 * Schema `pty` alinhado a TBL-CAND-021 (party).
 */
export const ptySchema = pgSchema('pty');

export const clientStatusEnum = ptySchema.enum('client_status', ['ACTIVE', 'INACTIVE']);

export const purchaseOrderRequirementEnum = ptySchema.enum('purchase_order_requirement', [
  'NOT_REQUIRED',
  'BEFORE_EXECUTION',
  'BEFORE_BILLING',
]);

export const contactPurposeEnum = ptySchema.enum('contact_purpose', [
  'operational',
  'commercial',
  'billing',
]);

export const addressPurposeEnum = ptySchema.enum('address_purpose', [
  'operational',
  'billing',
  'correspondence',
]);

export const clients = ptySchema.table(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    normalizedTaxId: text('normalized_tax_id').notNull(),
    externalErpId: text('external_erp_id'),
    status: clientStatusEnum('status').notNull().default('ACTIVE'),
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
    purchaseOrderRequirement: purchaseOrderRequirementEnum('purchase_order_requirement')
      .notNull()
      .default('NOT_REQUIRED'),
  },
  (table) => [
    check('clients_legal_name_not_empty_chk', sql`length(trim(${table.legalName})) > 0`),
    check(
      'clients_normalized_tax_id_digits_chk',
      sql`${table.normalizedTaxId} ~ '^[0-9]{14}$'`,
    ),
    check('clients_version_positive_chk', sql`${table.version} >= 1`),
    uniqueIndex('clients_normalized_tax_id_uidx').on(table.normalizedTaxId),
    index('clients_status_created_at_idx').on(table.status, table.createdAt),
    // Índices de listagem do master data (migration 0079). A ordem padrão da listagem é razão
    // social ascendente; sem estes índices a listagem padrão fazia varredura completa + ordenação
    // de toda a tabela. Cada um foi autorizado por EXPLAIN contra 50 mil Clientes reais em banco
    // descartável — o índice `(status, legal_name, id)` foi medido e REJEITADO por ser mais lento
    // que `(legal_name, id)` sozinho.
    index('clients_legal_name_id_idx').on(table.legalName, table.id),
    index('clients_updated_at_id_idx').on(table.updatedAt, table.id),
    // `text_pattern_ops` porque a colação do banco é `en_US.utf8`: sob colação linguística o btree
    // padrão não serve `LIKE 'prefixo%'`, que é como se busca CNPJ parcial.
    index('clients_normalized_tax_id_pattern_idx').using(
      'btree',
      table.normalizedTaxId.op('text_pattern_ops'),
    ),
  ],
);

export const clientContacts = ptySchema.table(
  'client_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    purpose: contactPurposeEnum('purpose').notNull(),
    email: text('email'),
    phone: text('phone'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('client_contacts_name_not_empty_chk', sql`length(trim(${table.name})) > 0`),
    index('client_contacts_client_id_idx').on(table.clientId),
  ],
);

export const clientAddresses = ptySchema.table(
  'client_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    purpose: addressPurposeEnum('purpose').notNull(),
    street: text('street'),
    number: text('number'),
    complement: text('complement'),
    district: text('district'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('client_addresses_client_id_idx').on(table.clientId)],
);

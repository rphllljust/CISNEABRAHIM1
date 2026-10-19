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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { serviceDefinitions, serviceDefinitionVersions } from './service-catalog';
import { clientContacts, clients } from './clients';
import { documents } from './documents';
import { identities } from './identity';

export const comSchema = pgSchema('com');

export const proposalVersionStatusEnum = comSchema.enum('proposal_version_status', [
  'DRAFT',
  'ISSUED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
]);

export const proposalPricingStructureEnum = comSchema.enum('proposal_pricing_structure', [
  'GLOBAL_PRICE',
  'ITEMIZED',
]);

export const proposalItemKindEnum = comSchema.enum('proposal_item_kind', [
  'SERVICE',
  'MATERIAL',
  'LABOR',
  'EQUIPMENT',
  'TRANSPORT',
  'OTHER',
]);

export const proposals = comSchema.table(
  'proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalCode: text('proposal_code').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    /*
      CONTATO DO CLIENTE PARA ESTA PROPOSTA — referência ao cadastro, nunca cópia de nome.

      O documento comercial nomeia com quem se fala (`A/C: Sr. Josivan`). O CISNE já tem esse dado
      como ENTIDADE (`pty.client_contacts`, com `purpose` e `role`); copiar o nome para uma coluna
      de texto criaria uma segunda fonte para o mesmo fato, que envelhece em silêncio quando o
      contato muda de nome, e-mail ou papel.

      Opcional de propósito: nem toda proposta nomeia um contato, e exigir um obrigaria a inventar
      vínculo. `ON DELETE SET NULL` porque remover o contato do cadastro não deve impedir a
      proposta de existir — ela perde a referência, não a história.
    */
    contactId: uuid('contact_id').references(() => clientContacts.id, {
      onDelete: 'set null',
    }),
    unitId: text('unit_id').notNull(),
    title: text('title').notNull(),
    currentVersionNumber: integer('current_version_number'),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByIdentityId: uuid('created_by_identity_id')
      .notNull()
      .references(() => identities.id, { onDelete: 'restrict' }),
    updatedByIdentityId: uuid('updated_by_identity_id')
      .notNull()
      .references(() => identities.id, { onDelete: 'restrict' }),
  },
  (table) => [
    uniqueIndex('proposals_proposal_code_uidx').on(table.proposalCode),
    index('proposals_client_id_idx').on(table.clientId),
    index('proposals_contact_id_idx').on(table.contactId),
    index('proposals_unit_id_idx').on(table.unitId),
    check('proposals_proposal_code_not_empty_chk', sql`length(trim(${table.proposalCode})) > 0`),
    check('proposals_title_not_empty_chk', sql`length(trim(${table.title})) > 0`),
    check('proposals_unit_id_not_empty_chk', sql`length(trim(${table.unitId})) > 0`),
    check('proposals_row_version_positive_chk', sql`${table.rowVersion} >= 1`),
    check(
      'proposals_current_version_positive_chk',
      sql`${table.currentVersionNumber} IS NULL OR ${table.currentVersionNumber} >= 1`,
    ),
  ],
);

export const proposalVersions = comSchema.table(
  'proposal_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    status: proposalVersionStatusEnum('status').notNull().default('DRAFT'),
    pricingStructure: proposalPricingStructureEnum('pricing_structure').notNull(),
    currencyCode: text('currency_code').notNull().default('BRL'),
    globalSalePriceAmount: numeric('global_sale_price_amount', { precision: 18, scale: 4 }),
    globalInternalCostAmount: numeric('global_internal_cost_amount', { precision: 18, scale: 4 }),
    itemsSaleTotalAmount: numeric('items_sale_total_amount', { precision: 18, scale: 4 }),
    itemsInternalCostTotalAmount: numeric('items_internal_cost_total_amount', {
      precision: 18,
      scale: 4,
    }),
    commercialTerms: jsonb('commercial_terms').notNull().default({}),
    clientSnapshot: jsonb('client_snapshot'),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    notes: text('notes'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedByIdentityId: uuid('issued_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByIdentityId: uuid('accepted_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    acceptanceOriginCode: text('acceptance_origin_code'),
    acceptanceEvidenceDocumentId: uuid('acceptance_evidence_document_id').references(
      () => documents.id,
      { onDelete: 'restrict' },
    ),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedByIdentityId: uuid('rejected_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    rejectionReason: text('rejection_reason'),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByIdentityId: uuid('cancelled_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
    }),
    cancellationReason: text('cancellation_reason'),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('proposal_versions_proposal_version_uidx').on(
      table.proposalId,
      table.versionNumber,
    ),
    index('proposal_versions_status_idx').on(table.status),
    check('proposal_versions_version_positive_chk', sql`${table.versionNumber} >= 1`),
    check('proposal_versions_row_version_positive_chk', sql`${table.rowVersion} >= 1`),
    check(
      'proposal_versions_currency_code_chk',
      sql`length(trim(${table.currencyCode})) = 3`,
    ),
  ],
);

export const proposalItems = comSchema.table(
  'proposal_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalVersionId: uuid('proposal_version_id')
      .notNull()
      .references(() => proposalVersions.id, { onDelete: 'restrict' }),
    lineNumber: integer('line_number').notNull(),
    itemKind: proposalItemKindEnum('item_kind').notNull().default('OTHER'),
    description: text('description').notNull(),
    serviceDefinitionId: uuid('service_definition_id').references(() => serviceDefinitions.id, {
      onDelete: 'restrict',
    }),
    serviceDefinitionVersionId: uuid('service_definition_version_id').references(
      () => serviceDefinitionVersions.id,
      { onDelete: 'restrict' },
    ),
    serviceSnapshot: jsonb('service_snapshot'),
    commercialSnapshot: jsonb('commercial_snapshot'),
    quantity: numeric('quantity', { precision: 18, scale: 4 }),
    unitCode: text('unit_code'),
    /*
      REFERENCIA EXTERNA DO CLIENTE — como ELE identifica o item.

      unit_code acima e a unidade INTERNA do Catalogo (DAY). customer_unit_code e a unidade
      NA ORIGEM do documento do cliente (UA). Nao sao intercambiaveis: sem mapeamento declarado,
      traduzir uma na outra seria inventar equivalencia.
    */
    customerItemReference: text('customer_item_reference'),
    customerUnitCode: text('customer_unit_code'),
    unitSalePriceAmount: numeric('unit_sale_price_amount', { precision: 18, scale: 4 }),
    unitInternalCostAmount: numeric('unit_internal_cost_amount', { precision: 18, scale: 4 }),
    lineSaleAmount: numeric('line_sale_amount', { precision: 18, scale: 4 }),
    lineInternalCostAmount: numeric('line_internal_cost_amount', { precision: 18, scale: 4 }),
  },
  (table) => [
    uniqueIndex('proposal_items_version_line_uidx').on(table.proposalVersionId, table.lineNumber),
    check('proposal_items_line_number_positive_chk', sql`${table.lineNumber} >= 1`),
    check(
      'proposal_items_description_not_empty_chk',
      sql`length(trim(${table.description})) > 0`,
    ),
  ],
);

export const proposalDocumentLinks = comSchema.table(
  'proposal_document_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalVersionId: uuid('proposal_version_id')
      .notNull()
      .references(() => proposalVersions.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    linkPurpose: text('link_purpose').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByIdentityId: uuid('created_by_identity_id')
      .notNull()
      .references(() => identities.id, { onDelete: 'restrict' }),
  },
  (table) => [
    uniqueIndex('proposal_document_links_version_document_purpose_uidx').on(
      table.proposalVersionId,
      table.documentId,
      table.linkPurpose,
    ),
    check(
      'proposal_document_links_purpose_not_empty_chk',
      sql`length(trim(${table.linkPurpose})) > 0`,
    ),
  ],
);

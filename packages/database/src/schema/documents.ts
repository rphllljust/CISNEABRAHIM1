import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  primaryKey,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { identities } from './identity';
import { physicalAssets } from './physical-assets';

export const docSchema = pgSchema('doc');

export const documentStatusEnum = docSchema.enum('document_status', ['ACTIVE', 'ARCHIVED']);

export const storedObjects = docSchema.table(
  'stored_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storageKey: text('storage_key').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    originalFilename: text('original_filename').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('stored_objects_storage_key_uidx').on(table.storageKey),
    index('stored_objects_sha256_hash_idx').on(table.sha256Hash),
    check('stored_objects_storage_key_not_empty_chk', sql`length(trim(${table.storageKey})) > 0`),
    check('stored_objects_sha256_not_empty_chk', sql`length(trim(${table.sha256Hash})) > 0`),
    check('stored_objects_mime_type_not_empty_chk', sql`length(trim(${table.mimeType})) > 0`),
    check(
      'stored_objects_original_filename_not_empty_chk',
      sql`length(trim(${table.originalFilename})) > 0`,
    ),
    check('stored_objects_byte_size_positive_chk', sql`${table.byteSize} > 0`),
  ],
);

export const documents = docSchema.table(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    categoryCode: text('category_code').notNull(),
    classificationCode: text('classification_code').notNull().default('INTERNAL'),
    status: documentStatusEnum('status').notNull().default('ACTIVE'),
    unitId: text('unit_id').notNull(),
    currentVersionNumber: integer('current_version_number'),
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
    index('documents_unit_id_idx').on(table.unitId),
    index('documents_status_idx').on(table.status),
    index('documents_category_code_idx').on(table.categoryCode),
    check('documents_title_not_empty_chk', sql`length(trim(${table.title})) > 0`),
    check('documents_category_code_not_empty_chk', sql`length(trim(${table.categoryCode})) > 0`),
    check(
      'documents_classification_code_not_empty_chk',
      sql`length(trim(${table.classificationCode})) > 0`,
    ),
    check('documents_unit_id_not_empty_chk', sql`length(trim(${table.unitId})) > 0`),
    check(
      'documents_current_version_positive_chk',
      sql`${table.currentVersionNumber} IS NULL OR ${table.currentVersionNumber} >= 1`,
    ),
  ],
);

export const documentVersions = docSchema.table(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    storedObjectId: uuid('stored_object_id')
      .notNull()
      .references(() => storedObjects.id, { onDelete: 'restrict' }),
    uploadedByIdentityId: uuid('uploaded_by_identity_id')
      .notNull()
      .references(() => identities.id, { onDelete: 'restrict' }),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('document_versions_document_version_uidx').on(
      table.documentId,
      table.versionNumber,
    ),
    index('document_versions_document_id_idx').on(table.documentId),
    index('document_versions_stored_object_id_idx').on(table.storedObjectId),
    check('document_versions_version_positive_chk', sql`${table.versionNumber} >= 1`),
  ],
);

/**
 * GED-owned association to the existing asset master. Vehicle profiles are 1:1
 * with the same asset ID; document versioning/storage remain in doc.*.
 */
export const physicalAssetDocumentLinks = docSchema.table(
  'physical_asset_document_links',
  {
    physicalAssetId: uuid('physical_asset_id')
      .notNull()
      .references(() => physicalAssets.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    createdByIdentityId: uuid('created_by_identity_id')
      .notNull()
      .references(() => identities.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.physicalAssetId, table.documentId] }),
    index('physical_asset_document_links_document_idx').on(table.documentId, table.physicalAssetId),
  ],
);

import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { registerScopedDocument } from '../../authorization/application/scoped-document-registration';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { queryIsUnitRegistered } from '../../infrastructure/database/reference-lookups';
import type { DocumentStatus } from '../domain/document-categories';
import type { AllowedMimeType } from '../domain/document-categories';

export type DocumentRow = {
  id: string;
  title: string;
  category_code: string;
  classification_code: string;
  status: DocumentStatus;
  unit_id: string;
  current_version_number: number | null;
  created_at: string;
  updated_at: string;
  created_by_identity_id: string;
  updated_by_identity_id: string;
};

export type DocumentVersionRow = {
  id: string;
  document_id: string;
  version_number: number;
  stored_object_id: string;
  uploaded_by_identity_id: string;
  published_at: string;
  superseded_at: string | null;
  original_filename: string;
  mime_type: string;
  byte_size: number;
  sha256_hash: string;
};

export type DocumentVersionWithStorageRow = DocumentVersionRow & {
  storage_key: string;
};

export type PersistVersionInput = {
  documentId?: string;
  title?: string;
  categoryCode: string;
  classificationCode: string;
  unitId: string;
  actorIdentityId: string;
  storedObjectId: string;
  storageKey: string;
  sha256: string;
  mimeType: AllowedMimeType;
  originalFilename: string;
  buffer: Buffer;
};

@Injectable()
export class DocumentsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async isUnitRegistered(unitId: string): Promise<boolean> {
    return queryIsUnitRegistered(this.pool(), unitId);
  }

  async findDocumentById(documentId: string): Promise<DocumentRow | null> {
    const result = await this.pool().query<DocumentRow>(
      `SELECT
         id,
         title,
         category_code,
         classification_code,
         status::text AS status,
         unit_id,
         current_version_number,
         created_at,
         updated_at,
         created_by_identity_id,
         updated_by_identity_id
       FROM doc.documents
       WHERE id = $1`,
      [documentId],
    );
    return result.rows[0] ?? null;
  }

  async countVersions(documentId: string): Promise<number> {
    const result = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM doc.document_versions WHERE document_id = $1`,
      [documentId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async listDocuments(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<DocumentRow[]> {
    const result = await this.pool().query<DocumentRow>(
      `SELECT
         id,
         title,
         category_code,
         classification_code,
         status::text AS status,
         unit_id,
         current_version_number,
         created_at,
         updated_at,
         created_by_identity_id,
         updated_by_identity_id
       FROM doc.documents
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return result.rows;
  }

  /**
   * Total do MESMO conjunto que `listDocuments` devolve.
   *
   * Recebe a mesma clausula e os mesmos parametros da consulta de dados, para que pagina e total nao
   * possam divergir: o total e do conjunto escopado e filtrado, nunca o tamanho da pagina. E UMA
   * consulta de contagem por requisicao — nenhuma contagem por linha (N+1).
   */
  async countDocuments(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM doc.documents
       WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async listVersions(documentId: string): Promise<DocumentVersionRow[]> {
    const result = await this.pool().query<DocumentVersionRow>(
      `SELECT
         dv.id,
         dv.document_id,
         dv.version_number,
         dv.stored_object_id,
         dv.uploaded_by_identity_id,
         dv.published_at,
         dv.superseded_at,
         so.original_filename,
         so.mime_type,
         so.byte_size,
         so.sha256_hash
       FROM doc.document_versions dv
       INNER JOIN doc.stored_objects so ON so.id = dv.stored_object_id
       WHERE dv.document_id = $1
       ORDER BY dv.version_number DESC`,
      [documentId],
    );
    return result.rows;
  }

  async findVersion(
    documentId: string,
    versionNumber: number,
  ): Promise<DocumentVersionRow | null> {
    const result = await this.pool().query<DocumentVersionRow>(
      `SELECT
         dv.id,
         dv.document_id,
         dv.version_number,
         dv.stored_object_id,
         dv.uploaded_by_identity_id,
         dv.published_at,
         dv.superseded_at,
         so.original_filename,
         so.mime_type,
         so.byte_size,
         so.sha256_hash
       FROM doc.document_versions dv
       INNER JOIN doc.stored_objects so ON so.id = dv.stored_object_id
       WHERE dv.document_id = $1 AND dv.version_number = $2`,
      [documentId, versionNumber],
    );
    return result.rows[0] ?? null;
  }

  async findVersionWithStorage(
    documentId: string,
    versionNumber: number,
  ): Promise<DocumentVersionWithStorageRow | null> {
    const result = await this.pool().query<DocumentVersionWithStorageRow>(
      `SELECT
         dv.id,
         dv.document_id,
         dv.version_number,
         dv.stored_object_id,
         dv.uploaded_by_identity_id,
         dv.published_at,
         dv.superseded_at,
         so.original_filename,
         so.mime_type,
         so.byte_size,
         so.sha256_hash,
         so.storage_key
       FROM doc.document_versions dv
       INNER JOIN doc.stored_objects so ON so.id = dv.stored_object_id
       WHERE dv.document_id = $1 AND dv.version_number = $2`,
      [documentId, versionNumber],
    );
    return result.rows[0] ?? null;
  }

  async persistVersion(input: PersistVersionInput): Promise<{ documentId: string; versionNumber: number }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      let documentId = input.documentId;
      let versionNumber = 1;

      if (!documentId) {
        const title = input.title?.trim();
        if (!title) {
          throw new Error('DOCUMENT_TITLE_REQUIRED');
        }
        const created = await client.query<{ id: string }>(
          `INSERT INTO doc.documents (
             title,
             category_code,
             classification_code,
             unit_id,
             created_by_identity_id,
             updated_by_identity_id
           )
           VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING id`,
          [title, input.categoryCode, input.classificationCode, input.unitId, input.actorIdentityId],
        );
        documentId = created.rows[0]?.id;
        if (!documentId) {
          throw new Error('DOCUMENT_CREATE_FAILED');
        }

        await registerScopedDocument(client, {
          documentId,
          ownerIdentityId: input.actorIdentityId,
          unitId: input.unitId,
          isFinancial: false,
          label: input.title ?? 'document',
        });
      } else {
        const existing = await client.query<{ current_version_number: number | null }>(
          `SELECT current_version_number
           FROM doc.documents
           WHERE id = $1
           FOR UPDATE`,
          [documentId],
        );
        const current = existing.rows[0]?.current_version_number ?? 0;
        versionNumber = current + 1;
        await client.query(
          `UPDATE doc.document_versions
           SET superseded_at = NOW()
           WHERE document_id = $1 AND superseded_at IS NULL`,
          [documentId],
        );
        await client.query(
          `UPDATE doc.documents
           SET updated_by_identity_id = $2, updated_at = NOW()
           WHERE id = $1`,
          [documentId, input.actorIdentityId],
        );
      }

      await client.query(
        `INSERT INTO doc.stored_objects (
           id,
           storage_key,
           sha256_hash,
           mime_type,
           byte_size,
           original_filename
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.storedObjectId,
          input.storageKey,
          input.sha256,
          input.mimeType,
          input.buffer.byteLength,
          input.originalFilename,
        ],
      );

      await client.query(
        `INSERT INTO doc.document_versions (
           document_id,
           version_number,
           stored_object_id,
           uploaded_by_identity_id
         )
         VALUES ($1, $2, $3, $4)`,
        [documentId, versionNumber, input.storedObjectId, input.actorIdentityId],
      );

      await client.query(
        `UPDATE doc.documents
         SET current_version_number = $2, updated_at = NOW(), updated_by_identity_id = $3
         WHERE id = $1`,
        [documentId, versionNumber, input.actorIdentityId],
      );

      await client.query('COMMIT');
      return { documentId, versionNumber };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}


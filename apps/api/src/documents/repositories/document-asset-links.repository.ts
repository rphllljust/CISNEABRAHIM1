import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { DocumentRow } from './documents.repository';

/** GED owns this association. Other modules must use DocumentAssetLinksService. */
@Injectable()
export class DocumentAssetLinksRepository {
  constructor(private readonly database: DatabaseService) {}

  private pool(): Pool {
    const connection = this.database.getConnection();
    if (!connection) throw new Error('DATABASE_URL is not configured.');
    return connection.pool;
  }

  /**
   * Only GED reads its private tables. Fetch the bounded candidate window in a
   * SINGLE PostgreSQL query; authorization is still performed for EVERY row
   * by DocumentsAccessAuthz before anything is serialized.
   */
  async listLinkedDocuments(physicalAssetId: string, unitId: string, limit: number): Promise<DocumentRow[]> {
    const result = await this.pool().query<DocumentRow>(
      `SELECT d.id, d.title, d.category_code, d.classification_code,
              d.status::text AS status, d.unit_id, d.current_version_number,
              d.created_at, d.updated_at, d.created_by_identity_id, d.updated_by_identity_id
         FROM doc.physical_asset_document_links l
         INNER JOIN doc.documents d ON d.id = l.document_id
        WHERE l.physical_asset_id = $1 AND d.unit_id = $2
        ORDER BY l.created_at DESC, l.document_id DESC
        LIMIT $3`,
      [physicalAssetId, unitId, limit],
    );
    return result.rows;
  }

  /**
   * The link and the mandatory audit entry are ONE business transaction.
   * A failed audit must roll back the link; existing idempotent links do not
   * generate duplicate audit events.
   */
  async attach(
    physicalAssetId: string,
    documentId: string,
    identityId: string,
    auditOnCreate: (client: PoolClient) => Promise<void>,
  ): Promise<boolean> {
    const client = await this.pool().connect();
    let discardConnection = false;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO doc.physical_asset_document_links
           (physical_asset_id, document_id, created_by_identity_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (physical_asset_id, document_id) DO NOTHING`,
        [physicalAssetId, documentId, identityId],
      );
      const inserted = (result.rowCount ?? 0) > 0;
      if (inserted) await auditOnCreate(client);
      await client.query('COMMIT');
      return inserted;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original failure; a connection with uncertain
        // transaction state must never be returned to the pool.
        discardConnection = true;
      }
      throw error;
    } finally {
      client.release(discardConnection);
    }
  }
}

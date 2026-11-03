import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';

/** GED owns this association. Other modules must use DocumentAssetLinksService. */
@Injectable()
export class DocumentAssetLinksRepository {
  constructor(private readonly database: DatabaseService) {}

  private pool(): Pool {
    const connection = this.database.getConnection();
    if (!connection) throw new Error('DATABASE_URL is not configured.');
    return connection.pool;
  }

  async listDocumentIds(physicalAssetId: string, limit: number): Promise<string[]> {
    const result = await this.pool().query<{ document_id: string }>(
      `SELECT document_id FROM doc.physical_asset_document_links
       WHERE physical_asset_id = $1
       ORDER BY created_at DESC, document_id DESC
       LIMIT $2`,
      [physicalAssetId, limit],
    );
    return result.rows.map((row) => row.document_id);
  }

  async attach(physicalAssetId: string, documentId: string, identityId: string): Promise<boolean> {
    const result = await this.pool().query(
      `INSERT INTO doc.physical_asset_document_links
         (physical_asset_id, document_id, created_by_identity_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (physical_asset_id, document_id) DO NOTHING`,
      [physicalAssetId, documentId, identityId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

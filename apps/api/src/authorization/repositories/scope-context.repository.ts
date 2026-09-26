import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { ANCHORED_SCOPE_TYPES, AUTHZ_SCOPES, type AuthzScopeType } from '../types/authz-scopes';

export type ScopedRecordRow = {
  id: string;
  owner_identity_id: string;
  assigned_identity_id: string | null;
  unit_id: string;
  client_id: string;
  contract_id: string;
  document_id: string;
  is_financial: boolean;
  label: string;
  created_at: string;
};

@Injectable()
export class ScopeContextRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async scopeRefExists(scopeType: AuthzScopeType, refId: string): Promise<boolean> {
    if (!ANCHORED_SCOPE_TYPES.has(scopeType)) {
      return true;
    }
    const result = await this.pool().query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM "authorization".scope_refs
         WHERE scope_type = $1 AND ref_id = $2
       ) AS exists`,
      [scopeType, refId],
    );
    return result.rows[0]?.exists === true;
  }

  async insertScopeRef(
    client: Pool | PoolClient,
    scopeType: AuthzScopeType,
    refId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO "authorization".scope_refs (scope_type, ref_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [scopeType, refId],
    );
  }

  async findScopedRecordById(recordId: string): Promise<ScopedRecordRow | null> {
    const result = await this.pool().query<ScopedRecordRow>(
      `SELECT id,
              owner_identity_id,
              assigned_identity_id,
              unit_id,
              client_id,
              contract_id,
              document_id,
              is_financial,
              label,
              created_at
       FROM "authorization".scoped_records
       WHERE id = $1`,
      [recordId],
    );
    return result.rows[0] ?? null;
  }

  async listScopedRecords(whereClause: string, params: unknown[]): Promise<ScopedRecordRow[]> {
    const result = await this.pool().query<ScopedRecordRow>(
      `SELECT id,
              owner_identity_id,
              assigned_identity_id,
              unit_id,
              client_id,
              contract_id,
              document_id,
              is_financial,
              label,
              created_at
       FROM "authorization".scoped_records
       WHERE ${whereClause}
       ORDER BY created_at ASC`,
      params,
    );
    return result.rows;
  }

  async updateScopedRecordLabel(recordId: string, label: string): Promise<ScopedRecordRow | null> {
    const result = await this.pool().query<ScopedRecordRow>(
      `UPDATE "authorization".scoped_records
       SET label = $2
       WHERE id = $1
       RETURNING id,
                 owner_identity_id,
                 assigned_identity_id,
                 unit_id,
                 client_id,
                 contract_id,
                 document_id,
                 is_financial,
                 label,
                 created_at`,
      [recordId, label],
    );
    return result.rows[0] ?? null;
  }

  async ensureUnitScopeRef(refId: string): Promise<void> {
    await this.insertScopeRef(this.pool(), AUTHZ_SCOPES.Unit, refId);
  }

  async listUnitScopeRefs(): Promise<string[]> {
    const result = await this.pool().query<{ ref_id: string }>(
      `SELECT ref_id
       FROM "authorization".scope_refs
       WHERE scope_type = $1
       ORDER BY ref_id`,
      [AUTHZ_SCOPES.Unit],
    );
    return result.rows.map((row) => row.ref_id);
  }
}

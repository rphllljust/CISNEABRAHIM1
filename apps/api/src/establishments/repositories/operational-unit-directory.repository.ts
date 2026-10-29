import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';

export type OperationalUnitRow = {
  id: string;
  code: string;
  business_name: string;
  version: number;
};

export class OperationalUnitCommandConflict extends Error {
  constructor(readonly reason: 'KEY_REUSED' | 'VERSION_CONFLICT' | 'CODE_CONFLICT') {
    super(reason);
  }
}

@Injectable()
export class OperationalUnitDirectoryRepository {
  constructor(private readonly database: DatabaseService) {}

  private pool() {
    const connection = this.database.getConnection();
    if (!connection) throw new Error('DATABASE_URL is not configured.');
    return connection.pool;
  }

  async listByIds(ids: readonly string[]): Promise<OperationalUnitRow[]> {
    if (ids.length === 0) return [];
    const result = await this.pool().query<OperationalUnitRow>(
      `SELECT id, code, business_name, version FROM pty.operational_units
       WHERE id = ANY($1::text[]) ORDER BY code, id`,
      [[...ids]],
    );
    return result.rows;
  }

  async findById(id: string): Promise<OperationalUnitRow | null> {
    const result = await this.pool().query<OperationalUnitRow>(
      'SELECT id, code, business_name, version FROM pty.operational_units WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Serialize identical actor+key retries within PostgreSQL. The transaction
   * records the business mutation, immutable history and replay outcome together.
   */
  async execute(
    actorId: string,
    key: string,
    payload: unknown,
    operation: (client: PoolClient) => Promise<OperationalUnitRow>,
  ): Promise<OperationalUnitRow> {
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [actorId + ':' + key]);
      const replay = await client.query<{ request_hash: string; result: OperationalUnitRow }>(
        `SELECT request_hash, result FROM pty.operational_unit_commands
         WHERE actor_identity_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [actorId, key],
      );
      const previous = replay.rows[0];
      if (previous) {
        if (previous.request_hash !== hash) throw new OperationalUnitCommandConflict('KEY_REUSED');
        await client.query('COMMIT');
        return previous.result;
      }
      const result = await operation(client);
      await client.query(
        `INSERT INTO pty.operational_unit_commands
         (actor_identity_id, idempotency_key, request_hash, result)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [actorId, key, hash, JSON.stringify(result)],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        throw new OperationalUnitCommandConflict('CODE_CONFLICT');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async create(
    client: PoolClient,
    input: { id: string; code: string; name: string; actorId: string },
  ): Promise<OperationalUnitRow> {
    const inserted = await client.query<OperationalUnitRow>(
      `INSERT INTO pty.operational_units (id, code, business_name)
       VALUES ($1,$2,$3) RETURNING id, code, business_name, version`,
      [input.id, input.code, input.name],
    );
    const result = inserted.rows[0];
    if (!result) throw new Error('Operational unit insert returned no row');
    await this.recordHistory(client, 'CREATED', result, input.actorId, null);
    return result;
  }

  async update(
    client: PoolClient,
    input: { id: string; code: string; name: string; expectedVersion: number; actorId: string },
  ): Promise<OperationalUnitRow> {
    const current = await client.query<OperationalUnitRow>(
      'SELECT id, code, business_name, version FROM pty.operational_units WHERE id = $1 FOR UPDATE',
      [input.id],
    );
    const before = current.rows[0];
    if (!before) {
      throw new OperationalUnitCommandConflict('VERSION_CONFLICT');
    }
    if (before.version !== input.expectedVersion) {
      throw new OperationalUnitCommandConflict('VERSION_CONFLICT');
    }
    const updated = await client.query<OperationalUnitRow>(
      `UPDATE pty.operational_units
       SET code = $2, business_name = $3, version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $4
       RETURNING id, code, business_name, version`,
      [input.id, input.code, input.name, input.expectedVersion],
    );
    const after = updated.rows[0];
    if (!after) throw new OperationalUnitCommandConflict('VERSION_CONFLICT');
    await this.recordHistory(client, 'UPDATED', after, input.actorId, before);
    return after;
  }

  private async recordHistory(
    client: PoolClient,
    event: 'CREATED' | 'UPDATED',
    after: OperationalUnitRow,
    actorId: string,
    before: OperationalUnitRow | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO pty.operational_unit_history
       (unit_id, event_kind, actor_identity_id, version, before_value, after_value)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [after.id, event, actorId, after.version, before ? JSON.stringify(before) : null, JSON.stringify(after)],
    );
  }
}

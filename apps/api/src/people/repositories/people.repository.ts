import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import { PERSON_HISTORY_EVENT_TYPES } from '../domain/person-status';
import {
  PERSON_SELECT,
  type PersonHistoryRow,
  type PersonRow,
} from '../serializers/person-response.serializer';

export type CreatePersonPersistenceInput = {
  legalName: string;
  preferredName?: string;
  defaultLaborTypeCode?: string;
  externalErpId?: string;
};

export type UpdatePersonPersistenceInput = {
  personId: string;
  expectedVersion: number;
  legalName?: string;
  preferredName?: string | null;
  defaultLaborTypeCode?: string | null;
  externalErpId?: string | null;
};

@Injectable()
export class PeopleRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    @Optional() @Inject(FAULT_INJECTION_PORT) private readonly faultInjection?: FaultInjectionPort,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(personId: string): Promise<PersonRow | null> {
    const result = await this.pool().query<PersonRow>(
      `SELECT ${PERSON_SELECT}
       FROM wrk.workforce_members m
       LEFT JOIN cat.operational_labor_types lt ON lt.code = m.default_labor_type_code
       WHERE m.id = $1`,
      [personId],
    );
    return result.rows[0] ?? null;
  }

  async list(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<PersonRow[]> {
    const result = await this.pool().query<PersonRow>(
      `SELECT ${PERSON_SELECT}
       FROM wrk.workforce_members m
       LEFT JOIN cat.operational_labor_types lt ON lt.code = m.default_labor_type_code
       WHERE ${whereClause}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return result.rows;
  }

  /** Exact server count, using the same authorized WHERE as the page query. */
  async count(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM wrk.workforce_members m
       WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async create(
    input: CreatePersonPersistenceInput,
    actorIdentityId: string,
  ): Promise<PersonRow> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<PersonRow>(
        `INSERT INTO wrk.workforce_members (
           member_code,
           legal_name,
           preferred_name,
           default_labor_type_code,
           external_erp_id
         )
         VALUES (
           'PSN-' || lpad(nextval('wrk.workforce_member_code_seq')::text, 6, '0'),
           $1, $2, $3, $4
         )
         RETURNING id`,
        [
          input.legalName,
          input.preferredName ?? null,
          input.defaultLaborTypeCode ?? null,
          input.externalErpId ?? null,
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new Error('PERSON_INSERT_FAILED');
      }

      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ClientAfterInsertBeforeContacts);
      await this.insertHistoryEvent(client, row.id, PERSON_HISTORY_EVENT_TYPES.Created, actorIdentityId, {
        legalName: input.legalName,
        defaultLaborTypeCode: input.defaultLaborTypeCode ?? null,
      });

      await client.query('COMMIT');
      return (await this.findById(row.id))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(
    input: UpdatePersonPersistenceInput,
    actorIdentityId: string,
  ): Promise<PersonRow | 'VERSION_CONFLICT' | null> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sets: string[] = ['updated_at = NOW()', 'version = version + 1'];
      const params: unknown[] = [input.personId, input.expectedVersion];
      let paramIndex = 3;

      if (input.legalName !== undefined) {
        sets.push(`legal_name = $${paramIndex++}`);
        params.push(input.legalName);
      }
      if (input.preferredName !== undefined) {
        sets.push(`preferred_name = $${paramIndex++}`);
        params.push(input.preferredName);
      }
      if (input.defaultLaborTypeCode !== undefined) {
        sets.push(`default_labor_type_code = $${paramIndex++}`);
        params.push(input.defaultLaborTypeCode);
      }
      if (input.externalErpId !== undefined) {
        sets.push(`external_erp_id = $${paramIndex++}`);
        params.push(input.externalErpId);
      }

      const updated = await client.query<{ id: string }>(
        `UPDATE wrk.workforce_members
         SET ${sets.join(', ')}
         WHERE id = $1 AND version = $2
         RETURNING id`,
        params,
      );

      if (updated.rowCount === 0) {
        const exists = await client.query<{ version: number }>(
          `SELECT version FROM wrk.workforce_members WHERE id = $1`,
          [input.personId],
        );
        await client.query('ROLLBACK');
        if (exists.rowCount === 0) {
          return null;
        }
        return 'VERSION_CONFLICT';
      }

      await this.insertHistoryEvent(client, input.personId, PERSON_HISTORY_EVENT_TYPES.Updated, actorIdentityId, {
        legalName: input.legalName ?? undefined,
        preferredName: input.preferredName ?? undefined,
        defaultLaborTypeCode: input.defaultLaborTypeCode ?? undefined,
        externalErpId: input.externalErpId ?? undefined,
      });

      await client.query('COMMIT');
      return (await this.findById(input.personId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setStatus(
    personId: string,
    expectedVersion: number,
    status: 'ACTIVE' | 'INACTIVE',
    actorIdentityId: string,
    reason?: string,
  ): Promise<PersonRow | 'VERSION_CONFLICT' | 'INVALID_STATE' | null> {
    const pool = this.pool();
    const current = await pool.query<{ status: 'ACTIVE' | 'INACTIVE'; version: number }>(
      `SELECT status, version FROM wrk.workforce_members WHERE id = $1`,
      [personId],
    );
    const currentRow = current.rows[0];
    if (!currentRow) {
      return null;
    }
    if (currentRow.version !== expectedVersion) {
      return 'VERSION_CONFLICT';
    }
    if (currentRow.status === status) {
      return 'INVALID_STATE';
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `UPDATE wrk.workforce_members
         SET status = $3::wrk.workforce_member_status,
             version = version + 1,
             updated_at = NOW(),
             deactivated_at = CASE WHEN $3::text = 'INACTIVE' THEN NOW() ELSE deactivated_at END,
             deactivated_by_identity_id = CASE WHEN $3::text = 'INACTIVE' THEN $4::uuid ELSE deactivated_by_identity_id END,
             deactivation_reason = CASE WHEN $3::text = 'INACTIVE' THEN $5 ELSE deactivation_reason END
         WHERE id = $1 AND version = $2
         RETURNING id`,
        [personId, expectedVersion, status, actorIdentityId, reason ?? null],
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        const exists = await pool.query(`SELECT 1 FROM wrk.workforce_members WHERE id = $1`, [personId]);
        if (exists.rowCount === 0) {
          return null;
        }
        return 'VERSION_CONFLICT';
      }

      await this.insertHistoryEvent(
        client,
        personId,
        status === 'INACTIVE'
          ? PERSON_HISTORY_EVENT_TYPES.Deactivated
          : PERSON_HISTORY_EVENT_TYPES.Activated,
        actorIdentityId,
        status === 'INACTIVE' ? { reason: reason ?? null } : {},
      );

      await client.query('COMMIT');
      return (await this.findById(personId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listHistory(personId: string): Promise<PersonHistoryRow[]> {
    const result = await this.pool().query<PersonHistoryRow>(
      `SELECT id, event_type, payload, actor_identity_id, occurred_at
       FROM wrk.workforce_member_history_events
       WHERE workforce_member_id = $1
       ORDER BY occurred_at DESC, id DESC`,
      [personId],
    );
    return result.rows;
  }

  private async insertHistoryEvent(
    client: PoolClient,
    personId: string,
    eventType: string,
    actorIdentityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO wrk.workforce_member_history_events (
         workforce_member_id, event_type, payload, actor_identity_id
       )
       VALUES ($1, $2, $3::jsonb, $4)`,
      [personId, eventType, JSON.stringify(payload), actorIdentityId],
    );
  }
}

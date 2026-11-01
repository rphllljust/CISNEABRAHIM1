import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../infrastructure/database/database.service';
import { rollbackKeepingPrimaryCause } from '../infrastructure/database/rollback';

/**
 * DIAGNOSTICO P2-01 (#179): personal saved views for the operational workspaces.
 * The existing plt.saved_views migration 0103 is the ONLY persistence authority.
 * The owner comes exclusively from the authenticated JWT, never from input.
 *
 * A saved view is a filter PRESET, not data and not a grant. Work Inbox continues
 * applying its authoritative PDP to every subsequent business read.
 */
type ViewConfig = { filters: Record<string, string>; viewType: 'list' };
type StoredRow = {
  id: string;
  name: string;
  config: ViewConfig;
  created_at: string | Date;
};

export type PersonalSavedView = {
  id: string;
  name: string;
  filters: Record<string, string>;
  viewType: 'list';
  createdAt: string;
};

const ALLOWED_FILTERS = new Set(['domain', 'kind', 'overdue', 'unitId']);
const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._#-]{0,119}$/;
const VALUE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_SCOPE = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Closed contract: no free-text/PPI or arbitrary objects are persisted. */
export function parsePersonalViewInput(input: unknown): { name: string; config: ViewConfig } {
  if (!isRecord(input) || Object.keys(input).some((key) => !['name', 'filters', 'viewType'].includes(key))) {
    throw new BadRequestException('SAVED_VIEW_INVALID_PAYLOAD');
  }
  const name = typeof input['name'] === 'string' ? input['name'].trim().replace(/\s+/g, ' ') : '';
  if (name.length < 1 || name.length > 60 || input['viewType'] !== 'list') {
    throw new BadRequestException('SAVED_VIEW_INVALID_NAME_OR_TYPE');
  }
  const raw = input['filters'];
  if (!isRecord(raw) || Object.keys(raw).length > ALLOWED_FILTERS.size) {
    throw new BadRequestException('SAVED_VIEW_INVALID_FILTERS');
  }
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_FILTERS.has(key) || typeof value !== 'string' || !VALUE_PATTERN.test(value)) {
      throw new BadRequestException('SAVED_VIEW_INVALID_FILTERS');
    }
    if (key === 'overdue' && value !== 'true') {
      throw new BadRequestException('SAVED_VIEW_INVALID_FILTERS');
    }
    filters[key] = value;
  }
  return { name, config: { filters, viewType: 'list' } };
}

export function assertPersonalViewKey(viewKey: string): void {
  if (!SCOPE_PATTERN.test(viewKey)) {
    throw new BadRequestException('SAVED_VIEW_INVALID_SCOPE');
  }
}

function asView(row: StoredRow): PersonalSavedView {
  // A serializer never grants business data access; only registered filter tokens.
  return {
    id: row.id,
    name: row.name,
    filters: row.config.filters,
    viewType: row.config.viewType,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

@Injectable()
export class PersonalSavedViewsService {
  constructor(private readonly database: DatabaseService) {}

  private pool(): Pool {
    const connection = this.database.getConnection();
    if (!connection) throw new ServiceUnavailableException('SAVED_VIEWS_DATABASE_UNAVAILABLE');
    return connection.pool;
  }

  async list(ownerId: string, viewKey: string): Promise<PersonalSavedView[]> {
    assertPersonalViewKey(viewKey);
    const result = await this.pool().query<StoredRow>(
      `SELECT id, name, config, created_at
         FROM plt.saved_views
        WHERE owner_id = $1::uuid
          AND view_key = $2
          AND scope = 'PERSONAL'
          AND role_id IS NULL
          AND contract_version = 1
        ORDER BY created_at ASC, id ASC
        LIMIT 51`,
      [ownerId, viewKey],
    );
    if (result.rows.length > MAX_PER_SCOPE) {
      throw new ConflictException('SAVED_VIEWS_SCOPE_OVER_LIMIT');
    }
    return result.rows.map(asView);
  }

  async save(ownerId: string, viewKey: string, input: unknown): Promise<PersonalSavedView> {
    assertPersonalViewKey(viewKey);
    const { name, config } = parsePersonalViewInput(input);
    const client = await this.pool().connect();
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      // Serializes quota and same-name upserts for one owner+surface.
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        [ownerId, viewKey],
      );
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM plt.saved_views
          WHERE owner_id = $1::uuid AND view_key = $2
            AND scope = 'PERSONAL' AND lower(name) = lower($3)
          FOR UPDATE`,
        [ownerId, viewKey, name],
      );

      let result: { rows: StoredRow[] };
      if (existing.rows[0]) {
        result = await client.query<StoredRow>(
          `UPDATE plt.saved_views
              SET name = $4, config = $5::jsonb, row_version = row_version + 1,
                  updated_by_identity_id = $1::uuid, updated_at = now()
            WHERE id = $3::uuid AND owner_id = $1::uuid AND view_key = $2
              AND scope = 'PERSONAL'
          RETURNING id, name, config, created_at`,
          [ownerId, viewKey, existing.rows[0].id, name, JSON.stringify(config)],
        );
      } else {
        const count = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM plt.saved_views
            WHERE owner_id = $1::uuid AND view_key = $2 AND scope = 'PERSONAL'`,
          [ownerId, viewKey],
        );
        if (Number(count.rows[0]?.count ?? 0) >= MAX_PER_SCOPE) {
          throw new ConflictException('SAVED_VIEWS_LIMIT_REACHED');
        }
        result = await client.query<StoredRow>(
          `INSERT INTO plt.saved_views
             (owner_id, view_key, name, scope, role_id, config, is_default,
              contract_version, created_by_identity_id, updated_by_identity_id)
           VALUES ($1::uuid, $2, $3, 'PERSONAL', NULL, $4::jsonb, false,
                   1, $1::uuid, $1::uuid)
           RETURNING id, name, config, created_at`,
          [ownerId, viewKey, name, JSON.stringify(config)],
        );
      }
      const row = result.rows[0];
      if (!row) throw new Error('SAVED_VIEW_WRITE_NOT_CONFIRMED');
      await client.query('COMMIT');
      return asView(row);
    } catch (error) {
      evictWith = await rollbackKeepingPrimaryCause(client);
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  async remove(ownerId: string, viewKey: string, id: string): Promise<{ deleted: true }> {
    assertPersonalViewKey(viewKey);
    if (!UUID_PATTERN.test(id)) throw new BadRequestException('SAVED_VIEW_INVALID_ID');
    const result = await this.pool().query<{ id: string }>(
      `DELETE FROM plt.saved_views
        WHERE id = $1::uuid AND owner_id = $2::uuid
          AND view_key = $3 AND scope = 'PERSONAL'
        RETURNING id`,
      [id, ownerId, viewKey],
    );
    if (!result.rows[0]) throw new NotFoundException('SAVED_VIEW_NOT_FOUND');
    return { deleted: true };
  }
}

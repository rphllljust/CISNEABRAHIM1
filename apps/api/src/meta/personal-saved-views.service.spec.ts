import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  PersonalSavedViewsService,
  assertPersonalViewKey,
  parsePersonalViewInput,
} from './personal-saved-views.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const VIEW_KEY = 'workspace.FINANCEIRO';
const row = {
  id: ID,
  name: 'Somente vencidos',
  config: { viewType: 'list', filters: { overdue: 'true', domain: 'FINANCEIRO' } },
  created_at: '2026-11-01T12:00:00.000Z',
};

function setup(options: { existing?: boolean; count?: number; list?: typeof row[] } = {}) {
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('SELECT id FROM plt.saved_views')) {
        return { rows: options.existing ? [{ id: ID }] : [] };
      }
      if (sql.includes('count(*)::text AS count')) {
        return { rows: [{ count: String(options.count ?? 0) }] };
      }
      if (sql.includes('INSERT INTO plt.saved_views') || sql.includes('UPDATE plt.saved_views')) {
        return { rows: [row] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.startsWith('SELECT')) return { rows: options.list ?? [row] };
      if (sql.startsWith('DELETE')) return { rows: [] };
      return { rows: [] };
    }),
  };
  const service = new PersonalSavedViewsService({
    getConnection: () => ({ pool }),
  } as never);
  return { service, client, pool };
}

describe('Diagnostic P2-01 — personal Saved Views', () => {
  it('rejects names, unknown filters, arbitrary payloads and scopes without persisting', () => {
    expect(() => parsePersonalViewInput({
      name: 'OK', filters: { customerName: 'PersonalData' }, viewType: 'list',
    })).toThrow(BadRequestException);
    expect(() => parsePersonalViewInput({
      name: 'OK', filters: { overdue: 'false' }, viewType: 'list',
    })).toThrow(BadRequestException);
    expect(() => parsePersonalViewInput({
      name: 'OK', filters: {}, viewType: 'kanban',
    })).toThrow(BadRequestException);
    expect(() => parsePersonalViewInput({
      name: 'OK', filters: {}, viewType: 'list', ownerId: OTHER,
    })).toThrow(BadRequestException);
    expect(() => assertPersonalViewKey('../other')).toThrow(BadRequestException);
    expect(() => assertPersonalViewKey(VIEW_KEY)).not.toThrow();
    expect(parsePersonalViewInput({
      name: ' Somente vencidos ', filters: { overdue: 'true' }, viewType: 'list',
    })).toMatchObject({ name: 'Somente vencidos' });
  });

  it('only reads owner-scoped, PERSONAL and contract-compatible rows', async () => {
    const { service, pool } = setup();
    await expect(service.list(OWNER, VIEW_KEY)).resolves.toEqual([{
      id: ID, name: row.name, filters: row.config.filters, viewType: 'list',
      createdAt: row.created_at,
    }]);
    const query = pool.query.mock.calls[0] as unknown[];
    expect(String(query[0])).toContain('owner_id = $1::uuid');
    expect(String(query[0])).toContain("scope = 'PERSONAL'");
    expect(query[1]).toEqual([OWNER, VIEW_KEY]);
  });

  it('serializes quota and inserts solely under JWT-derived owner', async () => {
    const { service, client } = setup();
    await expect(service.save(OWNER, VIEW_KEY, {
      name: row.name, filters: row.config.filters, viewType: 'list',
    })).resolves.toMatchObject({ id: ID, name: row.name });
    const insert = client.query.mock.calls.find((call) => String(call[0]).includes('INSERT INTO'));
    const insertParams = insert?.[1] as unknown[] | undefined;
    expect(insertParams?.slice(0, 3)).toEqual([OWNER, VIEW_KEY, row.name]);
    // jsonb key order is irrelevant; assert the actual stored document shape.
    expect(JSON.parse(String(insertParams?.[3]))).toEqual(row.config);
    expect(client.query.mock.calls.map((call) => call[0])).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('updates the existing view instead of creating a duplicate with the same name', async () => {
    const { service, client } = setup({ existing: true });
    await service.save(OWNER, VIEW_KEY, {
      name: row.name, filters: row.config.filters, viewType: 'list',
    });
    expect(client.query.mock.calls.some((call) => String(call[0]).includes('UPDATE plt.saved_views'))).toBe(true);
    expect(client.query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO'))).toBe(false);
  });

  it('fails closed and rolls back when the 50-view quota is reached', async () => {
    const { service, client } = setup({ count: 50 });
    await expect(service.save(OWNER, VIEW_KEY, {
      name: 'Outra', filters: {}, viewType: 'list',
    })).rejects.toThrow(ConflictException);
    expect(client.query.mock.calls.map((call) => call[0])).toContain('ROLLBACK');
    expect(client.query.mock.calls.map((call) => call[0])).not.toContain('COMMIT');
  });

  it('hides the existence of another user\'s view on DELETE', async () => {
    const { service, pool } = setup();
    await expect(service.remove(OTHER, VIEW_KEY, ID)).rejects.toThrow(NotFoundException);
    const query = pool.query.mock.calls[0] as unknown[];
    expect(String(query[0])).toContain('owner_id = $2::uuid');
    expect(query[1]).toEqual([ID, OTHER, VIEW_KEY]);
  });
});

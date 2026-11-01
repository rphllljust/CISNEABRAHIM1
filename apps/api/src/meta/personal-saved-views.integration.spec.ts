import { hashPassword, insertIdentity } from '@cisne/database';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { PersonalSavedViewsService } from './personal-saved-views.service';

/**
 * Real PostgreSQL proof of migration 0103 and owner restrictions.
 * Only the disposable TEST_DATABASE_URL is touched. No production fixtures.
 */
describe('Diagnostic P2-01 / #179 — PostgreSQL personal Saved Views', () => {
  let pool: Pool;
  let service: PersonalSavedViewsService;
  let first: string;
  let second: string;
  const scope = 'workspace.FINANCEIRO';

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) throw new Error('TEST_DATABASE_URL required for Saved Views integration');
    pool = new Pool({ connectionString: url });
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    first = (await insertIdentity(
      pool, `saved-views-a-${crypto.randomUUID()}@cisne.invalid`, passwordHash,
    )).identityId;
    second = (await insertIdentity(
      pool, `saved-views-b-${crypto.randomUUID()}@cisne.invalid`, passwordHash,
    )).identityId;
    service = new PersonalSavedViewsService({
      getConnection: () => ({ pool }),
    } as never);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query('DELETE FROM plt.saved_views WHERE owner_id = ANY($1::uuid[])', [[first, second]]);
      // insertIdentity also creates an identity.credentials row (RESTRICT FK).
      // Delete the dependent test-only credentials before deleting their owners.
      await pool.query('DELETE FROM identity.credentials WHERE identity_id = ANY($1::uuid[])', [[first, second]]);
      await pool.query('DELETE FROM identity.identities WHERE id = ANY($1::uuid[])', [[first, second]]);
    } finally {
      await pool.end();
    }
  });

  it('persist/reload works across sessions, upsert is idempotent, other owners cannot list/delete', async () => {
    const before = await service.list(first, scope);
    expect(before).toHaveLength(0);

    const saved = await service.save(first, scope, {
      name: ' Vencidos ', viewType: 'list',
      filters: { domain: 'FINANCEIRO', overdue: 'true' },
    });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(saved.name).toBe('Vencidos');

    const reloaded = await new PersonalSavedViewsService({
      getConnection: () => ({ pool }),
    } as never).list(first, scope);
    expect(reloaded).toEqual([saved]);
    expect(await service.list(second, scope)).toEqual([]);
    expect(await service.list(first, 'workspace.OPERACOES')).toEqual([]);

    const changed = await service.save(first, scope, {
      name: 'vencidos', viewType: 'list',
      filters: { overdue: 'true' },
    });
    expect(changed.id).toBe(saved.id);
    expect(changed.filters).toEqual({ overdue: 'true' });
    expect(await service.list(first, scope)).toHaveLength(1);

    await expect(service.remove(second, scope, saved.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await service.list(first, scope)).toHaveLength(1);
    expect(await service.remove(first, scope, saved.id)).toEqual({ deleted: true });
    expect(await service.list(first, scope)).toEqual([]);
  });
});

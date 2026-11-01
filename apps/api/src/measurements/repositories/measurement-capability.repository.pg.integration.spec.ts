import { hashPassword, insertIdentity } from '@cisne/database';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_TEST_PASSWORD } from '../../auth/test/auth-test-env';
import { MeasurementCapabilityRepository } from './measurement-capability.repository';
import type { LeakageOrderFactsRow } from './measurement-capability.repository.types';

/**
 * Issue #157 — REAL PostgreSQL proof, complementary to the fake-client
 * cursor protocol tests. All rows and credentials live exclusively in the
 * disposable TEST_DATABASE_URL; production data is never modified.
 *
 * The table rows are isolated test facts, not purported business transactions.
 * This suite exercises the owning repository cursor, not Billing or acceptance.
 */
describe('MASTER 001-02 / #157 — completed-order snapshot against PostgreSQL', () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const prefix = `MSR-SNP-${suffix}`;
  const primaryUnit = `msr-snapshot-${suffix}-a`;
  const concurrentUnit = `msr-snapshot-${suffix}-b`;
  let pool: Pool;
  let identityId: string;

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) {
      throw new Error('TEST_DATABASE_URL is mandatory for PostgreSQL snapshot proof');
    }
    pool = new Pool({ connectionString: url });
    const identity = await insertIdentity(
      pool,
      `msr-snapshot-${crypto.randomUUID()}@cisne.invalid`,
      await hashPassword(AUTH_TEST_PASSWORD),
    );
    identityId = identity.identityId;
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(
        'DELETE FROM so.service_orders WHERE unit_id = ANY($1::text[])',
        [[primaryUnit, concurrentUnit]],
      );
    } finally {
      await pool.end();
    }
  });

  async function seedCompletedOrders(unitId: string, from: number, to: number): Promise<void> {
    if (to < from) return;
    await pool.query(
      `INSERT INTO so.service_orders
         (internal_code, order_number, unit_id, status, origin,
          client_snapshot, service_snapshot, description, started_at, completed_at,
          created_by_identity_id, updated_by_identity_id)
       SELECT $1 || '-I-' || lpad(n::text, 6, '0'),
              $1 || '-O-' || lpad(n::text, 6, '0'),
              $2, 'COMPLETED'::so.service_order_status,
              'AUTHORIZED_DIRECT'::so.service_order_origin,
              '{}'::jsonb, '{}'::jsonb, 'Database-only pagination evidence',
              '2026-09-30T12:00:00Z'::timestamptz,
              '2026-10-01T12:00:00Z'::timestamptz, $3::uuid, $3::uuid
         FROM generate_series($4::int, $5::int) AS n`,
      [`${prefix}-${unitId === primaryUnit ? 'A' : 'B'}`, unitId, identityId, from, to],
    );
  }

  function repository(): MeasurementCapabilityRepository {
    return new MeasurementCapabilityRepository({
      getConnection: () => ({ pool }),
    } as never);
  }

  it('reconstructs 0, 499, 500, 501 and 1500 records without gaps, duplicates or cross-unit leakage', async () => {
    const reader = repository();
    let inserted = 0;
    for (const count of [0, 499, 500, 501, 1500]) {
      await seedCompletedOrders(primaryUnit, inserted + 1, count);
      inserted = count;
      const rows = await reader.listCompletedOrdersForLeakage(primaryUnit);

      expect(rows).toHaveLength(count);
      expect(new Set(rows.map((row) => row.service_order_id)).size).toBe(count);
      expect(rows.every((row) => row.unit_id === primaryUnit)).toBe(true);
      expect(rows.map((row) => row.order_number)).toEqual(
        [...rows.map((row) => row.order_number)].sort(),
      );

      // A read must never rewrite the durable projection, even at 1500 rows.
      const durable = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM msr.revenue_leakage_positions WHERE unit_id = $1',
        [primaryUnit],
      );
      expect(durable.rows[0]?.count).toBe('0');
    }
  });

  it('preserves the first REPEATABLE READ snapshot when a separate client inserts between FETCH pages', async () => {
    await seedCompletedOrders(concurrentUnit, 1, 501);
    let insertedBetweenPages = false;
    const wrappedPool = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (sql: string, params?: unknown[]) => {
            const result = await client.query(sql, params);
            if (!insertedBetweenPages && sql.startsWith('FETCH FORWARD')) {
              insertedBetweenPages = true;
              // This uses a DIFFERENT PostgreSQL connection and commits after
              // the cursor transaction has already established its snapshot.
              await seedCompletedOrders(concurrentUnit, 502, 502);
            }
            return result;
          },
          release: (error?: Error) => client.release(error),
        };
      },
    };
    const reader = new MeasurementCapabilityRepository({
      getConnection: () => ({ pool: wrappedPool }),
    } as never);

    const consistent = await reader.listCompletedOrdersForLeakage(concurrentUnit);
    expect(insertedBetweenPages).toBe(true);
    expect(consistent).toHaveLength(501);
    expect(new Set(consistent.map((row: LeakageOrderFactsRow) => row.service_order_id)).size).toBe(501);
    expect(consistent.every((row) => row.unit_id === concurrentUnit)).toBe(true);

    // A new query gets a new snapshot and can legitimately see the 502nd row.
    const nextSnapshot = await repository().listCompletedOrdersForLeakage(concurrentUnit);
    expect(nextSnapshot).toHaveLength(502);
    expect(new Set(nextSnapshot.map((row) => row.service_order_id)).size).toBe(502);
  });
});

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FORBIDDEN_BUSINESS_TABLES = [
  'users',
  'user',
  'clients',
  'client',
  'customers',
  'customer',
  'service_orders',
  'service_order',
  'os',
  'resources',
  'resource',
  'documents',
  'document',
  'purchase_orders',
  'purchase_order',
  'po',
  'measurements',
  'measurement',
  'invoices',
  'invoice',
  'billing',
  'payments',
  'payment',
  'audit_log',
  'audit_logs',
  'business_audit',
] as const;

const ALLOWED_TECHNICAL_TABLES = new Set([
  'schema_baseline',
  '__drizzle_migrations',
  'identities',
  'credentials',
  'sessions',
  'refresh_token_families',
  'refresh_tokens',
  'grants',
  'decision_audits',
  'scope_refs',
  'scoped_records',
]);

const ALLOWED_SCHEMAS = new Set(['infrastructure', 'identity', 'authorization', 'audit', 'pty']);

/** Party masters live in `pty` (clients + suppliers). Other business schemas are out of this probe. */
const ALLOWED_PTY_TABLES = new Set([
  'clients',
  'client_contacts',
  'client_addresses',
  'suppliers',
  'supplier_contacts',
  'supplier_addresses',
  'supplier_history_events',
  'legal_entities',
  'establishments',
  'establishment_tax_registrations',
  'establishment_certificates',
  'legal_entity_history_events',
  'establishment_history_events',
  'establishment_tax_registration_history_events',
]);

describe('PostgreSQL integration', () => {
  let pool: Pool;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(() => {
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL is required for integration tests. Start docker compose and copy .env.example.',
      );
    }

    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('connects and runs an isolated transaction that rolls back', async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<{ value: number }>('SELECT 1 AS value');
      expect(result.rows[0]?.value).toBe(1);
      await client.query('ROLLBACK');

      const afterRollback = await client.query<{ in_txn: boolean }>(
        "SELECT current_setting('transaction_isolation') IS NOT NULL AS in_txn",
      );
      expect(afterRollback.rows[0]).toBeDefined();
    } finally {
      client.release();
    }
  });

  it('reports PostgreSQL 18.x', async () => {
    const result = await pool.query<{ version: string }>(
      "SELECT current_setting('server_version') AS version",
    );
    const version = result.rows[0]?.version ?? '';
    expect(version).toMatch(/^18\./);
  });

  it('does not contain business tables', async () => {
    const result = await pool.query<{ schemaname: string; tablename: string }>(
      `SELECT schemaname, tablename
       FROM pg_tables
       WHERE schemaname IN ('public', 'infrastructure', 'identity', 'pty')
       ORDER BY schemaname, tablename`,
    );

    const ptyTables = result.rows
      .filter((row) => row.schemaname === 'pty')
      .map((row) => row.tablename.toLowerCase())
      .sort();
    expect(ptyTables).toEqual([...ALLOWED_PTY_TABLES].sort());

    for (const row of result.rows) {
      const tableName = row.tablename.toLowerCase();
      if (row.schemaname !== 'pty') {
        expect(FORBIDDEN_BUSINESS_TABLES).not.toContain(tableName);
      }
      expect(ALLOWED_SCHEMAS.has(row.schemaname)).toBe(true);
      if (row.schemaname === 'public') {
        expect(ALLOWED_TECHNICAL_TABLES.has(tableName)).toBe(true);
      }
    }
  });

  it('classifies timestamptz calendar dates in UTC, not session TimeZone', async () => {
    try {
      await pool.query("SET TIME ZONE 'America/Sao_Paulo'");
      const result = await pool.query<{ utc_date: string; session_date: string }>(
        `SELECT
           ('2026-09-02T01:00:00.000Z'::timestamptz AT TIME ZONE 'UTC')::date::text AS utc_date,
           ('2026-09-02T01:00:00.000Z'::timestamptz)::date::text AS session_date`,
      );
      expect(result.rows[0]?.utc_date).toBe('2026-09-02');
      expect(result.rows[0]?.session_date).toBe('2026-09-01');
    } finally {
      await pool.query("SET TIME ZONE 'UTC'");
    }
  });
});

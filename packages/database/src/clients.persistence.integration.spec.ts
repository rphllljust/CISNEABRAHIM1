import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Clients persistence migration', () => {
  let pool: Pool;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(() => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for clients persistence tests.');
    }
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies clients baseline migration on empty-compatible database', async () => {
    const migrationPath = resolve(__dirname, '../migrations/0006_clients_baseline.sql');
    const sql = readFileSync(migrationPath, 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('already exists')) {
          continue;
        }
        throw error;
      }
    }

    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'pty'
       ORDER BY tablename`,
    );
    // Lista completa e atual do schema `pty` — mesma igualdade exata usada pelo sibling de
    // catalogo. O 0006 cria a baseline de clientes; o 0064 (supplier master) e o 0072 (legal
    // establishment master) acrescentam as demais tabelas do schema, que estavam ausentes desta
    // lista (asserção impossivel de satisfazer em banco migrado). Tabela nova em `pty` continua
    // exigindo manutencao explicita desta lista.
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'client_addresses',
      'client_contacts',
      'clients',
      'establishment_certificates',
      'establishment_history_events',
      'establishment_tax_registration_history_events',
      'establishment_tax_registrations',
      'establishments',
      'legal_entities',
      'legal_entity_history_events',
      'supplier_addresses',
      'supplier_contacts',
      'supplier_history_events',
      'suppliers',
    ]);
  });

  it('upgrades from pre-0006 schema without destroying existing identity data', async () => {
    const before = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM identity.identities`,
    );
    const identitiesBefore = Number(before.rows[0]?.count ?? '0');

    const migrationPath = resolve(__dirname, '../migrations/0006_clients_baseline.sql');
    const sql = readFileSync(migrationPath, 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('already exists')) {
          continue;
        }
        throw error;
      }
    }

    const after = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM identity.identities`,
    );
    expect(Number(after.rows[0]?.count)).toBe(identitiesBefore);

    const uniqueIndex = await pool.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'pty'
         AND tablename = 'clients'
         AND indexname = 'clients_normalized_tax_id_uidx'`,
    );
    expect(uniqueIndex.rows).toHaveLength(1);
  });
});

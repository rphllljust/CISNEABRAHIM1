#!/usr/bin/env node
/**
 * PRODUCTION_BOOTSTRAP CLI — first identity only (manual, explicit, never on startup).
 *
 * Usage:
 *   node packages/database/dist/cli/run-bootstrap-cli.js
 *   pnpm bootstrap:first-identity        (raiz do monorepo)
 * Env:
 *   DATABASE_URL              required PostgreSQL connection URL
 *   BOOTSTRAP_ADMIN_LOGIN     required login identifier (>= 5 chars)
 *   BOOTSTRAP_ADMIN_PASSWORD  required password (strength policy applies)
 *   BOOTSTRAP_CONFIRM         must be I_UNDERSTAND
 *
 * Contract: docs/implementation/19-seeding.md — creates no business roles, rejects weak
 * password, rejects when any identity already exists, idempotent for the same login.
 */
import { Pool } from 'pg';
import { runProductionBootstrap } from '../seed/production-bootstrap';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL']?.trim();
  if (!databaseUrl) {
    console.error('CONFIGURATION_ERROR\nDATABASE_URL is required (postgres:// or postgresql:// URL).');
    process.exit(1);
  }

  const login = process.env['BOOTSTRAP_ADMIN_LOGIN']?.trim();
  const password = process.env['BOOTSTRAP_ADMIN_PASSWORD'];
  if (!login || !password) {
    console.error(
      'CONFIGURATION_ERROR\nBOOTSTRAP_ADMIN_LOGIN and BOOTSTRAP_ADMIN_PASSWORD are required.',
    );
    process.exit(1);
  }

  const confirmToken = process.env['BOOTSTRAP_CONFIRM']?.trim() ?? '';
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    const result = await runProductionBootstrap(pool, { login, password, confirmToken });
    console.log(`PRODUCTION_BOOTSTRAP ${result.outcome.toUpperCase()}: ${result.message}`);
    if (result.outcome === 'rejected') {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('PRODUCTION_BOOTSTRAP FAILED');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();

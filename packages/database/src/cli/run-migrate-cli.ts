#!/usr/bin/env node
/**
 * Hermetic migration CLI — applies the bundled drizzle migrations to the database.
 *
 * Usage (release artifact or monorepo):
 *   node packages/database/dist/cli/run-migrate-cli.js
 *
 * Env:
 *   DATABASE_URL          PostgreSQL connection URL (inline)
 *   DATABASE_URL_FILE     path to a file containing the URL. Takes precedence over
 *                         DATABASE_URL and exists so the runner can mount the
 *                         credential as a secret file instead of inlining it in the
 *                         process environment (same contract as the API runtime).
 *   CISNE_MIGRATIONS_DIR  optional override for the migrations folder
 *                         (default: <package>/migrations relative to this file)
 *
 * Idempotent: safe to run repeatedly; only pending journal entries apply.
 */
import { Pool } from 'pg';
import { resolveMigrationsFolder, runMigrations } from '../migrate';
import { readSecretValue } from './secret-value';

async function main(): Promise<void> {
  let databaseUrl: string | undefined;
  try {
    databaseUrl = readSecretValue('DATABASE_URL');
  } catch (error) {
    console.error('CONFIGURATION_ERROR');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (!databaseUrl) {
    console.error(
      'CONFIGURATION_ERROR\nDATABASE_URL (or DATABASE_URL_FILE) is required to run migrations (postgres:// or postgresql:// URL).',
    );
    process.exit(1);
  }

  const migrationsFolder = resolveMigrationsFolder(process.env['CISNE_MIGRATIONS_DIR']);
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    const outcome = await runMigrations({ pool, migrationsFolder });
    console.log(
      `MIGRATIONS OK: applied=${outcome.appliedMigrations} total=${outcome.totalMigrations} folder=${outcome.migrationsFolder}`,
    );
  } catch (error) {
    console.error('MIGRATIONS FAILED');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();

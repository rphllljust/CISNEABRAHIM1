import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(resolve(repoRoot, '.env'));

if (!process.env['NODE_ENV']) {
  process.env['NODE_ENV'] = 'development';
}

const requireFromDatabase = createRequire(resolve(packageRoot, 'package.json'));
const { Pool } = requireFromDatabase('pg');
const { runDevelopmentSeed } = requireFromDatabase('./dist/seed/development-seed.js');

const databaseUrl = process.env['DATABASE_URL']?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

try {
  const result = await runDevelopmentSeed(pool);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}

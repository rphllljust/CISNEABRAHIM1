#!/usr/bin/env node
/**
 * Provisiona um banco de teste ISOLADO por agente/execucao.
 *
 * Problema comprovado: varias IAs/processos compartilhando o mesmo `TEST_DATABASE_URL` disputam
 * o mesmo estado global. Mesmo com a serializacao por advisory lock (protecao SECUNDARIA), a
 * suite vira uma FILA: o MESMO spec levou 116 s no banco compartilhado e 37 s no banco isolado,
 * e a suite completa de e2e passou de ~5 min para mais de 30 min sob contencao, com falhas nao
 * deterministicas (`deadlock detected`) quando algum runner nao respeitava o lock.
 *
 * Isolamento por banco e o controle PRIMARIO (o lock continua valendo como protecao secundaria
 * entre quem ainda compartilhar a mesma base).
 *
 * Uso:
 *   node scripts/test-db-isolate.mjs                 # cria/reaproveita e migra; imprime a URL
 *   node scripts/test-db-isolate.mjs --name=meu-job  # nome estavel (padrao: derivado do usuario)
 *   node scripts/test-db-isolate.mjs --drop          # remove o banco isolado e sai
 *   node scripts/test-db-isolate.mjs --json          # saida legivel por script
 *
 * O banco e criado a partir do servidor apontado por TEST_DATABASE_URL (.env) e migrado pelo
 * caminho canonico do repositorio (`scripts/run-drizzle-migrate.mjs`), sem inventar migracao.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { getTestDatabaseUrl, loadRepoEnv } from './lib/database-test-env.mjs';

loadRepoEnv();

const args = process.argv.slice(2);
const drop = args.includes('--drop');
const json = args.includes('--json');
const nameArg = args.find((arg) => arg.startsWith('--name='));
const suffix = nameArg
  ? nameArg.slice('--name='.length)
  : `${(process.env['USERNAME'] ?? process.env['USER'] ?? 'agent').toLowerCase()}-${process.pid}`;

const baseUrl = getTestDatabaseUrl();
if (!baseUrl) {
  console.error('TEST_DATABASE_URL is required (copy .env.example to .env and start PostgreSQL).');
  process.exit(1);
}

const safeSuffix = suffix.replace(/[^a-z0-9_]/gi, '_').slice(0, 40);
const isolatedName = `cisne_test_iso_${safeSuffix}`;

const parsed = new URL(baseUrl);
const adminUrl = new URL(baseUrl);
adminUrl.pathname = '/postgres';
const isolatedUrl = new URL(baseUrl);
isolatedUrl.pathname = `/${isolatedName}`;

const require = createRequire(resolve(import.meta.dirname, '../packages/database/package.json'));
const { Pool } = require('pg');

function emit(payload) {
  if (json) {
    console.log(JSON.stringify(payload));
    return;
  }
  for (const [key, value] of Object.entries(payload)) {
    console.log(`${key}=${value}`);
  }
}

async function withPool(connectionString, run) {
  const pool = new Pool({ connectionString });
  try {
    return await run(pool);
  } finally {
    await pool.end();
  }
}

async function databaseExists(pool, name) {
  const result = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return result.rowCount > 0;
}

if (drop) {
  await withPool(adminUrl.toString(), async (pool) => {
    // Encerra conexoes residuais do proprio banco isolado antes de remover.
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [isolatedName],
    );
    await pool.query(`DROP DATABASE IF EXISTS "${isolatedName}"`);
  });
  emit({ action: 'dropped', database: isolatedName });
  process.exit(0);
}

const created = await withPool(adminUrl.toString(), async (pool) => {
  if (await databaseExists(pool, isolatedName)) {
    return false;
  }
  const owner = decodeURIComponent(parsed.username);
  await pool.query(`CREATE DATABASE "${isolatedName}" OWNER "${owner}"`);
  return true;
});

// Migracao pelo caminho canonico: o runner do repositorio respeita TEST_DATABASE_URL ja definido.
const migrate = spawnSync('node', [resolve(import.meta.dirname, 'run-drizzle-migrate.mjs')], {
  stdio: json ? ['ignore', 'ignore', 'inherit'] : 'inherit',
  env: { ...process.env, TEST_DATABASE_URL: isolatedUrl.toString() },
});

if (migrate.status !== 0) {
  console.error(`Migration failed for isolated database ${isolatedName}.`);
  process.exit(migrate.status ?? 1);
}

emit({
  action: created ? 'created' : 'reused',
  database: isolatedName,
  TEST_DATABASE_URL: isolatedUrl.toString(),
});

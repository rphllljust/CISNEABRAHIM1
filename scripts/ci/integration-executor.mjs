#!/usr/bin/env node
// INTEGRATION EXECUTOR — um host, N workers locais, N bancos efemeros.
//
// FASES 3, 4 e 6 do plano CI-FAST.
//
// O QUE ESTE SCRIPT SUBSTITUI
//
// Hoje: 8 runners frios, cada um pagando checkout + pnpm install + build + PostgreSQL +
// migrations. Medido no run 39785822308: 44s de overhead por shard, 8x = 352s desperdicados,
// contra 146s de teste real.
//
// Aqui: UM processo paga setup, build, PostgreSQL e migrations UMA vez, cria um database
// template, clona N bancos efemeros e dispara N processos Vitest em paralelo. Cada arquivo do
// template custa ~120ms em vez de repetir a cadeia de migrations.
//
// ISOLAMENTO (a garantia que NAO pode ser perdida)
//
// Cada worker tem `TEST_DATABASE_URL` apontando para um database FISICAMENTE distinto
// (`cisne_it_01`...). Advisory locks no Postgres sao escopados por database: dois workers em
// bancos diferentes pegam locks diferentes mesmo com a MESMA chave `0x43534e45`. E por isso que
// `maxWorkers: 1` pode continuar dentro de cada worker sem contenção entre eles.
//
// FAIL-CLOSED (inegociavel)
//
//   worker falhou        -> exit 1
//   worker morreu        -> exit 1
//   spec sem shard       -> exit 1
//   spec duplicado       -> exit 1
//   scheduler quebrou    -> exit 1
//   cobertura incompleta -> exit 1
//   banco nao clonou     -> exit 1
//
// Cleanup roda SEMPRE (try/finally). Residuo de run anterior e removido no inicio.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative, sep } from 'node:path';
import pg from 'pg';

const WORKERS = Number(process.env['INTEGRATION_WORKERS'] ?? 8);
const ADMIN_URL =
  process.env['INTEGRATION_ADMIN_URL'] ??
  'postgresql://cisne_ci:cisne_ci_disposable_password@127.0.0.1:5432/postgres';
const TEMPLATE_DB = process.env['INTEGRATION_TEMPLATE_DB'] ?? 'cisne_integration_template';
const DB_PREFIX = process.env['INTEGRATION_DB_PREFIX'] ?? 'cisne_it_';
const PLAN_SCRIPT = 'scripts/ci/integration-shard-plan.mjs';
const CI_DIR = 'artifacts/ci';

/** Nome de database efemero do worker `n` (1-based). */
const dbName = (n) => `${DB_PREFIX}${String(n).padStart(2, '0')}`;

function adminUrlFor(database) {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdmin(fn) {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Remove bancos efemeros, inclusive residuos de execucoes anteriores cujo processo morreu.
 * Roda no inicio (higiene) e no finally (limpeza garantida).
 */
async function dropAllEphemeral(client) {
  const { rows } = await client.query(
    `SELECT datname FROM pg_database WHERE datname LIKE $1 AND datname <> $2`,
    [`${DB_PREFIX}%`, TEMPLATE_DB],
  );
  for (const { datname } of rows) {
    // FORCE derruba conexoes pendentes: um worker morto pode deixar sessao aberta.
    await client.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
  }
  return rows.length;
}

/** Garante que nenhuma conexao reste no template — senao CREATE DATABASE ... TEMPLATE falha. */
async function terminateTemplateConnections(client) {
  await client.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [TEMPLATE_DB],
  );
}

function discoverSpecs() {
  const root = join(process.cwd(), 'apps', 'api');
  const srcRoot = join(root, 'src');
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.integration.spec.ts')) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(srcRoot);
  return out.sort();
}

/** Chama o scheduler LPT para o worker `n` e devolve a lista de specs. */
function planForWorker(n) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [PLAN_SCRIPT, '--index', String(n), '--count', String(WORKERS)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`shard plan failed for worker ${n}: ${stderr.trim() || `exit ${code}`}`));
        return;
      }
      resolve(stdout.trim().split(/\s+/).filter(Boolean));
    });
  });
}

/**
 * Valida a particao ANTES de rodar qualquer teste. Qualquer violacao e exit 1: um plano
 * incompleto significa cobertura perdida, e cobertura perdida com CI verde e falso verde.
 */
function validatePartition(plans, discovered) {
  const all = plans.flat();
  const unique = new Set(all);

  if (all.length !== unique.size) {
    const dupes = all.filter((spec, i) => all.indexOf(spec) !== i);
    throw new Error(`shard plan has ${dupes.length} duplicated spec(s): ${[...new Set(dupes)].slice(0, 5).join(', ')}`);
  }
  const missing = discovered.filter((spec) => !unique.has(spec));
  if (missing.length > 0) {
    throw new Error(`shard plan is missing ${missing.length} spec(s): ${missing.slice(0, 5).join(', ')}`);
  }
  const phantom = [...unique].filter((spec) => !discovered.includes(spec));
  if (phantom.length > 0) {
    throw new Error(`shard plan references ${phantom.length} non-existent spec(s): ${phantom.slice(0, 5).join(', ')}`);
  }
  if (unique.size !== discovered.length) {
    throw new Error(`partition covers ${unique.size} specs but ${discovered.length} exist`);
  }
}

/** Roda um worker. Resolve sempre; o veredito vai no objeto de resultado. */
function runWorker(n, specs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timingsPath = join(CI_DIR, `integration.s${n}.timings.ndjson`);
    const child = spawn(
      'pnpm',
      [
        '--filter',
        '@cisne/api',
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.integration.config.ts',
        ...specs,
      ],
      {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: {
          ...process.env,
          TEST_DATABASE_URL: adminUrlFor(dbName(n)),
          INTEGRATION_DB_NAME: dbName(n),
          INTEGRATION_TIMINGS_FILE: timingsPath,
        },
        shell: process.platform === 'win32',
      },
    );

    const finish = (code, signal) => {
      resolve({
        worker: n,
        specs: specs.length,
        exitCode: code,
        signal: signal ?? null,
        sec: Math.round(((Date.now() - started) / 1000) * 10) / 10,
      });
    };

    child.on('error', (error) => {
      process.stderr.write(`worker ${n} spawn error: ${error.message}\n`);
      finish(-1, null);
    });
    child.on('close', finish);
  });
}

function writeMetrics(results, integrationSec, discoveredCount, phases) {
  mkdirSync(CI_DIR, { recursive: true });
  const seconds = results.map((r) => r.sec);
  const metrics = {
    generatedAt: new Date().toISOString(),
    shardCount: WORKERS,
    integrationSec,
    specCountExpected: discoveredCount,
    specsCovered: results.reduce((sum, r) => sum + r.specs, 0),
    slowestShardSec: seconds.length ? Math.max(...seconds) : null,
    fastestShardSec: seconds.length ? Math.min(...seconds) : null,
    runnerSeconds: seconds.reduce((sum, s) => sum + s, 0),
    phases,
    shards: results,
  };
  writeFileSync(join(CI_DIR, 'ci-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  return metrics;
}

/** Marca o fim de uma fase e devolve a duracao. Medir cada etapa e o que permite decidir. */
function makePhaseTimer() {
  const phases = {};
  let last = Date.now();
  return {
    mark(name) {
      const now = Date.now();
      phases[name] = Math.round(((now - last) / 1000) * 10) / 10;
      last = now;
    },
    get all() {
      return phases;
    },
  };
}

async function main() {
  mkdirSync(CI_DIR, { recursive: true });
  const startedAt = Date.now();

  const phases = makePhaseTimer();
  const discovered = discoverSpecs();
  if (discovered.length === 0) {
    throw new Error('no integration specs discovered — refusing to report success');
  }
  process.stdout.write(`integration executor: ${discovered.length} specs, ${WORKERS} workers\n`);

  // PLANO + VALIDACAO ANTES de qualquer setup caro.
  const plans = [];
  for (let n = 1; n <= WORKERS; n++) plans.push(await planForWorker(n));
  validatePartition(plans, discovered);
  process.stdout.write('shard plan validated: complete, disjoint, no phantoms\n');
  phases.mark('plan');

  let results = [];
  let setupError = null;

  try {
    // HIGIENE: remove residuo de execucao anterior que possa ter morrido sem cleanup.
    await withAdmin(async (client) => {
      const dropped = await dropAllEphemeral(client);
      if (dropped > 0) process.stdout.write(`cleanup: dropped ${dropped} stale ephemeral databases\n`);
    });

    phases.mark('hygiene');

    // TEMPLATE: migrations aplicadas UMA vez. O script de migracao usa TEST_DATABASE_URL.
    process.stdout.write(`applying migrations once into ${TEMPLATE_DB}\n`);
    await withAdmin(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${TEMPLATE_DB}" WITH (FORCE)`);
      await client.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
    });

    await new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['db:migrate:test'], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, TEST_DATABASE_URL: adminUrlFor(TEMPLATE_DB) },
        shell: process.platform === 'win32',
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`migrations into template failed with exit ${code}`)),
      );
    });

    // CLONES: cada worker recebe banco fisicamente distinto.
    await withAdmin(async (client) => {
      await terminateTemplateConnections(client);
      for (let n = 1; n <= WORKERS; n++) {
        await client.query(`CREATE DATABASE "${dbName(n)}" TEMPLATE "${TEMPLATE_DB}"`);
      }
    });
    process.stdout.write(`cloned ${WORKERS} ephemeral databases from template\n`);
    phases.mark('migrate+clone');

    // WORKERS EM PARALELO. O paralelismo esta ENTRE workers, nao dentro deles.
    //
    // CONCORRENCIA CONTROLADA, NAO `Promise.all` CEGO.
    //
    // Disparar 8 processos de uma vez num host com menos de 8 nucleos livres faz eles competirem
    // por CPU: o tempo total sobe e o resultado parece "os testes ficaram lentos". O teto e
    // derivado dos nucleos reais (`os.availableParallelism()`), nao do numero de shards — shard e
    // unidade de ISOLAMENTO (um database cada), nao unidade de concorrencia.
    //
    // `INTEGRATION_MAX_CONCURRENCY` permite ajustar por medicao sem mexer no codigo.
    const cores = availableParallelism();
    const configured = Number(process.env['INTEGRATION_MAX_CONCURRENCY'] ?? 0);
    const maxConcurrency = configured > 0 ? Math.min(configured, WORKERS) : Math.min(cores, WORKERS);
    process.stdout.write(
      `concurrency: ${maxConcurrency} simultaneous worker(s) ` +
        `(cores=${cores}, workers=${WORKERS}, override=${configured || 'auto'})\n`,
    );

    const queue = Array.from({ length: WORKERS }, (_, i) => i + 1);
    results = new Array(WORKERS);

    async function drain() {
      for (;;) {
        const n = queue.shift();
        if (n === undefined) return;
        results[n - 1] = await runWorker(n, plans[n - 1]);
      }
    }
    await Promise.all(Array.from({ length: maxConcurrency }, drain));

    const integrationSec = Math.round(((Date.now() - startedAt) / 1000) * 10) / 10;
    phases.mark("workers");
    const metrics = writeMetrics(results, integrationSec, discovered.length, phases.all);

    process.stdout.write('\n');
    for (const r of results) {
      process.stdout.write(
        `  worker ${r.worker}: specs=${r.specs} exit=${r.exitCode} sec=${r.sec}\n`,
      );
    }
    process.stdout.write(
      `  slowest=${metrics.slowestShardSec}s fastest=${metrics.fastestShardSec}s ` +
        `runnerSeconds=${metrics.runnerSeconds} wall=${integrationSec}s\n`,
    );
  } catch (error) {
    setupError = error;
  } finally {
    // CLEANUP OBRIGATORIO — mesmo com setupError, mesmo com worker morto.
    try {
      await withAdmin(async (client) => {
        const dropped = await dropAllEphemeral(client);
        process.stdout.write(`cleanup: dropped ${dropped} ephemeral databases\n`);
      });
    } catch (cleanupError) {
      // Falha de cleanup compromete o isolamento do proximo run: isso e falha, nao aviso.
      process.stderr.write(`cleanup failed: ${String(cleanupError)}\n`);
      if (!setupError) setupError = cleanupError;
    }
  }

  if (setupError) {
    process.stderr.write(`integration executor failed: ${setupError.message}\n`);
    process.exit(1);
  }

  const failed = results.filter((r) => r.exitCode !== 0);
  if (failed.length > 0) {
    process.stderr.write(
      `integration executor: ${failed.length} worker(s) failed: ` +
        failed.map((r) => `w${r.worker}(exit=${r.exitCode}${r.signal ? ` signal=${r.signal}` : ''})`).join(', ') +
        '\n',
    );
    process.exit(1);
  }

  const covered = results.reduce((sum, r) => sum + r.specs, 0);
  if (covered !== discovered.length) {
    process.stderr.write(`coverage mismatch: executed ${covered} of ${discovered.length} specs\n`);
    process.exit(1);
  }

  process.stdout.write(`integration executor: all ${discovered.length} specs passed\n`);
}

main().catch((error) => {
  process.stderr.write(`integration executor crashed: ${error?.stack ?? error}\n`);
  process.exit(1);
});

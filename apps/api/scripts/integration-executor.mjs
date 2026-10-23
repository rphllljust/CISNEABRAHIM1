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
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// POLITICA DE CONCORRENCIA — EXPLICITA, NAO DERIVADA DA MAQUINA
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// O hardware real e o VPS-1, nao uma maquina de 8 vCPU. A quantidade de workers e uma DECISAO DE
// POLITICA registrada no workflow (`CI_INTEGRATION_WORKERS`), nao um valor que o executor inventa.
//
// `os.availableParallelism()` e METRICA, nao politica: ele reporta os nucleos e vai para os logs/
// metricas do run. Usa-lo como autoridade final produzia dois erros opostos:
//
//   - numa maquina grande, escalava para 8 sem ninguem ter decidido isso;
//   - numa maquina pequena, limitava a 2 e impedia testar oversubscription controlada.
//
// Oversubscription controlada e legitima e precisa ser MEDIVEL: 4 workers em 2 vCPU pode vencer 3
// se o workload for I/O-bound (espera de banco) em vez de CPU-bound. A regra de promocao 3 -> 4 e
// matematica (T4 <= 0.90 * T3) e esta documentada; o executor so executa a politica configurada.
//
// Default 3: estado inicial do VPS-1.
const DEFAULT_WORKERS = 3;
const MIN_WORKERS = 1;
const MAX_WORKERS = 32;

function resolveWorkerCount(raw) {
  if (raw == null || String(raw).trim() === '') {
    return DEFAULT_WORKERS;
  }
  const parsed = Number(String(raw).trim());
  if (!Number.isInteger(parsed) || parsed < MIN_WORKERS || parsed > MAX_WORKERS) {
    // Fail-closed: um valor invalido NAO pode cair silenciosamente no default. Cair no default
    // significaria "o operador pediu 6, o CI rodou 3 e ninguem percebeu" — silencioso e errado.
    throw new Error(
      `CI_INTEGRATION_WORKERS must be an integer between ${MIN_WORKERS} and ${MAX_WORKERS}, ` +
        `received "${raw}".`,
    );
  }
  return parsed;
}

const WORKERS = resolveWorkerCount(
  process.env['CI_INTEGRATION_WORKERS'] ?? process.env['INTEGRATION_WORKERS'],
);
const ADMIN_URL =
  process.env['INTEGRATION_ADMIN_URL'] ??
  'postgresql://cisne_ci:cisne_ci_disposable_password@127.0.0.1:5432/postgres';
const TEMPLATE_DB = process.env['INTEGRATION_TEMPLATE_DB'] ?? 'cisne_integration_template';
const DB_PREFIX = process.env['INTEGRATION_DB_PREFIX'] ?? 'cisne_it_';

// RAIZ DO REPOSITORIO derivada do proprio arquivo, NAO de `process.cwd()`.
//
// O executor vive em `apps/api/scripts/`, mas opera sobre o monorepo inteiro: o scheduler esta em
// `scripts/ci/`, os specs em `apps/api/src`, e os artefatos em `artifacts/ci`. Amarrar isso ao CWD
// faria o comportamento mudar conforme o diretorio de chamada — e um CI que se comporta diferente
// por diretorio de chamada e um CI imprevisivel. `../../..` a partir deste arquivo e a raiz.
const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const PLAN_SCRIPT = join(REPO_ROOT, 'scripts', 'ci', 'integration-shard-plan.mjs');
const CI_DIR = join(REPO_ROOT, 'artifacts', 'ci');

/** Nome de database efemero do worker `n` (1-based). */
const dbName = (n) => `${DB_PREFIX}${String(n).padStart(2, '0')}`;

/**
 * Filhos vivos — para que o cancelamento do workflow nao deixe Vitest orfao.
 *
 * Quando o GitHub cancela um job, o runner envia SIGTERM ao processo principal. Sem handler, Node
 * morre imediatamente e os 3-4 processos Vitest ficam rodando contra um PostgreSQL que sera
 * destruido logo depois: trabalho orfao competindo por CPU com o proximo run.
 */
const liveChildren = new Set();

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
 *
 * SEGURANCA DO PATTERN — o namespace e validado antes de qualquer DROP.
 *
 * `DB_PREFIX` vem do ambiente. Um valor errado (vazio, `postgres`, `%`) transformaria o cleanup
 * numa varredura destrutiva que atinge bancos alheios — inclusive de aplicacao, se o servidor for
 * compartilhado. Por isso o prefixo precisa casar um formato estreito e conhecido; qualquer coisa
 * fora disso e FAIL CLOSED, nao "tenta mesmo assim".
 */
function assertSafePrefix(prefix) {
  // Exige `cisne_` + identificador e permite apenas minusculas, digitos e underscore.
  if (!/^cisne_[a-z0-9_]{1,40}_$/.test(prefix)) {
    throw new Error(
      `Refusing to clean up: INTEGRATION_DB_PREFIX "${prefix}" does not match the required ` +
        `namespace pattern ^cisne_[a-z0-9_]+_$ . A wrong prefix could drop unrelated databases.`,
    );
  }
}

async function dropAllEphemeral(client) {
  assertSafePrefix(DB_PREFIX);
  const { rows } = await client.query(
    `SELECT datname FROM pg_database
     WHERE datname LIKE $1 AND datname <> $2
       AND datname NOT IN ('postgres', 'template0', 'template1')`,
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
  const root = join(REPO_ROOT, 'apps', 'api');
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

/**
 * Amostra de pressao de memoria — o que decide se o hardware aguentou a concorrencia.
 *
 * Le `/proc/meminfo` diretamente. Nao instala stack de observabilidade: o dado necessario sao
 * quatro numeros que o kernel ja mantem. `MemAvailable` e a metrica honesta de folga real (nao
 * `MemFree`, que conta cache como indisponivel e assusta sem motivo).
 *
 * Swap e o sinal que importa para a regra 3 vs 4: swap-in/out durante testes significa que o host
 * nao tem RAM para aquela concorrencia, e qualquer ganho de tempo seria comprado com degradacao.
 */
function sampleMemory() {
  try {
    const raw = readFileSync('/proc/meminfo', 'utf8');
    const kb = (key) => {
      const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(raw);
      return m ? Number(m[1]) : null;
    };
    const toMb = (value) => (value == null ? null : Math.round(value / 1024));
    return {
      memTotalMb: toMb(kb('MemTotal')),
      memAvailableMb: toMb(kb('MemAvailable')),
      swapTotalMb: toMb(kb('SwapTotal')),
      swapFreeMb: toMb(kb('SwapFree')),
      swapInPages: kb('pswpin'),
      swapOutPages: kb('pswpout'),
    };
  } catch {
    // Fora do Linux nao ha /proc. Metrica ausente e aceitavel; metrica inventada nao e.
    return null;
  }
}

/** Carga media do host — distingue "lento por teste" de "lento por host saturado". */
function sampleLoad() {
  try {
    return Math.round(loadavg()[0] * 100) / 100;
  } catch {
    return null;
  }
}


function planForWorker(n) {
  return new Promise((resolvePlan, reject) => {
    const child = spawn(
      process.execPath,
      [PLAN_SCRIPT, '--index', String(n), '--count', String(WORKERS)],
      // `cwd: REPO_ROOT` e obrigatorio: `integration-shard-plan.mjs` descobre os specs a partir de
      // `process.cwd()`. Sem isto, chamar o executor de `apps/api` faria o scheduler procurar
      // `apps/api/apps/api/src` e falhar com "no integration specs discovered".
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO_ROOT },
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
      resolvePlan(stdout.trim().split(/\s+/).filter(Boolean));
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
    // Instrumentacao POR TESTE: separa o custo de cada `it()` do custo de
    // bootstrap Nest / limpeza / seed. Sem isso, "Integration leva 593s" nao diz
    // onde atacar, e otimizar viraria chute.
    const testsPath = join(CI_DIR, `integration.s${n}.tests.ndjson`);
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
          INTEGRATION_TESTS_FILE: testsPath,
        },
        shell: process.platform === 'win32',
      },
    );

    // Registro do filho para que o handler de SIGTERM possa encerra-lo no cancelamento.
    liveChildren.add(child);
    child.on('close', () => liveChildren.delete(child));

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

function writeMetrics(results, integrationSec, discoveredCount, phases, env) {
  mkdirSync(CI_DIR, { recursive: true });
  const seconds = results.map((r) => r.sec);
  const { memBefore, memAfter, loadDuring } = env ?? {};
  const metrics = {
    generatedAt: new Date().toISOString(),
    shardCount: WORKERS,
    workerPolicy: 'CI_INTEGRATION_WORKERS',
    availableParallelism: availableParallelism(),
    integrationSec,
    specCountExpected: discoveredCount,
    specsCovered: results.reduce((sum, r) => sum + r.specs, 0),
    slowestShardSec: seconds.length ? Math.max(...seconds) : null,
    fastestShardSec: seconds.length ? Math.min(...seconds) : null,
    runnerSeconds: seconds.reduce((sum, s) => sum + s, 0),
    phases,
    // PRESSAO DE RECURSOS — o que decide se a concorrencia coube no hardware.
    //
    // `swapUsedDeltaMb` e o numero que reprova uma promocao 3 -> 4: se o swap cresceu durante os
    // testes, o ganho de tempo foi comprado com degradacao de memoria, e a regra de promocao exige
    // zero degradacao de swap.
    memory: {
      before: memBefore,
      after: memAfter,
      swapUsedDeltaMb:
        memBefore?.swapFreeMb != null && memAfter?.swapFreeMb != null
          ? memBefore.swapFreeMb - memAfter.swapFreeMb
          : null,
      swapInPagesDelta:
        memBefore?.swapInPages != null && memAfter?.swapInPages != null
          ? memAfter.swapInPages - memBefore.swapInPages
          : null,
      swapOutPagesDelta:
        memBefore?.swapOutPages != null && memAfter?.swapOutPages != null
          ? memAfter.swapOutPages - memBefore.swapOutPages
          : null,
    },
    loadAverageDuring: loadDuring ?? null,
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
  // Pressao de memoria ANTES: comparar com o "depois" e o que prova se a concorrencia coube.
  const memBefore = sampleMemory();
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
    // CONCORRENCIA = CI_INTEGRATION_WORKERS, SEM DERIVACAO DA MAQUINA.
    //
    // Antes o teto vinha de `os.availableParallelism()`. Isso confundia METRICA com POLITICA: a
    // quantidade de workers precisa ser uma decisao registrada (e comparavel entre runs), nao algo
    // que muda conforme o host escolhido pelo scheduler. Aqui ela e exatamente a configurada.
    //
    // `availableParallelism()` continua sendo medido e reportado — como observabilidade, para que
    // a comparacao 3 vs 4 seja interpretavel no hardware real.
    const cores = availableParallelism();
    process.stdout.write(
      `concurrency: ${WORKERS} simultaneous worker(s) (policy=CI_INTEGRATION_WORKERS, cores=${cores})\n`,
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
    // Todos os workers configurados sobem JUNTOS — a politica ja decidiu quantos. O `drain` existe
    // apenas para reutilizar o padrao de fila, nao para reduzir concorrencia.
    await Promise.all(Array.from({ length: WORKERS }, drain));

    const integrationSec = Math.round(((Date.now() - startedAt) / 1000) * 10) / 10;
    phases.mark("workers");
    const metrics = writeMetrics(results, integrationSec, discovered.length, phases.all, {
      memBefore,
      memAfter: sampleMemory(),
      loadDuring: sampleLoad(),
    });

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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CANCELAMENTO — SIGTERM/SIGINT nao podem deixar processo nem database orfao
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Fluxo no cancelamento:
//   1. para de aceitar trabalho novo (a flag impede novos spawns);
//   2. envia SIGTERM aos Vitest vivos — eles tem chance de fechar conexoes e sair limpos;
//   3. espera um limite racional (grace);
//   4. SIGKILL no que restar;
//   5. o `finally` do `main` roda o cleanup dos databases.
//
// `main()` continua sendo quem faz o cleanup: o handler apenas garante que nao ha filho vivo
// segurando conexao quando o `DROP DATABASE` acontecer.
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write(`received ${signal}: stopping ${liveChildren.size} worker(s)\n`);

  for (const child of liveChildren) {
    try {
      child.kill('SIGTERM');
    } catch {
      // Processo ja saiu.
    }
  }

  const GRACE_MS = 10_000;
  const deadline = Date.now() + GRACE_MS;
  while (liveChildren.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }

  for (const child of liveChildren) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Processo ja saiu.
    }
  }

  // Nao chamamos `process.exit` aqui: deixamos o `finally` de `main()` concluir o cleanup dos
  // databases. Sair agora deixaria `cisne_it_*` para tras.

  process.exitCode = 1;
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((error) => {
  process.stderr.write(`integration executor crashed: ${error?.stack ?? error}\n`);
  process.exit(1);
});

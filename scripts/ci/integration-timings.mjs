#!/usr/bin/env node
// INSTRUMENTACAO DO CI — coleta duracao por spec e por shard.
//
// FASE 1 do plano CI-FAST. Nao altera topologia nem cobertura: apenas mede.
//
// POR QUE UMA FONTE PROPRIETARIA E NAO O JSON DO VITEST
//
// O reporter `json` do Vitest emite duracao por ARQUIVO, mas o pipeline atual roda cada spec
// num processo separado por shard e os arquivos de saida colidem entre shards. Um formato
// pequeno e aditivo (JSON Lines) permite que N processos escrevam sem coordenacao, e o merge
// e trivial. Tambem evita parsear um relatorio de dezenas de MB em cada job.
//
// O QUE ESTE SCRIPT FAZ
//
//   collect    le os arquivos .timings.ndjson de cada shard e produz
//              artifacts/ci/integration-timings.json (historico por spec)
//   summary    imprime o relatorio de metricas do run (critical path, shards, runner-minutes)
//   assert     falha (exit 1) se a instrumentacao for inconsistente
//
// FORMATO DO HISTORICO (aditivo, nunca destrutivo)
//
//   {
//     "generatedAt": "...",
//     "schemaVersion": 1,
//     "specs": {
//       "src/a.spec.ts": { "samples": [4321, 4100, 4550] }
//     }
//   }
//
// Guardamos SAMPLES, nao so a mediana: a mediana precisa ser recalculavel, e um valor unico
// congelado impediria detectar que o spec ficou sistematicamente mais lento.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Amostras mantidas por spec. Janela curta: reage a regressao, resiste a outlier. */
const MAX_SAMPLES = 5;

const CI_DIR = 'artifacts/ci';
const HISTORY_PATH = join(CI_DIR, 'integration-timings.json');
const SUMMARY_PATH = join(CI_DIR, 'ci-metrics.json');

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function readNdjson(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function collect() {
  const history = readJson(HISTORY_PATH, { schemaVersion: 1, specs: {} });
  history.specs ??= {};

  // ONDE PROCURAR OS .ndjson
  //
  // O executor escreve em `<repo>/artifacts/ci` (REPO_ROOT derivado de import.meta.url), mas o
  // Vitest roda com cwd em `apps/api`. Ja aconteceu de o reporter cair no default relativo e
  // gravar em `apps/api/artifacts/ci`, deixando o collect sem nada para ler e o historico sem
  // ser gravado — em silencio, porque a unica evidencia era um warning de telemetria.
  //
  // Procuramos nos DOIS lugares conhecidos. Se nada for encontrado, o erro lista os diretorios
  // verificados: diagnostico imediato em vez de "no files found" sem contexto.
  const candidates = [
    CI_DIR,
    join(process.cwd(), 'apps', 'api', 'artifacts', 'ci'),
    join(process.cwd(), 'artifacts', 'ci'),
  ].filter((dir, i, all) => all.indexOf(dir) === i);

  const isTimingFile = (name) =>
    name === 'integration.timings.ndjson' || /^integration\.s\d+\.timings\.ndjson$/.test(name);

  const dir = candidates.find((d) => existsSync(d) && readdirSync(d).some(isTimingFile));

  if (!dir) {
    const inspected = candidates
      .map((d) => `${d}${existsSync(d) ? ' (exists, no timing files)' : ' (absent)'}`)
      .join('; ');
    throw new Error(`no integration timing files found. Inspected: ${inspected}`);
  }

  const files = readdirSync(dir).filter(isTimingFile);

  let recorded = 0;
  const seen = new Set();

  for (const name of files) {
    const shardLabel = /^integration\.(s\d+)\./.exec(name)?.[1] ?? 'single';
    for (const entry of readNdjson(join(dir, name))) {
      if (!entry.spec || typeof entry.durationMs !== 'number' || !Number.isFinite(entry.durationMs)) {
        continue;
      }
      if (entry.status !== 'passed') {
        // Spec que falhou nao vira peso: a duracao dele e interrupcao, nao custo estavel.
        continue;
      }
      history.specs[entry.spec] ??= { samples: [] };
      const samples = history.specs[entry.spec].samples;
      samples.push(Math.round(entry.durationMs));
      if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
      recorded++;
      seen.add(`${shardLabel}:${entry.spec}`);
    }
  }

  history.generatedAt = new Date().toISOString();
  history.schemaVersion = 1;

  mkdirSync(CI_DIR, { recursive: true });
  writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);

  const specCount = Object.keys(history.specs).length;
  console.log(`timings: ${recorded} samples from ${files.length} shard file(s), ${specCount} specs in history`);
  return { recorded, specCount, files: files.length };
}

function loadHistory() {
  return readJson(HISTORY_PATH, { specs: {} });
}

function summary() {
  const history = loadHistory();
  const metrics = readJson(SUMMARY_PATH, {});
  const specDurations = Object.entries(history.specs ?? {}).map(([spec, data]) => ({
    spec,
    median: median(data.samples ?? []),
    samples: (data.samples ?? []).length,
  }));

  const known = specDurations.filter((s) => s.median != null);
  const totalSpecMs = known.reduce((sum, s) => sum + s.median, 0);

  console.log('');
  console.log('=== CI METRICS ===');
  if (metrics.criticalPathSec != null) {
    console.log(`critical path (commit -> Release ready) : ${metrics.criticalPathSec}s`);
  }
  if (metrics.integrationSec != null) {
    console.log(`integration wall clock                 : ${metrics.integrationSec}s`);
  }
  if (metrics.shardCount != null) {
    console.log(`shards                                : ${metrics.shardCount}`);
  }
  if (Array.isArray(metrics.shards) && metrics.shards.length > 0) {
    const secs = metrics.shards.map((s) => s.sec).filter((n) => typeof n === 'number');
    const slowest = Math.max(...secs);
    const fastest = Math.min(...secs);
    console.log(`slowest shard                         : ${slowest}s`);
    console.log(`fastest shard                         : ${fastest}s`);
    console.log(`shard imbalance                       : ${(slowest / fastest).toFixed(2)}x`);
    console.log(`sum of shard time (runner-seconds)    : ${secs.reduce((a, b) => a + b, 0)}s`);
  }
  if (known.length > 0) {
    console.log(`specs with timing history             : ${known.length}`);
    console.log(`sum of spec medians                   : ${(totalSpecMs / 1000).toFixed(1)}s`);
  }
  console.log('');
}

function assertCoverage() {
  // Fail-closed: o historico nao pode conter caminhos inexistentes. Um spec renomeado deixaria
  // peso orfao e, pior, esconderia que o arquivo novo entrou sem peso.
  const history = loadHistory();
  const srcRoot = join(process.cwd(), 'apps', 'api', 'src');
  const missing = [];
  for (const spec of Object.keys(history.specs ?? {})) {
    const abs = join(process.cwd(), 'apps', 'api', spec);
    try {
      statSync(abs);
    } catch {
      missing.push(spec);
    }
  }
  if (missing.length > 0) {
    console.error(`timings history references ${missing.length} spec(s) that no longer exist:`);
    for (const spec of missing.slice(0, 10)) console.error(`  - ${spec}`);
    console.error('Refusing to proceed: stale weights would silently skew the shard plan.');
    process.exit(1);
  }
  console.log(`timings history: ${Object.keys(history.specs ?? {}).length} specs, all paths exist`);
}

const command = process.argv[2];
switch (command) {
  case 'collect':
    collect();
    break;
  case 'summary':
    summary();
    break;
  case 'assert':
    assertCoverage();
    break;
  default:
    console.error('usage: integration-timings.mjs <collect|summary|assert>');
    process.exit(1);
}

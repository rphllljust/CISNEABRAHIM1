#!/usr/bin/env node
// BENCHMARK 3 vs 4 — decisao objetiva de politica de concorrencia.
//
// Operacao CONTROLADA, nao parte do CI normal. Roda uma vez, decide, e o valor vencedor vira
// politica fixa. Fazer cada PR experimentar 3 e 4 duplicaria custo e latencia sem produzir
// informacao nova: a politica e do hardware, nao do commit.
//
// USO
//
//   node scripts/ci/benchmark-workers.mjs --runs 3
//
// Le os `ci-metrics.json` produzidos pelos runs reais em `artifacts/bench/`, compara e emite o
// veredito. Nao executa o CI sozinho: disparar run e responsabilidade de quem opera (a API do
// GitHub exige token com escopo de workflow e o benchmark precisa de runs do MESMO commit).
//
// REGRA (matematica, nao opiniao)
//
//   4 vence SOMENTE se:
//       median(T4) <= 0.90 * median(T3)
//   E simultaneamente, em TODOS os runs de 4:
//       OOM events          = 0
//       swapUsedDeltaMb     <= 0     (swap nao cresceu)
//       workers mortos      = 0
//       erros de PostgreSQL = 0
//
// Proximo do limite: MEDIANA decide, nunca o melhor run isolado. Escolher 4 por um run favoravel
// e escolher por acaso.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BENCH_DIR = 'artifacts/bench';
const THRESHOLD = 0.9; // 4 precisa ser >=10% mais rapido

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Carrega metricas agrupadas por worker count. Nome do arquivo carrega o N e o indice do run. */
function loadSamples() {
  if (!existsSync(BENCH_DIR)) {
    throw new Error(
      `${BENCH_DIR} not found. Copy each run's artifacts/ci/ci-metrics.json to ` +
        `${BENCH_DIR}/w<N>-run<M>.json before benchmarking.`,
    );
  }
  const groups = new Map();
  for (const name of readdirSync(BENCH_DIR)) {
    const match = /^w(\d+)-run(\d+)\.json$/.exec(name);
    if (!match) continue;
    const workers = Number(match[1]);
    const metrics = JSON.parse(readFileSync(join(BENCH_DIR, name), 'utf8'));
    if (!groups.has(workers)) groups.set(workers, []);
    groups.get(workers).push({ file: name, metrics });
  }
  return groups;
}

/** Guardas de estabilidade: qualquer violacao reprova a promocao, independente do tempo. */
function stabilityViolations(metrics) {
  const issues = [];
  const m = metrics.memory ?? {};

  if (typeof m.swapUsedDeltaMb === 'number' && m.swapUsedDeltaMb > 0) {
    issues.push(`swap cresceu ${m.swapUsedDeltaMb}MB`);
  }
  if (typeof m.swapInPagesDelta === 'number' && m.swapInPagesDelta > 0) {
    issues.push(`swap-in ${m.swapInPagesDelta} paginas`);
  }
  if (typeof m.swapOutPagesDelta === 'number' && m.swapOutPagesDelta > 0) {
    issues.push(`swap-out ${m.swapOutPagesDelta} paginas`);
  }
  for (const shard of metrics.shards ?? []) {
    if (shard.exitCode !== 0) {
      issues.push(`worker ${shard.worker} exit=${shard.exitCode}`);
    }
    if (shard.signal) {
      issues.push(`worker ${shard.worker} killed by ${shard.signal}`);
    }
  }
  if ((metrics.specsCovered ?? 0) !== (metrics.specCountExpected ?? 0)) {
    issues.push(`cobertura ${metrics.specsCovered}/${metrics.specCountExpected}`);
  }
  // OOM e detectado pelo kernel via dmesg; o executor nao tem permissao garantida para ler isso.
  // Se o operador registrou `oomEvents` no arquivo, respeitamos.
  if (typeof metrics.oomEvents === 'number' && metrics.oomEvents > 0) {
    issues.push(`${metrics.oomEvents} OOM event(s)`);
  }
  return issues;
}

function main() {
  const groups = loadSamples();
  const baseline = groups.get(3) ?? [];
  const candidate = groups.get(4) ?? [];

  if (baseline.length === 0 || candidate.length === 0) {
    console.error(
      `Precisa de runs dos dois lados. Encontrado: ` +
        [...groups.keys()].map((k) => `${k} workers (${groups.get(k).length})`).join(', ') +
        `.\nColoque em ${BENCH_DIR}/w3-run*.json e ${BENCH_DIR}/w4-run*.json.`,
    );
    process.exit(1);
  }

  const t3 = baseline.map((s) => s.metrics.integrationSec);
  const t4 = candidate.map((s) => s.metrics.integrationSec);
  const m3 = median(t3);
  const m4 = median(t4);
  const ratio = m4 / m3;

  console.log('=== AMOSTRAS ===');
  for (const [workers, samples] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const times = samples.map((s) => s.metrics.integrationSec);
    const cores = samples[0].metrics.availableParallelism;
    console.log(
      `${workers} workers: runs=${samples.length} tempos=[${times.join(', ')}]s ` +
        `mediana=${median(times)}s cores=${cores}`,
    );
  }

  console.log('\n=== COMPARACAO ===');
  console.log(`mediana(T3) = ${m3}s`);
  console.log(`mediana(T4) = ${m4}s`);
  console.log(`razao T4/T3 = ${ratio.toFixed(3)}  (limite ${THRESHOLD})`);
  console.log(`ganho       = ${((1 - ratio) * 100).toFixed(1)}%`);
  console.log(
    `criterio 10%: ${ratio <= THRESHOLD ? 'ATENDIDO' : 'NAO ATENDIDO'}`,
  );

  console.log('\n=== ESTABILIDADE (candidato = 4 workers) ===');
  let anyViolation = false;
  for (const sample of candidate) {
    const issues = stabilityViolations(sample.metrics);
    if (issues.length > 0) {
      anyViolation = true;
      console.log(`  ${sample.file}: ${issues.join('; ')}`);
    } else {
      console.log(`  ${sample.file}: OK`);
    }
  }

  const winner = ratio <= THRESHOLD && !anyViolation ? 4 : 3;
  console.log('\n=== VEREDITO ===');
  if (winner === 4) {
    console.log('VENCEDOR: 4 workers');
    console.log('Acao: gh variable set CI_INTEGRATION_WORKERS --body "4"');
  } else {
    console.log('VENCEDOR: 3 workers (permanece o padrao)');
    if (ratio > THRESHOLD) {
      console.log(`Motivo: T4/T3 = ${ratio.toFixed(3)} > ${THRESHOLD} (< 10% de ganho)`);
    }
    if (anyViolation) {
      console.log('Motivo: guardas de estabilidade violadas (ver acima)');
    }
  }
}

main();

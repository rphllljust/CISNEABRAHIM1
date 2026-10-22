// INSTRUMENTACAO POR TESTE — irmA do ci-timings-reporter, mas no nivel de `it()`.
//
// O reporter atual mede duracao por ARQUIVO. Para atacar o custo do Integration
// (593s no executor, 1210s de soma dos specs) precisamos saber se o tempo esta em
// poucos `it()` caros, no `beforeAll` (bootstrap Nest) ou no `beforeEach`
// (limpeza/seed). Sem esse dado, qualquer otimizacao e chute.
//
// Sondagem de API do Vitest 3.2.7 (mesma licao do reporter irmao): o hook
// `onTestRunEnd` recebe a lista COMPLETA de modulos, e cada modulo tem
// `children` com as tarefas. Varrer a arvore e mais robusto do que depender de
// hooks por tarefa, que o Vitest nao garante para reporter externo.
//
// Saida: NDJSON com { spec, name, durationMs, hookMs, type }. `hookMs` agrega o
// tempo dos hooks do arquivo (beforeAll/beforeEach/afterEach/afterAll), que e onde
// o bootstrap Nest e a limpeza de banco aparecem.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

function normalize(moduleId) {
  const posix = String(moduleId ?? '').replace(/\\/g, '/');
  const marker = '/apps/api/';
  const idx = posix.indexOf(marker);
  return idx >= 0 ? posix.slice(idx + marker.length) : posix;
}

function moduleIdOf(mod) {
  const raw = mod?.moduleId;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'function') return raw.call(mod);
  if (typeof mod?.id === 'string') return mod.id;
  return undefined;
}

/** Coleta recursivamente os `it()` de um arquivo, com o nome do bloco. */
function collectTests(task, prefix, out) {
  for (const child of task?.children ?? []) {
    const name = child?.name ?? '';
    if (child?.type === 'test') {
      const diagnostic = typeof child?.diagnostic === 'function' ? child.diagnostic() : {};
      out.push({
        name: [...prefix, name].join(' > '),
        durationMs: Math.round(diagnostic?.duration ?? 0),
        state: diagnostic?.state ?? 'unknown',
        type: 'test',
      });
      continue;
    }
    // describe e suites: desce mantendo o caminho
    if (Array.isArray(child?.children) && child.children.length > 0) {
      collectTests(child, [...prefix, name].filter(Boolean), out);
    }
  }
}

export default class CiTestTimingsReporter {
  constructor(options = {}) {
    const requested = options.outputPath ?? 'artifacts/ci/integration.tests.ndjson';
    this.outputPath = isAbsolute(requested) ? requested : join(process.cwd(), requested);
  }

  onTestRunEnd(testModules) {
    try {
      const records = [];
      for (const mod of testModules ?? []) {
        const spec = normalize(moduleIdOf(mod));
        if (!spec) continue;
        const tests = [];
        collectTests(mod, [], tests);
        for (const t of tests) {
          records.push({ spec, ...t, at: new Date().toISOString() });
        }
      }

      if (records.length === 0) {
        process.stderr.write(
          '::warning title=CI test timings::no tests collected at run end\n',
        );
        return;
      }

      mkdirSync(dirname(this.outputPath), { recursive: true });
      appendFileSync(this.outputPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
      process.stderr.write(
        `::notice title=CI test timings::wrote ${records.length} test records\n`,
      );
    } catch (error) {
      process.stderr.write(
        `::warning title=CI test timings::failed: ${error?.message ?? error}\n`,
      );
    }
  }
}

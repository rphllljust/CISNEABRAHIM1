// COLETOR DE DURACAO POR SPEC — reporter do Vitest 3.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// DOIS ERROS DE API CORRIGIDOS AQUI (ambos medidos, nao supostos)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ERRO 1 — hook errado
//
//   A versao anterior usava `onTestModuleEnd`. Ele existe na interface `Reporter` da 3.2.7, mas
//   para reporter EXTERNO neste projeto o Vitest nunca o invoca. Medido com reporter inline
//   (objeto direto na config, eliminando a variavel "arquivo nao carregado"):
//
//       CONFIG_LOADED        ok
//       HOOK_onTestRunEnd    ok
//       HOOK_onFinished      ok
//       HOOK_onTestModuleEnd NUNCA
//
//   `onTestRunEnd(testModules, ...)` e chamado no fim e recebe a lista COMPLETA de modulos.
//
// ERRO 2 — `moduleId` e PROPRIEDADE, nao metodo
//
//   Inspecionando o objeto real recebido no hook:
//
//       own keys     = ["task","project","id","location","children","type","moduleId"]
//       proto methods= ["constructor","state","diagnostic"]
//       moduleId     = string      <- PROPRIEDADE
//
//   A versao anterior chamava `mod.moduleId()` -> "moduleId is not a function", a excecao era
//   engolida pelo `catch` que protege a suite, e NENHUM arquivo era gravado. Esse era o defeito
//   silencioso real: o reporter "funcionava" sem produzir nada.
//
//   `diagnostic()` retorna `{ duration, state }` e continua sendo um metodo.
//
// LIÇÃO REGISTRADA: um `catch` que protege a suite nao pode esconder um erro de contrato de API.
// Por isso o `catch` agora escreve um aviso no stderr alem de nao derrubar o run.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

export default class CiTimingsReporter {
  /**
   * @param {{ outputPath?: string }} [options]
   */
  constructor(options = {}) {
    const requested = options.outputPath ?? 'artifacts/ci/integration.timings.ndjson';
    // O executor passa caminho ABSOLUTO (artifacts/ci resolvido contra a raiz do repo). Um caminho
    // relativo aqui seria resolvido contra o cwd do Vitest, que e `apps/api` — o arquivo iria para
    // o lugar errado sem ninguem perceber.
    this.outputPath = isAbsolute(requested) ? requested : join(process.cwd(), requested);
  }

  /** Caminho absoluto -> caminho relativo a `apps/api`, que e a chave do historico. */
  static normalize(moduleId) {
    const posix = String(moduleId ?? '').replace(/\\/g, '/');
    const marker = '/apps/api/';
    const idx = posix.indexOf(marker);
    return idx >= 0 ? posix.slice(idx + marker.length) : posix;
  }

  /**
   * Le `moduleId` aceitando PROPRIEDADE (contrato real da 3.2.7) e, por robustez, funcao —
   * se uma versao futura mudar a forma, a instrumentacao continua funcionando.
   */
  static moduleIdOf(mod) {
    const raw = mod?.moduleId;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'function') return raw.call(mod);
    if (typeof mod?.id === 'string') return mod.id;
    return undefined;
  }

  /** Converte a lista de modulos em registros. */
  static toRecords(testModules) {
    const records = [];
    for (const mod of testModules ?? []) {
      try {
        const spec = CiTimingsReporter.normalize(CiTimingsReporter.moduleIdOf(mod));
        if (!spec) continue;

        const diagnostic = typeof mod?.diagnostic === 'function' ? mod.diagnostic() : {};
        const state = diagnostic?.state ?? (typeof mod?.state === 'function' ? mod.state() : 'unknown');

        records.push({
          spec,
          durationMs: Math.round(diagnostic?.duration ?? 0),
          status: state,
          at: new Date().toISOString(),
        });
      } catch (error) {
        // Nao derruba a suite, mas TAMBEM nao some em silencio: sem isso, um erro de contrato de
        // API viraria "instrumentacao funciona mas nao grava nada", que foi o defeito anterior.
        process.stderr.write(`::warning title=CI timings reporter::${error?.message ?? error}\n`);
      }
    }
    return records;
  }

  onTestRunEnd(testModules) {
    try {
      const records = CiTimingsReporter.toRecords(testModules);
      if (records.length === 0) {
        process.stderr.write(
          '::warning title=CI timings reporter::no test modules received at run end\n',
        );
        return;
      }

      mkdirSync(dirname(this.outputPath), { recursive: true });
      appendFileSync(this.outputPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } catch (error) {
      process.stderr.write(
        `::warning title=CI timings reporter::failed to write ${this.outputPath}: ${error?.message ?? error}\n`,
      );
    }
  }
}

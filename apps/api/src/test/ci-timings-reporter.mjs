// COLETOR DE DURACAO POR SPEC — reporter do Vitest 3.
//
// FASE 1 do plano CI-FAST. Emite JSON Lines, um arquivo por worker, sem colisao entre processos.
//
// CONTRATO DA API (lido de `reporters.d.BuRON0I0.d.ts`, interface `Reporter`, Vitest 3.2.7)
//
//   onTestModuleEnd?: (testModule: TestModule) => Awaitable<void>
//     "Called when all tests of the test file have finished running."
//
// `diagnostic()` carrega a duracao agregada do arquivo — o custo de PAREDE do spec, que e
// exatamente o peso que o scheduler LPT precisa.
//
// POR QUE NAO PARSE DE LOG
//
// A saida textual do Vitest tem cores, largura de terminal, truncamento e muda de formato entre
// versoes. O reporter recebe dados estruturados. Instrumentacao nao deve depender de formatacao
// humana.
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
    mkdirSync(dirname(this.outputPath), { recursive: true });
  }

  /** Caminho absoluto -> caminho relativo a `apps/api`, que e a chave do historico. */
  static normalize(moduleId) {
    const posix = String(moduleId ?? '').replace(/\\/g, '/');
    const marker = '/apps/api/';
    const idx = posix.indexOf(marker);
    return idx >= 0 ? posix.slice(idx + marker.length) : posix;
  }

  onTestModuleEnd(testModule) {
    try {
      const diagnostic = testModule.diagnostic?.() ?? {};
      const spec = CiTimingsReporter.normalize(testModule.moduleId?.());
      if (!spec) return;

      const state = diagnostic.state ?? (testModule.ok?.() ? 'passed' : 'failed');
      const durationMs = Math.round(diagnostic.duration ?? 0);

      appendFileSync(
        this.outputPath,
        `${JSON.stringify({ spec, durationMs, status: state, at: new Date().toISOString() })}\n`,
      );
    } catch {
      // Instrumentacao NUNCA derruba a suite. Medir e observabilidade; o gate de corretude e o
      // exit code do Vitest e a validacao do shard plan.
    }
  }
}

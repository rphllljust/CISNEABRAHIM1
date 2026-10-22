// COLETOR DE DURACAO POR SPEC — reporter do Vitest 3.
//
// FASE 1 do plano CI-FAST. Emite JSON Lines, um arquivo por shard, sem colisao entre processos.
//
// CONTRATO DA API (lido de `reporters.d.BuRON0I0.d.ts`, interface `Reporter`, Vitest 3.2.7)
//
//   onTestModuleEnd?: (testModule: TestModule) => Awaitable<void>
//     "Called when all tests of the test file have finished running."
//
// O `TestModule` expoe `moduleId()` (caminho absoluto) e `diagnostic()`, que carrega a duracao
// agregada do arquivo. Uso `diagnostic().duration` — e o custo de PAREDE do spec, que e
// exatamente o peso que o scheduler LPT precisa.
//
// POR QUE NAO PARSE DE LOG
//
// A saida textual do Vitest tem cores, largura de terminal, truncamento e pode mudar de formato
// entre versoes. O reporter recebe dados estruturados. Instrumentacao nao deve depender de
// formatacao humana.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export default class CiTimingsReporter {
  /**
   * @param {{ outputPath?: string }} [options]
   */
  constructor(options = {}) {
    this.outputPath = join(process.cwd(), options.outputPath ?? 'artifacts/ci/integration.timings.ndjson');
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

      // `failed` so entra se a duracao existir; o peso de um spec que falhou nao serve como
      // estimativa de custo (a duracao e interrupcao, nao trabalho estavel).
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

/**
 * INSTALA O CHROMIUM DO PLAYWRIGHT SEM DEPENDER DE CAMINHO FIXO NEM DE PATH.
 *
 * ──────────────────────────────────────────────────────────────────────────────────
 * DOIS DEFEITOS REAIS QUE ESTE SCRIPT RESOLVE
 * ──────────────────────────────────────────────────────────────────────────────────
 *
 * 1. `pnpm exec playwright install ...` reprovou com `pnpm: command not found`.
 *    O `pnpm/action-setup` exporta o binário apenas no escopo do SEU step de `run`; o
 *    step seguinte não herda o PATH. Com `set -euo pipefail`, o comando ausente
 *    derrubou o step e o gate nunca executou — reprovando um release com produção
 *    saudável.
 *
 * 2. `node apps/web/node_modules/@playwright/test/cli.js` reprovou com
 *    `Cannot find module`. Em pnpm workspaces o pacote pode estar em
 *    `node_modules/.pnpm/...` e o caminho direto pelo workspace nem sempre existe (no
 *    ambiente local é um junction; no runner pode não ser). Caminho fixo é suposição
 *    sobre o layout de instalação, e layout de instalação não é contrato.
 *
 * A SOLUÇÃO. Resolver o CLI pela RESOLUÇÃO DE MÓDULO do Node, a partir do workspace que
 * declara a dependência (`apps/web`). Isso é o mesmo mecanismo que qualquer `import`
 * usa: se o pacote está instalado, o Node o encontra; se não está, falha alto e cedo.
 *
 * O script NÃO instala nada por conta própria e NÃO esconde falha: se o `install`
 * retornar erro, o processo termina com o mesmo código.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const webWorkspace = resolve(repoRoot, 'apps', 'web');

/** Resolve o CLI do Playwright a partir do workspace que declara a dependência. */
function resolvePlaywrightCli() {
  const requireFromWeb = createRequire(resolve(webWorkspace, 'package.json'));
  try {
    // `@playwright/test` exporta `cli.js` no pacote; resolvemos o módulo e subimos um
    // nível, porque a entrada pública é `index.mjs`/`index.js`.
    const testEntry = requireFromWeb.resolve('@playwright/test');
    const packageDir = resolve(dirname(testEntry), '..');
    return resolve(packageDir, 'cli.js');
  } catch (error) {
    throw new Error(
      `@playwright/test nao resolve a partir de apps/web: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const cliPath = resolvePlaywrightCli();
console.log(`[playwright-install] cli=${cliPath}`);

const result = spawnSync(process.execPath, [cliPath, 'install', '--with-deps', 'chromium'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[playwright-install] falha ao executar: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  // Fail-closed: sem navegador o browser gate nao pode provar nada, e um release
  // declarado pronto sem essa prova seria falso verde.
  console.error(`[playwright-install] install falhou com codigo ${result.status}`);
  process.exitCode = result.status ?? 1;
}

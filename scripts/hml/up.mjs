/**
 * `pnpm hml:up` — subida determinística do HML.
 *
 * ANTES: o comando era `docker compose ... up -d --build --wait` invocado direto pelo pnpm.
 * Qualquer `FEATURE_MODULE_*` exportada no shell vencia `--env-file` e alterava a superfície
 * de módulos do HML em silêncio (ver `scripts/lib/hml-compose.mjs` para a causa raiz completa).
 *
 * AGORA: as chaves do contrato de release são removidas do ambiente filho antes de invocar o
 * Compose, de modo que `.env.hml` + `docker/hml/compose.yaml` sejam a única fonte de verdade.
 * PATH, HOME, DOCKER_*, credenciais e todas as demais variáveis permanecem intactas.
 *
 * Uso:
 *   pnpm hml:up            # valida a configuração resolvida e sobe
 *   pnpm hml:up --skip-gate
 */

import { runComposeDeterministic } from '../lib/hml-compose.mjs';
import { repoRoot } from '../lib/env.mjs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const COMPOSE_FILE = 'docker/hml/compose.yaml';
const ENV_FILE = '.env.hml';

const skipGate = process.argv.includes('--skip-gate');

if (!skipGate) {
  // O gate roda com o MESMO ambiente sanitizado: ele mede a configuração versionada, que é
  // exatamente o que a subida vai aplicar. Divergência entre os dois seria um falso sinal.
  const gate = spawnSync(
    process.execPath,
    [resolve(repoRoot, 'scripts/hml/verify-resolved-config.mjs'), '--allow-inherited'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      // `shell: false`: no Windows o caminho do Node contém espaço
      // (`C:\Program Files\nodejs\node.exe`) e o shell o quebraria em `C:\Program`.
      shell: false,
    },
  );

  if ((gate.status ?? 1) !== 0) {
    process.stderr.write(
      '\n[hml:up] Subida ABORTADA: a configuração resolvida não passou no gate.\n' +
        '         Nenhum container foi criado ou alterado.\n',
    );
    process.exit(gate.status ?? 1);
  }
}

const status = runComposeDeterministic([
  '-f',
  COMPOSE_FILE,
  '--env-file',
  ENV_FILE,
  'up',
  '-d',
  '--build',
  '--wait',
]);

process.exit(status);

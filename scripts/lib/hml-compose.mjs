/**
 * Lançador determinístico do Docker Compose para o CISNE.
 *
 * ============================================================================================
 * CAUSA RAIZ QUE ESTE MÓDULO RESOLVE
 * ============================================================================================
 *
 * O Docker Compose resolve interpolação `${VAR}` nesta ordem de precedência:
 *
 *     ambiente do processo  >  --env-file  >  valor default do compose
 *
 * `FEATURE_MODULE_*` e `VITE_FEATURE_MODULE_*` pertencem ao contrato de release e são
 * controladas pelos arquivos versionados (`.env.hml`, `docker/hml/compose.yaml`). Quando
 * elas estão EXPORTADAS no shell que invoca o Compose, o valor do shell vence o arquivo
 * em silêncio: a configuração versionada deixa de ser fonte de verdade e o HML sobe com
 * uma superfície diferente da declarada — sem erro, sem aviso.
 *
 * Foi exatamente o defeito observado: `.env.hml` dizia `FEATURE_MODULE_RENTALS=false` e
 * `docker compose config` resolvia `true`, porque o processo pai exportava a variável.
 *
 * ============================================================================================
 * ESCOPO DA SANITIZAÇÃO — DELIBERADAMENTE ESTREITO
 * ============================================================================================
 *
 * Este módulo REMOVE do ambiente filho SOMENTE as chaves do contrato de release
 * (`FEATURE_MODULE_*` e `VITE_FEATURE_MODULE_*` reconhecidas pela lista canônica).
 *
 * NÃO toca em: PATH, HOME, USERPROFILE, DOCKER_*, DOCKER_HOST, DOCKER_CONTEXT, credenciais,
 * proxy, TLS, ou qualquer outra variável. Limpar o ambiente inteiro ou reconstruí-lo do zero
 * quebraria Docker/credenciais do usuário — e um wrapper que quebra o Docker não é usado,
 * então o defeito voltaria.
 *
 * Chaves `FEATURE_MODULE_*` que NÃO pertencem ao contrato (typos, flags de terceiros) são
 * preservadas: removê-las seria alterar ambiente alheio por adivinhação.
 *
 * ============================================================================================
 * O QUE ESTE MÓDULO NÃO É
 * ============================================================================================
 *
 * Não é framework de configuração. Não é boundary de segurança: o backend continua sendo a
 * fronteira (`ReleaseScopeGuard` fail-closed + PDP). Sanitizar o ambiente aqui garante apenas
 * que a superfície publicada seja a DECLARADA — nunca que um ator possa acessá-la.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './env.mjs';

const RELEASE_SCOPE_SOURCE = resolve(
  repoRoot,
  'apps/api/src/platform/release-scope/release-1-scope.ts',
);

/**
 * Superfície de build do web (também pertence ao contrato de release).
 * Declarada de forma fixa: a API não conhece esta chave, ela existe só no bundle web.
 */
export const RELEASE_SURFACE_ENV_KEYS = ['VITE_CISNE_SURFACE'];

/**
 * Lê `GATED_MODULE_IDS` do arquivo canônico do backend.
 *
 * O script é `.mjs` e não pode importar `.ts` diretamente (Node não transpila). Em vez de
 * duplicar a lista aqui — o que criaria uma segunda fonte de verdade que envelhece em
 * silêncio quando um módulo novo é adicionado — o bloco é extraído do próprio source.
 * Se o formato mudar e nada for encontrado, o chamador FALHA ALTO (ver `loadControlledEnvKeys`),
 * em vez de sanitizar um conjunto vazio e dar a impressão de proteção.
 */
function parseGatedModuleIds(source) {
  const match = /GATED_MODULE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source);
  if (!match) {
    return null;
  }
  const ids = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
  return ids.length > 0 ? ids : null;
}

/** Converte um moduleId em sufixo de variável: `approval-matrix` → `APPROVAL_MATRIX`. */
function envSuffix(moduleId) {
  return moduleId.toUpperCase().replace(/-/g, '_');
}

/**
 * Chaves do contrato de release: as que a API lê em runtime e as que o web lê em build.
 * Derivadas da lista canônica `GATED_MODULE_IDS`, para que um módulo novo entre aqui
 * automaticamente sem edição deste arquivo.
 */
export const RELEASE_SCOPE_ENV_KEYS = (() => {
  const source = readFileSync(RELEASE_SCOPE_SOURCE, 'utf8');
  const moduleIds = parseGatedModuleIds(source);
  if (!moduleIds) {
    throw new Error(
      'Não foi possível extrair GATED_MODULE_IDS de ' +
        `${RELEASE_SCOPE_SOURCE}. A sanitização de ambiente do HML não pode operar às cegas: ` +
        'um conjunto vazio deixaria passar exatamente as variáveis que ela existe para conter.',
    );
  }
  return [
    ...moduleIds.map((moduleId) => `FEATURE_MODULE_${envSuffix(moduleId)}`),
    ...moduleIds.map((moduleId) => `VITE_FEATURE_MODULE_${envSuffix(moduleId)}`),
  ];
})();

/** Todas as chaves controladas por configuração versionada. */
export const CONTROLLED_ENV_KEYS = [...RELEASE_SCOPE_ENV_KEYS, ...RELEASE_SURFACE_ENV_KEYS];

/** Chaves controladas que estavam presentes no ambiente recebido — usado em diagnóstico. */
export function findInheritedReleaseKeys(env = process.env) {
  return CONTROLLED_ENV_KEYS.filter((key) => env[key] !== undefined);
}

/**
 * Devolve uma cópia do ambiente sem as chaves controladas.
 *
 * Tudo o mais é copiado por referência de valor: PATH, HOME, DOCKER_*, credenciais e
 * variáveis de terceiros permanecem intactas.
 */
export function sanitizeReleaseEnv(env = process.env) {
  const sanitized = { ...env };
  for (const key of CONTROLLED_ENV_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

/**
 * Executa o Docker Compose com o ambiente sanitizado, de forma que `--env-file` e os
 * defaults do compose sejam a única fonte de verdade para as flags de release.
 */
export function runComposeDeterministic(args, options = {}) {
  const inherited = findInheritedReleaseKeys(options.env ?? process.env);
  if (inherited.length > 0 && !options.quiet) {
    process.stderr.write(
      `[hml-compose] FEATURE_FLAG_ENV_OVERRIDE_DETECTED — ${inherited.length} variável(is) de ` +
        'release herdada(s) do shell foram ignoradas para que a configuração versionada ' +
        'seja a fonte de verdade:\n',
    );
    for (const key of inherited) {
      process.stderr.write(`[hml-compose]   ${key}=${options.env?.[key] ?? process.env[key]}\n`);
    }
  }

  const result = spawnSync('docker', ['compose', ...args], {
    cwd: options.cwd,
    stdio: options.stdio ?? 'inherit',
    // `shell: true` no Windows garante que `docker.exe` seja resolvido pelo PATH mesmo
    // quando o binário está fora do PATH do processo. `docker` não tem espaços no caminho,
    // então a quebra de aspas que afeta `process.execPath` não se aplica aqui.
    shell: process.platform === 'win32',
    env: sanitizeReleaseEnv(options.env ?? process.env),
  });

  if (result.error) {
    process.stderr.write(`[hml-compose] falha ao executar docker compose: ${result.error.message}\n`);
    return 1;
  }

  return result.status ?? 1;
}

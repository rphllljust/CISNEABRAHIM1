import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_FLAG_ENV, GATED_MODULE_IDS, type GatedModuleId } from './release-1-scope';

/**
 * ALINHAMENTO DE CONFIGURAÇÃO WEB × API
 *
 * DEFEITO QUE ESTE TESTE IMPEDE (registrado 2026-09-27):
 *
 * A API lê `FEATURE_MODULE_*` (sem prefixo) em RUNTIME. O web lê `VITE_FEATURE_MODULE_*`
 * em BUILD. As duas famílias são independentes e nada as acoplava: um ambiente podia
 * publicar no web um módulo que o guard do servidor recusava com 403 FEATURE_DISABLED
 * (ou o inverso — módulo acessível pela API e invisível na navegação).
 *
 * A fronteira de segurança NÃO muda com este teste: o backend continua sendo o boundary,
 * o guard continua fail-closed (`=== 'true'`) e a autorização continua sendo decidida por
 * identidade e escopo no PDP. O que este teste protege é COERÊNCIA DE SUPERFÍCIE.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');

/** Módulos com apenas stub comprovado — devem ficar desligados em todos os ambientes. */
const STUB_MODULE_IDS: ReadonlySet<GatedModuleId> = new Set<GatedModuleId>([
  'rentals',
  'transport',
]);

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

/** Extrai `CHAVE=valor` de um arquivo .env, ignorando comentários. */
function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    result[key] = value;
  }
  return result;
}

/** Converte um valor de flag em booleano fail-closed (só `true` exato liga). */
function isEnabled(value: string | undefined): boolean {
  return value === 'true';
}

describe('alinhamento de configuração web × api', () => {
  describe('.env.hml — o arquivo que o compose HML consome', () => {
    const env = parseEnvFile(readRepoFile('.env.hml'));

    it('declara a flag de runtime da API para todo módulo com gate', () => {
      for (const moduleId of GATED_MODULE_IDS) {
        const apiKey = FEATURE_FLAG_ENV[moduleId];
        expect(env[apiKey], `chave de API ausente em .env.hml: ${apiKey}`).toBeDefined();
      }
    });

    it('declara a flag de build do web para todo módulo com gate', () => {
      for (const moduleId of GATED_MODULE_IDS) {
        const webKey = `VITE_${FEATURE_FLAG_ENV[moduleId]}`;
        expect(env[webKey], `chave de web ausente em .env.hml: ${webKey}`).toBeDefined();
      }
    });

    it('mantém API e web concordando módulo a módulo', () => {
      for (const moduleId of GATED_MODULE_IDS) {
        const apiEnabled = isEnabled(env[FEATURE_FLAG_ENV[moduleId]]);
        const webEnabled = isEnabled(env[`VITE_${FEATURE_FLAG_ENV[moduleId]}`]);
        expect(
          webEnabled,
          `divergência em '${moduleId}': API=${apiEnabled} web=${webEnabled}. ` +
            'O web publicaria uma superfície que o guard do servidor recusa, ou o inverso.',
        ).toBe(apiEnabled);
      }
    });
  });

  describe('.env — ambiente de desenvolvimento local', () => {
    const env = parseEnvFile(readRepoFile('.env'));

    it('mantém API e web concordando módulo a módulo', () => {
      for (const moduleId of GATED_MODULE_IDS) {
        const apiEnabled = isEnabled(env[FEATURE_FLAG_ENV[moduleId]]);
        const webEnabled = isEnabled(env[`VITE_${FEATURE_FLAG_ENV[moduleId]}`]);
        expect(
          webEnabled,
          `divergência em '${moduleId}' no .env: API=${apiEnabled} web=${webEnabled}.`,
        ).toBe(apiEnabled);
      }
    });
  });

  describe('stubs permanecem desligados em todo ambiente versionado', () => {
    const versionedEnvs = ['.env', '.env.hml'];

    for (const envPath of versionedEnvs) {
      const env = parseEnvFile(readRepoFile(envPath));

      it(`${envPath} não liga rentals/transport`, () => {
        for (const moduleId of STUB_MODULE_IDS) {
          const apiKey = FEATURE_FLAG_ENV[moduleId];
          const webKey = `VITE_${apiKey}`;
          expect(
            isEnabled(env[apiKey]),
            `${envPath} liga o stub '${moduleId}' na API (${apiKey}). ` +
              'STUB_MODULES deve permanecer desligado até virar produto.',
          ).toBe(false);
          expect(
            isEnabled(env[webKey]),
            `${envPath} liga o stub '${moduleId}' no web (${webKey}).`,
          ).toBe(false);
        }
      });
    }
  });

  describe('docker/sandbox/compose.yaml — ambiente de gate', () => {
    const compose = readRepoFile('docker/sandbox/compose.yaml');

    it('não liga stubs no serviço api', () => {
      for (const moduleId of STUB_MODULE_IDS) {
        const key = FEATURE_FLAG_ENV[moduleId];
        // Casa a chave dentro do YAML e captura o literal atribuído.
        const match = new RegExp(`${key}:\\s*'?([^'\\n]+)'?`).exec(compose);
        expect(match, `${key} não declarada em docker/sandbox/compose.yaml`).not.toBeNull();
        const value = match?.[1].trim();
        expect(
          value,
          `docker/sandbox/compose.yaml liga o stub '${moduleId}' (${key}: ${value}).`,
        ).not.toBe('true');
      }
    });
  });

  describe('docker/hml/compose.yaml — fonte única entre api e web', () => {
    const compose = readRepoFile('docker/hml/compose.yaml');

    it('deriva o arg do web da MESMA variável que a API recebe', () => {
      for (const moduleId of GATED_MODULE_IDS) {
        const apiKey = FEATURE_FLAG_ENV[moduleId];
        const webKey = `VITE_${apiKey}`;
        // O arg do web deve referenciar ${API_KEY...}, não ${WEB_KEY...}: é isso que
        // impede as duas famílias de divergirem em silêncio.
        const expectedArg = `${webKey}: \${${apiKey}`;
        expect(
          compose,
          `docker/hml/compose.yaml não amarra ${webKey} a \${${apiKey}}. ` +
            'Sem isso, web e api podem divergir silenciosamente.',
        ).toContain(expectedArg);
      }
    });
  });
});

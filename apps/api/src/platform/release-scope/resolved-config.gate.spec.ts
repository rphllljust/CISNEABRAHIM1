/**
 * PROVA DA CAUSA RAIZ — ambiente host contaminado não pode alterar o HML
 *
 * ============================================================================================
 * O QUE ESTE TESTE PROVA
 * ============================================================================================
 *
 * O defeito original: variáveis `FEATURE_MODULE_*` exportadas no shell venciam `--env-file`
 * na interpolação do Docker Compose, alterando em silêncio a superfície de módulos do HML.
 *
 * Este teste simula um host contaminado com valores DELIBERADAMENTE CONTRÁRIOS à política:
 *
 *     FEATURE_MODULE_RENTALS=true     (stub — política manda false)
 *     FEATURE_MODULE_TRANSPORT=true   (stub — política manda false)
 *     FEATURE_MODULE_FINANCE=false    (construído — política manda true)
 *
 * e executa o gate oficial. O resultado DEVE permanecer o da configuração versionada:
 *
 *     rentals=false, transport=false, finance=true
 *
 * Se o host conseguir alterar esse resultado, o teste FALHA — que é a evidência de que a
 * subida do HML voltou a ser não-determinística.
 *
 * Executa em subprocesso com ambiente controlado, para não contaminar o processo do Vitest.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const GATE = resolve(REPO_ROOT, 'scripts/hml/verify-resolved-config.mjs');

/** Ambiente hostil: diverge da política em ambas as direções. */
const CONTAMINATED_ENV = {
  FEATURE_MODULE_RENTALS: 'true',
  FEATURE_MODULE_TRANSPORT: 'true',
  FEATURE_MODULE_FINANCE: 'false',
};

type GateRun = { status: number; stdout: string; stderr: string; output: string };

/** Executa o gate com o ambiente do teste, opcionalmente contaminado. */
function runGate(extraEnv: Record<string, string> = {}, extraArgs: string[] = []): GateRun {
  // `shell: false` é obrigatório no Windows: com shell, o caminho do Node
  // (`C:\Program Files\nodejs\node.exe`) é quebrado no espaço e o shell tenta executar
  // `C:\Program` — erro de ambiente que nada tem a ver com a configuração sendo testada.
  const result = spawnSync(process.execPath, [GATE, ...extraArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ...extraEnv },
    maxBuffer: 64 * 1024 * 1024,
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { status: result.status ?? 1, stdout, stderr, output: `${stdout}\n${stderr}` };
}

/** `docker` indisponível na máquina: não é falha do gate, é ambiente sem Docker. */
function dockerUnavailable(run: GateRun): boolean {
  return /não foi possível resolver a configuração|docker compose config falhou/i.test(run.output)
    && /not recognized|não é reconhecido|ENOENT|Cannot connect|command not found/i.test(run.output);
}

describe('ambiente host contaminado — HML permanece determinístico', () => {
  it('o gate passa em modo estrito quando o host não exporta flags divergentes', () => {
    // O modo estrito mede a HIGIENE DO HOST. Para exercitá-lo de forma determinística, o
    // ambiente herdado do Vitest é removido antes da invocação — do contrário o resultado
    // dependeria de como a sessão foi iniciada, que é exatamente o não-determinismo que
    // este trabalho elimina.
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(VITE_)?FEATURE_MODULE_/.test(key) && key !== 'VITE_CISNE_SURFACE',
      ),
    );

    const result = spawnSync(process.execPath, [GATE], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      shell: false,
      env: cleanEnv as NodeJS.ProcessEnv,
      maxBuffer: 64 * 1024 * 1024,
    });

    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const run: GateRun = { status: result.status ?? 1, stdout: '', stderr: '', output };

    if (dockerUnavailable(run)) {
      console.warn('Docker indisponível — gate não pôde ser exercitado. Teste inconclusivo.');
      return;
    }

    expect(output).toContain('GATE DE CONFIGURAÇÃO RESOLVIDA: PASS');
    expect(result.status).toBe(0);
  });

  it('rentals/transport/finance NÃO são alterados por variáveis herdadas do shell', () => {
    // `--allow-inherited` isola a pergunta certa: com um host deliberadamente hostil, a
    // configuração resolvida permanece a versionada? Sem este modo, um gate que passa
    // apenas quando o host está limpo não distingue "sanitização funciona" de "sorte".
    const run = runGate(CONTAMINATED_ENV, ['--allow-inherited']);
    if (dockerUnavailable(run)) {
      console.warn('Docker indisponível — gate não pôde ser exercitado. Teste inconclusivo.');
      return;
    }

    expect(
      run.output,
      `O host conseguiu alterar a configuração resolvida do HML.\n${run.output}`,
    ).toContain('GATE DE CONFIGURAÇÃO RESOLVIDA: PASS');
    expect(run.status).toBe(0);

    // E as linhas de valor devem refletir a POLÍTICA versionada, não o shell hostil.
    expect(run.output).toMatch(/RENTALS\s+api=false web=false/);
    expect(run.output).toMatch(/TRANSPORT\s+api=false web=false/);
    expect(run.output).toMatch(/FINANCE\s+api=true web=true/);
  });

  it('a sanitização descarta as variáveis herdadas divergentes', () => {
    const run = runGate(CONTAMINATED_ENV, ['--allow-inherited']);
    if (dockerUnavailable(run)) {
      console.warn('Docker indisponível — teste inconclusivo.');
      return;
    }
    // A contagem exata depende de quantas `FEATURE_MODULE_*` o host já exportava antes do
    // teste, então a asserção é sobre a existência do descarte — não sobre um número fixo,
    // que tornaria o teste frágil em máquinas com ambientes diferentes.
    expect(
      run.output,
      `O gate não reportou o descarte das variáveis herdadas.\n${run.output}`,
    ).toMatch(/\d+ variável\(is\) herdada\(s\) divergente\(s\) descartada\(s\)/);
  });

  it('em modo estrito, host contaminado falha alto com FEATURE_FLAG_ENV_OVERRIDE_DETECTED', () => {
    const run = runGate(CONTAMINATED_ENV);
    if (dockerUnavailable(run)) {
      console.warn('Docker indisponível — teste inconclusivo.');
      return;
    }

    // Este é o comportamento que impede o defeito de voltar em silêncio: mesmo que alguém
    // remova a sanitização do wrapper, o gate recusa a subida em vez de aceitar o shell.
    expect(run.status).not.toBe(0);
    expect(run.output).toContain('FEATURE_FLAG_ENV_OVERRIDE_DETECTED');
    // As três variáveis contaminadas por este teste devem aparecer explicitamente.
    expect(run.output).toContain('FEATURE_MODULE_RENTALS: shell="true" configurado="false"');
    expect(run.output).toContain('FEATURE_MODULE_TRANSPORT: shell="true" configurado="false"');
    expect(run.output).toContain('FEATURE_MODULE_FINANCE: shell="false" configurado="true"');
  });
});

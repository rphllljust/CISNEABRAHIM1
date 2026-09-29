/**
 * GATE DE CONFIGURAÇÃO RESOLVIDA — HML
 *
 * ============================================================================================
 * POR QUE ESTE GATE EXISTE
 * ============================================================================================
 *
 * O teste `config-alignment.spec.ts` valida os ARQUIVOS de configuração. Ele é necessário,
 * mas insuficiente por construção: ele lê texto, e o que o Compose realmente entrega aos
 * containers é o resultado de INTERPOLAÇÃO — que depende do ambiente do processo.
 *
 * Foi exatamente essa lacuna que deixou o defeito passar: os arquivos diziam
 * `FEATURE_MODULE_RENTALS=false`, o shell exportava `=true`, e o Compose resolvia `true`.
 * Nenhum teste que leia arquivos detecta isso.
 *
 * Este gate executa `docker compose config` e valida o resultado RESOLVIDO, que é o mesmo
 * material que o Compose usaria para criar os containers.
 *
 * ============================================================================================
 * O QUE É VALIDADO
 * ============================================================================================
 *
 * 1. BUILT_MODULES   → `FEATURE_MODULE_X` (api) e `VITE_FEATURE_MODULE_X` (web build) = true
 * 2. STUB_MODULES    → `rentals` e `transport` = false nas duas camadas
 * 3. COERÊNCIA       → para cada módulo, o arg do web concorda com o env da api
 * 4. FONTE DE VERDADE→ nenhuma flag de release pode vir do ambiente herdado do shell
 *
 * Falha com `FEATURE_FLAG_ENV_OVERRIDE_DETECTED` quando uma variável herdada alteraria o
 * resultado — o caso que torna a subida não-determinística.
 *
 * Uso:
 *   node scripts/hml/verify-resolved-config.mjs
 *   node scripts/hml/verify-resolved-config.mjs --env-file .env.hml --compose docker/hml/compose.yaml
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { repoRoot } from '../lib/env.mjs';
import {
  findInheritedReleaseKeys,
  sanitizeReleaseEnv,
} from '../lib/hml-compose.mjs';

const DEFAULT_COMPOSE = 'docker/hml/compose.yaml';
const DEFAULT_ENV_FILE = '.env.hml';

/** Módulos com código real e auditável — devem estar LIGADOS em HML. */
const BUILT_MODULES = [
  'FINANCE',
  'FISCAL',
  'ACCOUNTING',
  'INVENTORY',
  'PAYROLL',
  'PROCUREMENT',
  'SUPPLIERS',
  'CONTRACTS',
  'PEOPLE',
  'ALERTS',
  'REPORTS',
  'APPROVAL_MATRIX',
  'OPERATIONAL_PROFITABILITY',
];

/** Módulos que são apenas stub comprovado — devem estar DESLIGADOS. */
const STUB_MODULES = ['RENTALS', 'TRANSPORT'];

function parseArgs(argv) {
  const options = {
    compose: DEFAULT_COMPOSE,
    envFile: DEFAULT_ENV_FILE,
    allowInherited: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--compose') options.compose = argv[++index];
    else if (arg === '--env-file') options.envFile = argv[++index];
    else if (arg === '--allow-inherited') options.allowInherited = true;
  }
  return options;
}

/**
 * Executa `docker compose config --format json` com o ambiente SANITIZADO.
 *
 * A sanitização é o ponto central: sem ela, este gate mediria o ambiente do shell e não a
 * configuração versionada — ou seja, mediria a coisa errada.
 */
function resolveComposeConfig(options) {
  const result = spawnSync(
    'docker',
    ['compose', '-f', options.compose, '--env-file', options.envFile, 'config', '--format', 'json'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      // `docker` é resolvido pelo PATH; sem espaços no nome, o shell é seguro no Windows.
      shell: process.platform === 'win32',
      env: sanitizeReleaseEnv(process.env),
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (result.error) {
    throw new Error(`falha ao executar docker compose: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `docker compose config falhou (exit ${result.status}):\n${result.stderr || result.stdout}`,
    );
  }

  const stdout = result.stdout?.trim();
  if (!stdout) {
    throw new Error('docker compose config não produziu saída JSON.');
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`saída de docker compose config não é JSON válido: ${error.message}`);
  }
}

function readApiEnv(config) {
  const environment = config?.services?.api?.environment ?? {};
  return environment;
}

function readWebBuildArgs(config) {
  return config?.services?.web?.build?.args ?? {};
}

/**
 * Confere se uma flag de release poderia ter vindo do ambiente herdado.
 *
 * Aqui está a distinção que dá sentido ao gate. Existem dois modos:
 *
 * - `--strict-source` (default): o host NÃO pode exportar flag de release divergente da
 *   configuração versionada. Uma variável herdada divergente é FAIL com
 *   FEATURE_FLAG_ENV_OVERRIDE_DETECTED. É o modo correto para CI e para o gate de release:
 *   mede a higiene do ambiente que está executando a subida.
 *
 * - `--allow-inherited`: herança é tolerada (e descartada pela sanitização). É o modo usado
 *   para PROVAR o determinismo: mesmo com um host deliberadamente contaminado, a
 *   configuração resolvida permanece a versionada. Sem este modo não haveria como
 *   distinguir "o gate passou porque o host estava limpo" de "o gate passou apesar do host".
 *
 * Em ambos os modos a sanitização acontece: o resultado resolvido nunca vem do shell.
 */
function detectInheritedOverride(resolved) {
  const inherited = findInheritedReleaseKeys(process.env);
  if (inherited.length === 0) {
    return [];
  }

  const resolvedValues = { ...readApiEnv(resolved), ...readWebBuildArgs(resolved) };
  const overrides = [];

  for (const key of inherited) {
    const fromShell = process.env[key];
    const fromConfig = resolvedValues[key];
    // Sem valor resolvido, a chave não participa deste compose — não é override.
    if (fromConfig === undefined) continue;
    if (String(fromShell) !== String(fromConfig)) {
      overrides.push({ key, fromShell, fromConfig });
    }
  }

  return overrides;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const failures = [];

  console.log('GATE DE CONFIGURAÇÃO RESOLVIDA — HML');
  console.log(`  compose:  ${options.compose}`);
  console.log(`  env-file: ${options.envFile}`);

  let resolved;
  try {
    resolved = resolveComposeConfig(options);
  } catch (error) {
    console.error(`\nFAIL — não foi possível resolver a configuração: ${error.message}`);
    process.exit(1);
  }

  const apiEnv = readApiEnv(resolved);
  const webArgs = readWebBuildArgs(resolved);

  // -------------------------------------------------------------------------------------------
  // 0. Determinismo: variável herdada do shell não pode alterar o resultado
  // -------------------------------------------------------------------------------------------
  const overrides = detectInheritedOverride(resolved);
  if (overrides.length > 0 && !options.allowInherited) {
    console.error('\nFEATURE_FLAG_ENV_OVERRIDE_DETECTED');
    console.error(
      '  Variável(is) de release herdada(s) do shell DIVERGEM da configuração versionada.',
    );
    for (const item of overrides) {
      console.error(`    ${item.key}: shell="${item.fromShell}" configurado="${item.fromConfig}"`);
    }
    console.error(
      '  A configuração resolvida abaixo JÁ está sanitizada e correta; o FAIL é sobre a\n' +
        '  higiene do host que executa a subida. Rode via `pnpm hml:up` (wrapper\n' +
        '  determinístico) ou remova as variáveis do shell.',
    );
    failures.push('FEATURE_FLAG_ENV_OVERRIDE_DETECTED');
  } else if (overrides.length > 0) {
    console.log(
      `\n[0] Determinismo: ${overrides.length} variável(is) herdada(s) divergente(s) ` +
        'descartada(s) pela sanitização. Modo --allow-inherited: divergência tolerada.',
    );
  } else {
    console.log('\n[0] Determinismo: nenhuma flag de release divergente herdada do shell. PASS');
  }

  // -------------------------------------------------------------------------------------------
  // 1. BUILT_MODULES ligados nas duas camadas
  // -------------------------------------------------------------------------------------------
  console.log('\n[1] BUILT_MODULES — esperado: true na api e no build do web');
  for (const moduleId of BUILT_MODULES) {
    const apiKey = `FEATURE_MODULE_${moduleId}`;
    const webKey = `VITE_FEATURE_MODULE_${moduleId}`;
    const apiValue = apiEnv[apiKey];
    const webValue = webArgs[webKey];

    if (String(apiValue) !== 'true') {
      failures.push(`api ${apiKey}="${apiValue}" (esperado true)`);
    }
    if (String(webValue) !== 'true') {
      failures.push(`web ${webKey}="${webValue}" (esperado true)`);
    }
    console.log(`    ${moduleId.padEnd(28)} api=${apiValue} web=${webValue}`);
  }

  // -------------------------------------------------------------------------------------------
  // 2. STUB_MODULES desligados nas duas camadas
  // -------------------------------------------------------------------------------------------
  console.log('\n[2] STUB_MODULES — esperado: false na api e no build do web');
  for (const moduleId of STUB_MODULES) {
    const apiKey = `FEATURE_MODULE_${moduleId}`;
    const webKey = `VITE_FEATURE_MODULE_${moduleId}`;
    const apiValue = apiEnv[apiKey];
    const webValue = webArgs[webKey];

    if (String(apiValue) !== 'false') {
      failures.push(`api ${apiKey}="${apiValue}" (esperado false)`);
    }
    if (String(webValue) !== 'false') {
      failures.push(`web ${webKey}="${webValue}" (esperado false)`);
    }
    console.log(`    ${moduleId.padEnd(28)} api=${apiValue} web=${webValue}`);
  }

  // -------------------------------------------------------------------------------------------
  // 3. Coerência web × api para todo módulo do contrato
  // -------------------------------------------------------------------------------------------
  console.log('\n[3] Coerência web × api');
  const allModules = [...BUILT_MODULES, ...STUB_MODULES];
  let mismatches = 0;
  for (const moduleId of allModules) {
    const apiValue = apiEnv[`FEATURE_MODULE_${moduleId}`];
    const webValue = webArgs[`VITE_FEATURE_MODULE_${moduleId}`];
    if (String(apiValue) !== String(webValue)) {
      mismatches += 1;
      failures.push(`divergência ${moduleId}: api="${apiValue}" web="${webValue}"`);
    }
  }
  console.log(
    mismatches === 0
      ? `    ${allModules.length}/${allModules.length} módulos coerentes`
      : `    ${mismatches} divergência(s)`,
  );

  // -------------------------------------------------------------------------------------------
  // Resultado
  // -------------------------------------------------------------------------------------------
  if (failures.length > 0) {
    console.error(`\nGATE DE CONFIGURAÇÃO RESOLVIDA: FAIL (${failures.length} problema(s))`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log('\nGATE DE CONFIGURAÇÃO RESOLVIDA: PASS');
  console.log(
    `  ${BUILT_MODULES.length} módulos construídos ligados; ` +
      `${STUB_MODULES.length} stubs desligados; web e api coerentes.`,
  );
  process.exit(0);
}

main();

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_MODULES, HML_CANDIDATE_MODULES, STUB_MODULES, resolveModuleFlag } from './feature-flags';
import { FEATURE_FLAG_ENV, GATED_MODULE_IDS } from './release-1-scope';

/**
 * SRC-009 clausula 2-A e ED-005: o artefato de producao R1 deve manter todos
 * os modulos FEATURE_MODULE_* desligados ate UAT e decisao expressa por flag.
 * A HML continua cobrindo os modulos construidos; build nao equivale a aceite.
 */

const WORKFLOW = resolve(process.cwd(), '../../.github/workflows/ci.yml');

/**
 * Extrai o bloco `env:` do step `Build` DENTRO do job `Build / artifacts`.
 *
 * Restrito ao job de proposito: o step de visual declara `VITE_CISNE_SURFACE: 'dev'`
 * e isso NAO pode satisfazer o gate do artefato de producao.
 */
function readProductionBuildEnv(): Record<string, string> {
  const source = readFileSync(WORKFLOW, 'utf8');

  const jobStart = source.indexOf('name: Build / artifacts');
  expect(jobStart, 'job `Build / artifacts` nao encontrado em ci.yml').toBeGreaterThan(-1);

  const buildStep = source.indexOf('name: Build', jobStart);
  expect(buildStep, 'step `Build` nao encontrado no job Build / artifacts').toBeGreaterThan(-1);

  const runLine = source.indexOf('run: pnpm build', buildStep);
  expect(runLine, 'step Build nao executa `pnpm build`').toBeGreaterThan(-1);

  const block = source.slice(buildStep, runLine);
  const envStart = block.indexOf('env:');
  if (envStart === -1) return {};

  const env: Record<string, string> = {};
  for (const line of block.slice(envStart).split('\n')) {
    const match = /^\s+([A-Z0-9_]+):\s*'([^']*)'\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      env[match[1]] = match[2];
    }
  }
  return env;
}

describe('artefato de producao: decisao de release dos modulos', () => {
  it('declara VITE_CISNE_SURFACE explicito no job de artefato', () => {
    const env = readProductionBuildEnv();
    expect(
      env.VITE_CISNE_SURFACE,
      'VITE_CISNE_SURFACE ausente no job Build / artifacts: o bundle cairia em conservative-default',
    ).toBeTruthy();
  });

  it('mantem todos os modulos gated fora do bundle de producao R1', () => {
    const env = readProductionBuildEnv();
    const enabled = GATED_MODULE_IDS.filter((moduleId) => resolveModuleFlag(moduleId, env).enabled);
    expect(enabled, 'SRC-009 2-A nao autoriza ativar FEATURE_MODULE_* em producao').toEqual([]);
  });

  it('nao promove modulo STUB (sem backend real) em producao', () => {
    const env = readProductionBuildEnv();
    const on = [...STUB_MODULES].filter((moduleId) => resolveModuleFlag(moduleId, env).enabled);
    expect(on, `modulos sem backend real ligados em producao: ${on.join(', ')}`).toEqual([]);
  });

  it('keeps MASTER 002 HML candidates out of production until business acceptance', () => {
    const env = readProductionBuildEnv();
    expect([...HML_CANDIDATE_MODULES].sort()).toEqual(['rentals', 'transport']);
    for (const moduleId of HML_CANDIDATE_MODULES) {
      expect(resolveModuleFlag(moduleId, env).enabled).toBe(false);
      expect(env[FEATURE_FLAG_ENV[moduleId]]).not.toBe('true');
    }
  });

  it('declara explicitamente false para cada modulo construido no artefato R1', () => {
    const env = readProductionBuildEnv();
    for (const moduleId of BUILT_MODULES) {
      const flag = FEATURE_FLAG_ENV[moduleId];
      expect(env[flag], `${flag} exige decisao explicita de escopo R1`).toBe('false');
      expect(resolveModuleFlag(moduleId, env).origin).toBe('explicit-env');
    }
  });

  it('cobre todos os modulos gated com nome de variavel padronizado', () => {
    for (const moduleId of GATED_MODULE_IDS) {
      expect(FEATURE_FLAG_ENV[moduleId]).toMatch(/^VITE_FEATURE_MODULE_[A-Z_]+$/);
    }
    // Nenhum modulo construido pode ficar fora do mapa de flags.
    for (const moduleId of BUILT_MODULES) {
      expect(GATED_MODULE_IDS).toContain(moduleId);
    }
  });
});

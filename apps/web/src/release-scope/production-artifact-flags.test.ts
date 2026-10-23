import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_MODULES, STUB_MODULES, resolveModuleFlag } from './feature-flags';
import { FEATURE_FLAG_ENV, GATED_MODULE_IDS } from './release-1-scope';

/**
 * GATE DO ARTEFATO DE PRODUCAO — modulo construido nao pode viajar desligado.
 *
 * DEFEITO QUE ESTE TESTE FECHA (medido em 2026-10-23):
 *
 * O job `Build / artifacts` do CI gera o artefato imutavel que vai para producao.
 * Ele rodava `pnpm build` sem nenhuma variavel de superficie. Como `resolveModuleFlag`
 * cai em `conservative-default` quando `VITE_CISNE_SURFACE` esta ausente, o bundle era
 * compilado com os 13 modulos CONSTRUIDOS desligados.
 *
 * Sintoma ao operador: backend respondendo, menu sem os modulos, produto mutilado — e
 * nenhum gate vermelho, porque nada falhava.
 *
 * COMO PROVA: usa o MESMO resolvedor que o produto usa (`resolveModuleFlag`) sobre o
 * env que o workflow realmente declara. Nao replica regra em paralelo, nao reparseia
 * TypeScript: se a regra mudar, este teste acompanha automaticamente.
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

  it('liga TODOS os modulos construidos no bundle de producao', () => {
    const env = readProductionBuildEnv();
    const off = [...BUILT_MODULES].filter((moduleId) => !resolveModuleFlag(moduleId, env).enabled);

    expect(
      off,
      `modulos construidos desligados no artefato de producao: ${off.join(', ')}. ` +
        'O operador receberia um produto mutilado sem nenhum gate vermelho.',
    ).toEqual([]);
  });

  it('nao promove modulo STUB (sem backend real) em producao', () => {
    const env = readProductionBuildEnv();
    const on = [...STUB_MODULES].filter((moduleId) => resolveModuleFlag(moduleId, env).enabled);
    expect(on, `modulos sem backend real ligados em producao: ${on.join(', ')}`).toEqual([]);
  });

  it('libera producao modulo a modulo, sem herdar de superficie de homologacao', () => {
    const env = readProductionBuildEnv();
    // Cada modulo construido precisa de flag explicita 'true'. Depender apenas de
    // VITE_CISNE_SURFACE='production' nao ligaria nada, porque `production` nao esta
    // em HOMOLOGATION_SURFACES — e se estivesse, ligaria STUB junto.
    for (const moduleId of BUILT_MODULES) {
      const flag = FEATURE_FLAG_ENV[moduleId];
      expect(env[flag], `${flag} deveria estar 'true' explicitamente`).toBe('true');
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

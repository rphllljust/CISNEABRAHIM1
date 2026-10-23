import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSurfacePlan } from './coolify-module-surface.mjs';

/**
 * CONTRATO DE SUPERFICIE — modulo liberado exige FEATURE_MODULE_*=true na API.
 *
 * As duas familias de flags sao independentes por desenho:
 *   VITE_FEATURE_MODULE_*  (build, import.meta.env) -> o que o menu mostra
 *   FEATURE_MODULE_*       (runtime, process.env)   -> o que a API autoriza
 *
 * Divergencia entre elas e falha de release, nao detalhe de configuracao:
 *   - API ON  + bundle OFF -> menu sem produto (operador nao encontra o modulo)
 *   - bundle ON + API OFF  -> menu aparece, acao responde 403 FEATURE_DISABLED
 *
 * Este teste fixa o contrato que o script aplica em producao.
 */

function envEntry(key, value) {
  return { key, value, real_value: value, is_preview: false, uuid: `uuid-${key}` };
}

function envsWith(overrides = {}) {
  const base = {};
  // Estado saudavel: TODOS os modulos construidos ligados e STUB desligado.
  for (const moduleId of [
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
  ]) {
    base[`FEATURE_MODULE_${moduleId}`] = 'true';
  }
  for (const moduleId of ['RENTALS', 'TRANSPORT']) {
    base[`FEATURE_MODULE_${moduleId}`] = 'false';
  }
  Object.assign(base, overrides);
  return Object.entries(base).map(([key, value]) => envEntry(key, value));
}

test('estado saudavel nao gera nenhuma divergencia', () => {
  const plan = buildSurfacePlan(envsWith());
  assert.deepEqual(plan.mismatches, []);
  assert.equal(plan.current.FEATURE_MODULE_FINANCE, 'true');
  assert.equal(plan.current.FEATURE_MODULE_RENTALS, 'false');
});

test('modulo construido desligado na API e divergencia para ligar', () => {
  const plan = buildSurfacePlan(envsWith({ FEATURE_MODULE_FINANCE: 'false' }));
  assert.equal(plan.mismatches.length, 1);
  assert.equal(plan.mismatches[0].key, 'FEATURE_MODULE_FINANCE');
  assert.equal(plan.mismatches[0].desired, 'true');
  assert.equal(plan.mismatches[0].actual, 'false');
  assert.equal(plan.mismatches[0].action, 'update');
});

test('modulo STUB ligado na API e divergencia para desligar', () => {
  // Nunca expor superficie sem backend real apenas para preencher menu.
  const plan = buildSurfacePlan(envsWith({ FEATURE_MODULE_RENTALS: 'true' }));
  assert.equal(plan.mismatches.length, 1);
  assert.equal(plan.mismatches[0].key, 'FEATURE_MODULE_RENTALS');
  assert.equal(plan.mismatches[0].desired, 'false');
});

test('variavel ausente e criada, nao ignorada', () => {
  const without = envsWith().filter((entry) => entry.key !== 'FEATURE_MODULE_PAYROLL');
  const plan = buildSurfacePlan(without);
  assert.equal(plan.mismatches.length, 1);
  assert.equal(plan.mismatches[0].key, 'FEATURE_MODULE_PAYROLL');
  assert.equal(plan.mismatches[0].action, 'create');
  assert.equal(plan.current.FEATURE_MODULE_PAYROLL, 'missing');
});

test('ausente != false: valor vazio nao conta como desligado', () => {
  const plan = buildSurfacePlan(envsWith({ FEATURE_MODULE_ALERTS: '' }));
  assert.equal(plan.mismatches.length, 1);
  assert.equal(plan.mismatches[0].key, 'FEATURE_MODULE_ALERTS');
  assert.equal(plan.mismatches[0].desired, 'true');
});

test('entrada de preview nao e confundida com producao', () => {
  const envs = envsWith().filter((entry) => entry.key !== 'FEATURE_MODULE_PEOPLE');
  envs.push({
    key: 'FEATURE_MODULE_PEOPLE',
    value: 'true',
    real_value: 'true',
    is_preview: true,
    uuid: 'uuid-preview',
  });
  const plan = buildSurfacePlan(envs);
  // A entrada de producao esta ausente: o preview NAO satisfaz o contrato.
  assert.equal(plan.mismatches.length, 1);
  assert.equal(plan.mismatches[0].key, 'FEATURE_MODULE_PEOPLE');
  assert.equal(plan.mismatches[0].action, 'create');
});

test('duas entradas de producao para a mesma chave e ambiguidade, nao aceite', () => {
  const envs = envsWith();
  envs.push(envEntry('FEATURE_MODULE_FINANCE', 'true'));
  const plan = buildSurfacePlan(envs);
  assert.equal(plan.mismatches.length, 1);
  assert.equal(plan.mismatches[0].key, 'FEATURE_MODULE_FINANCE');
  assert.equal(plan.mismatches[0].actual, 'ambiguous');
});

test('cobre os 13 modulos construidos e exatamente 2 stub', () => {
  const plan = buildSurfacePlan(envsWith());
  const keys = Object.keys(plan.current);
  assert.equal(keys.length, 15);
  assert.ok(keys.includes('FEATURE_MODULE_OPERATIONAL_PROFITABILITY'));
  assert.ok(keys.includes('FEATURE_MODULE_APPROVAL_MATRIX'));
});

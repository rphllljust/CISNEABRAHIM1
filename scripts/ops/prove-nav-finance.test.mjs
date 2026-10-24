import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyProbe, summarizeFinanceProbes } from './prove-nav-finance.mjs';

/**
 * Classificacao das sondas do menu Financeiro.
 *
 * Cada status HTTP mapeia para um ELO diferente do caminho. Confundir os elos foi o que
 * fez o diagnostico errar varias vezes: 404 nao e RBAC, e 403 nao e rota errada.
 */

test('2xx autoriza e o menu deve mostrar Financeiro', () => {
  const summary = summarizeFinanceProbes([
    { path: '/receivables', status: 200, outcome: classifyProbe(200) },
  ]);
  assert.equal(summary.visible, true);
  assert.match(summary.reason, /menu deve mostrar/);
});

test('200 com corpo vazio ainda autoriza (so o status decide)', () => {
  assert.equal(classifyProbe(204), 'ALLOWED');
  assert.equal(classifyProbe(200), 'ALLOWED');
});

test('403 classifica como RBAC, nao como rota errada', () => {
  const summary = summarizeFinanceProbes([
    { path: '/receivables', status: 403, outcome: classifyProbe(403) },
    { path: '/payables', status: 403, outcome: classifyProbe(403) },
    { path: '/treasury/accounts', status: 403, outcome: classifyProbe(403) },
  ]);
  assert.equal(summary.visible, false);
  assert.match(summary.reason, /RBAC/);
});

test('404 classifica como rota errada, nao como RBAC', () => {
  const summary = summarizeFinanceProbes([
    { path: '/receivables', status: 404, outcome: classifyProbe(404) },
  ]);
  assert.equal(summary.visible, false);
  assert.match(summary.reason, /ROTA ERRADA/);
});

test('401 classifica como falha de autenticacao', () => {
  assert.equal(classifyProbe(401), 'AUTH_FAILED');
  const summary = summarizeFinanceProbes([
    { path: '/receivables', status: 401, outcome: classifyProbe(401) },
  ]);
  assert.match(summary.reason, /AUTH/);
});

test('basta UMA sonda autorizada: finance-overview e composta', () => {
  // O menu mostra Financeiro se receber OU pagar OU caixa abrir. Exigir as tres
  // esconderia o modulo de quem so tem permissao parcial - foi o caso de Despesas.
  const summary = summarizeFinanceProbes([
    { path: '/receivables', status: 403, outcome: classifyProbe(403) },
    { path: '/payables', status: 403, outcome: classifyProbe(403) },
    { path: '/treasury/accounts', status: 200, outcome: classifyProbe(200) },
  ]);
  assert.equal(summary.visible, true);
  assert.equal(summary.evidence.path, '/treasury/accounts');
});

test('status inesperado vira INDETERMINADO, nunca visivel', () => {
  const summary = summarizeFinanceProbes([
    { path: '/receivables', status: 500, outcome: classifyProbe(500) },
  ]);
  assert.equal(summary.visible, false);
  // 500 nao pode virar verde: ausencia de prova nao e prova de autorizacao.
  assert.equal(summary.reason, 'INDETERMINADO');
});

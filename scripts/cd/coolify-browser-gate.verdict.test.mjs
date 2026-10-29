import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideReleaseVerdict } from './coolify-browser-gate.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * O VEREDITO DO GATE, POR COMPORTAMENTO — NÃO POR REGEX NO FONTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DEFEITO REAL QUE ESTES TESTES IMPEDEM DE VOLTAR (medido em produção)
 *
 * O gate saía com `exitCode = 0` baseado apenas em `passed === total`. O bloco
 * NOT_APPLICABLE registrava `record(..., true, 'N/A')` para não pintar de vermelho
 * uma tela saudável, e o TOTAL passou a contar N/A como PASS.
 *
 * Resultado concreto, observado:
 *
 *   runtimeVerified  = true
 *   businessVerified = false
 *   passed === total = true
 *   exitCode         = 0        ← pipeline VERDE sem ter provado o negócio
 *
 * A suíte antiga afirmava `assert.match(source, /businessVerified/)` e ficava
 * verde o tempo todo: provava que a palavra existia no arquivo, não que ela
 * decidia alguma coisa. Teste que não falha quando a proteção é removida não
 * protege nada.
 *
 * Estes quatro casos exercitam a DECISÃO.
 */
describe('decideReleaseVerdict — runtime, release e business independentes', () => {
  it('cadeia empresarial completa valida a produção', () => {
    const verdict = decideReleaseVerdict({
      passed: 20,
      total: 20,
      runtimeVerified: true,
      releasePrerequisitesVerified: true,
      businessEvidenceAvailable: true,
      businessVerified: true,
    });

    assert.equal(verdict.assertionsPass, true);
    assert.equal(verdict.releaseVerified, true);
    assert.equal(verdict.businessEvidenceAvailable, true);
    assert.equal(verdict.productionRuntimeValidated, true);
    assert.equal(verdict.productionBusinessValidated, true);
    assert.equal(verdict.productionValidated, true);
    assert.equal(verdict.exitCode, 0);
  });

  it('sem evidência operacional, runtime/release ficam condicionais sem aprovar negócio', () => {
    const verdict = decideReleaseVerdict({
      passed: 20,
      total: 20,
      runtimeVerified: true,
      releasePrerequisitesVerified: true,
      businessEvidenceAvailable: false,
      businessVerified: false,
    });

    assert.equal(verdict.assertionsPass, true);
    assert.equal(verdict.businessVerified, false);
    assert.equal(verdict.releaseVerified, true);
    assert.equal(verdict.productionRuntimeValidated, true);
    assert.equal(verdict.productionBusinessValidated, 'NOT_APPLICABLE');
    assert.equal(verdict.productionValidated, 'CONDITIONAL');
    assert.equal(verdict.exitCode, 0);
  });

  it('evidência incompleta reprova o bloco empresarial', () => {
    const verdict = decideReleaseVerdict({
      passed: 20,
      total: 20,
      runtimeVerified: true,
      releasePrerequisitesVerified: true,
      businessEvidenceAvailable: true,
      businessVerified: false,
    });

    assert.equal(verdict.productionRuntimeValidated, true);
    assert.equal(verdict.productionBusinessValidated, false);
    assert.equal(verdict.productionValidated, false);
    assert.equal(verdict.exitCode, 1);
  });

  it('release inválida reprova mesmo com runtime e negócio válidos', () => {
    const verdict = decideReleaseVerdict({
      passed: 20,
      total: 20,
      runtimeVerified: true,
      releasePrerequisitesVerified: false,
      businessEvidenceAvailable: true,
      businessVerified: true,
    });

    assert.equal(verdict.releaseVerified, false);
    assert.equal(verdict.productionRuntimeValidated, false);
    assert.equal(verdict.exitCode, 1);
  });

  it('CASO 3: runtime NÃO verificado → exit != 0, mesmo com assertivas verdes', () => {
    const verdict = decideReleaseVerdict({
      passed: 20,
      total: 20,
      runtimeVerified: false,
      releasePrerequisitesVerified: true,
      businessEvidenceAvailable: false,
      businessVerified: false,
    });

    assert.equal(verdict.runtimeVerified, false);
    assert.notEqual(verdict.exitCode, 0);
  });

  it('CASO 4: uma assertiva falhou → exit != 0, mesmo com negócio verificado', () => {
    const verdict = decideReleaseVerdict({
      passed: 19,
      total: 20,
      runtimeVerified: true,
      releasePrerequisitesVerified: true,
      businessEvidenceAvailable: true,
      businessVerified: true,
    });

    assert.equal(verdict.assertionsPass, false);
    assert.equal(verdict.releaseVerified, false);
    assert.notEqual(verdict.exitCode, 0);
  });

  it('NENHUMA asserção avaliada não aprova por vacuidade', () => {
    // `0 === 0` seria verdadeiro; um gate que não rodou nada não pode passar.
    const verdict = decideReleaseVerdict({
      passed: 0,
      total: 0,
      runtimeVerified: true,
      releasePrerequisitesVerified: true,
      businessEvidenceAvailable: false,
      businessVerified: true,
    });

    assert.equal(verdict.assertionsPass, false);
    assert.notEqual(verdict.exitCode, 0);
  });

  it('vereditos não-verdadeiros não passam por coerção', () => {
    // `'true'`, `1` e `{}` são truthy em JS mas NÃO são verificação.
    const verdict = decideReleaseVerdict({
      passed: 20,
      total: 20,
      runtimeVerified: 'true',
      releasePrerequisitesVerified: true,
      businessEvidenceAvailable: true,
      businessVerified: 1,
    });

    assert.equal(verdict.runtimeVerified, false);
    assert.equal(verdict.businessVerified, false);
    assert.notEqual(verdict.exitCode, 0);
  });
});

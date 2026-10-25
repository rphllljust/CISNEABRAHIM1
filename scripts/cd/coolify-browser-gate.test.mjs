import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { it, describe } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * COBERTURA DE PRODUÇÃO DA CAPABILITY DE MEDIÇÃO NO BROWSER GATE.
 *
 * DEFEITO QUE ESTE TESTE IMPEDE
 *
 * O browser gate nasceu provando a trilha econômica da contabilidade. Quando a
 * vertical de medição → aceite → elegibilidade de faturamento foi entregue, o
 * gate continuaria verde SEM tocar na capability nova: um release poderia
 * publicar uma estação de trabalho quebrada e ainda assim ser declarado pronto,
 * porque o portão nunca abriu a página.
 *
 * Release "verde" que não exercita a superfície entregue é o pior tipo de falso
 * positivo: ele não erra por omissão de dado, erra por AFIRMAR sucesso sobre o
 * que não olhou.
 *
 * Os testes leem o SCRIPT REAL e exigem que as asserções da capability existam.
 * Remover a cobertura de produção reprova aqui, no CI, antes do deploy.
 */
const here = dirname(fileURLToPath(import.meta.url));
const GATE_PATH = join(here, 'coolify-browser-gate.mjs');

function readGate() {
  return readFileSync(GATE_PATH, 'utf8');
}

describe('browser gate — cobertura da vertical de medição', () => {
  it('abre a página de medição e não apenas a trilha econômica', () => {
    const source = readGate();
    assert.ok(
      source.includes('/app/measurement'),
      'o gate precisa visitar /app/measurement para provar a capability',
    );
  });

  it('exige que a medição apresente elegibilidade de faturamento', () => {
    const source = readGate();
    assert.match(
      source,
      /Elegib\|READY_TO_BILL|Elegib\|READY_TO_BILL\|Pronto para faturar/,
      'a asserção de elegibilidade de faturamento saiu do gate',
    );
  });

  it('exige que a medição apresente o aceite do cliente', () => {
    const source = readGate();
    assert.match(source, /Aceite\|ACEITE/, 'a asserção de aceite saiu do gate');
  });

  /**
   * A ASSERÇÃO NEGATIVA É O CORAÇÃO DESTA RELEASE.
   *
   * Medir em `HOUR`/`KM` significa que fato físico virou quantidade comercial —
   * exatamente o defeito que a fronteira comercial/física corrigiu. Se alguém
   * reintroduzir a soma de unidades heterogêneas na base de medição, o gate em
   * produção precisa reprovar.
   */
  it('proíbe medida em unidade física', () => {
    const source = readGate();
    assert.match(
      source,
      /MEDIÇÃO não mede em unidade física/,
      'a asserção que impede medir em HOUR/KM saiu do gate',
    );
  });

  it('reprova FEATURE_DISABLED e vazamento de nome de classe do framework', () => {
    const source = readGate();
    assert.match(source, /FEATURE_DISABLED/, 'a asserção de FEATURE_DISABLED saiu do gate');
    assert.match(
      source,
      /Measurements Http Exception/,
      'a asserção de ruído de framework saiu do gate',
    );
  });

  it('reprova 403/404 nas rotas de medição', () => {
    const source = readGate();
    assert.match(
      source,
      /SEM 403\/404 nas rotas de medição/,
      'a asserção de autorização das rotas de medição saiu do gate',
    );
  });

  /**
   * ESTADO VAZIO É RESULTADO LEGÍTIMO, NÃO AUSÊNCIA DE PROVA.
   *
   * A tela exige `unitId` na URL antes de carregar a fila. Sem ele mostra a
   * instrução — comportamento CORRETO do produto, medido em produção com 16 chars.
   *
   * O gate precisa registrar isso como N/A EXPLÍCITO com MOTIVO, e não pular o
   * bloco em silêncio. Silêncio é indistinguível de "não verifiquei".
   */
  it('estado vazio da medição é N/A explícito, nunca omissão', () => {
    const source = readGate();
    assert.match(
      source,
      /N\/A — \$\{reason\}/,
      'o curto-circuito de estado vazio precisa declarar N/A com motivo',
    );
    assert.match(
      source,
      /sem unidade na URL/,
      'o motivo do N/A precisa nomear a causa real: unidade ausente',
    );
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * "RENDERIZADA" NÃO É "LONGA"
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * A asserção `length > 200` reprovou produção com `16 chars` — que eram a
   * instrução correta da tela. Exigir volume de texto é falso negativo por
   * TAMANHO, irmão do falso negativo por vocabulário.
   *
   * O que a asserção deve provar é que a aplicação APARECEU.
   */
  it('renderização é provada por shell visível, não por volume de texto', () => {
    const source = readGate();
    assert.match(
      source,
      /shellRendered/,
      'a prova de renderização precisa do shell, não do tamanho do texto',
    );
    // O comentário que documenta o defeito CITA a asserção antiga; o que não pode
    // voltar é a CHAMADA executável. `record(` é o que registra a asserção.
    assert.doesNotMatch(
      source,
      /record\(\s*'MEDIÇÃO renderizada',\s*\n?\s*measurementText\.length > 200/,
      'limiar arbitrário de texto reprovou tela saudável; não pode voltar',
    );
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * A DETECÇÃO É ESTRUTURAL, NÃO POR PALAVRA
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * A primeira versão procurava /Nenhuma|Vazio|sem ordem/ no TEXTO da página e
   * reprovou produção com `MEDIÇÃO renderizada — 331 chars`: a página estava
   * correta, só não usava a palavra que o regex esperava.
   *
   * Reprovar por vocabulário é falso negativo por SELETOR — o mesmo defeito que
   * o gate da contabilidade já havia corrigido ao parar de procurar o `aria-label`
   * no conteúdo visível. O critério tem de ser o que a tela precisa para operar:
   * uma ordem selecionada.
   */
  it('estado vazio é decidido por ordem selecionada, não por vocabulário', () => {
    const source = readGate();
    assert.match(
      source,
      /hasSelectedOrder/,
      'o gate precisa decidir estado vazio por estrutura (ordem selecionada)',
    );
    assert.doesNotMatch(
      source,
      /noMeasurementOrder/,
      'a detecção por vocabulário reprovou produção saudável; não pode voltar',
    );
  });
});

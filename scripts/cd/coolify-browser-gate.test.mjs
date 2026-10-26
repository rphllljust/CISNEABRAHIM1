import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { it, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  evaluateMeasurementBusinessProof,
  hasOnlyCommercialMeasurementUnits,
} from './coolify-browser-gate.mjs';

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

  it('prova negócio somente com estados autoritativos do payload', () => {
    const proof = evaluateMeasurementBusinessProof({
      acceptance: { state: 'ACCEPTED', latest: { result: 'ACCEPTED' } },
      billingEligibility: { result: 'READY' },
      quantities: { lines: [{ unitOfMeasure: 'DAY' }] },
      measurementBasis: { lines: [{ unitCode: 'DAY' }] },
      items: [{ unitCode: 'DAY' }],
    });

    assert.equal(proof.acceptanceVerified, true);
    assert.equal(proof.eligibilityVerified, true);
    assert.equal(proof.commercialUnitVerified, true);
    assert.equal(proof.verified, true);
  });

  it('títulos sem estado autoritativo nunca aprovam negócio', () => {
    const proof = evaluateMeasurementBusinessProof({
      title: 'Aceite do cliente · Elegibilidade de faturamento',
      acceptance: {},
      billingEligibility: {},
      quantities: { lines: [] },
      measurementBasis: { lines: [] },
      items: [],
    });

    assert.equal(proof.acceptanceVerified, false);
    assert.equal(proof.eligibilityVerified, false);
    assert.equal(proof.verified, false);
  });

  it('estado BLOCKED/PENDING ainda é prova semântica autoritativa, não READY inventado', () => {
    const proof = evaluateMeasurementBusinessProof({
      acceptance: { state: 'PENDING', latest: null },
      billingEligibility: { result: 'BLOCKED' },
      quantities: { lines: [{ unitOfMeasure: 'TRIP' }] },
      measurementBasis: { lines: [] },
      items: [],
    });

    assert.equal(proof.acceptanceVerified, true);
    assert.equal(proof.eligibilityVerified, true);
    assert.equal(proof.verified, true);
  });

  it('HOUR ou KM reprova mesmo misturado com DAY/TRIP/M3', () => {
    assert.equal(
      hasOnlyCommercialMeasurementUnits({
        quantities: { lines: [{ unitOfMeasure: 'DAY' }, { unitOfMeasure: 'KM' }] },
        measurementBasis: { lines: [{ unitCode: 'TRIP' }] },
        items: [{ unitCode: 'M3' }],
      }),
      false,
    );
    assert.equal(
      hasOnlyCommercialMeasurementUnits({
        quantities: { lines: [{ unitOfMeasure: 'HOUR' }, { unitOfMeasure: 'DAY' }] },
        measurementBasis: { lines: [] },
        items: [],
      }),
      false,
    );
    assert.equal(
      hasOnlyCommercialMeasurementUnits({
        quantities: { lines: [{ unitOfMeasure: 'DAY' }] },
        measurementBasis: { lines: [{ unitCode: 'TRIP' }] },
        items: [{ unitCode: 'M3' }],
      }),
      true,
    );
    assert.equal(
      hasOnlyCommercialMeasurementUnits({
        quantities: { lines: [] },
        measurementBasis: { lines: [] },
        items: [],
      }),
      false,
      'ausência de unidade não é prova de unidade comercial',
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
   * ─────────────────────────────────────────────────────────────────────────────
   * ESTADO VAZIO NÃO É APROVAÇÃO DE NEGÓCIO
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * Abrir a estação sem unidade prova apenas que a tela sabe pedir a unidade.
   * Num release de aceite, chamar isso de PASS é afirmar sucesso sobre o que não
   * se olhou.
   *
   * O gate precisa declarar NOT_APPLICABLE com motivo, e o veredito de negócio
   * precisa ficar SEPARADO do veredito de runtime.
   */
  it('estado vazio é NOT_APPLICABLE explícito, nunca aprovação de negócio', () => {
    const source = readGate();
    assert.match(
      source,
      /NOT_APPLICABLE — nenhuma medição na fila desta unidade/,
      'o motivo do N/A precisa ser declarado com o nome correto',
    );
    assert.match(
      source,
      /businessVerified = false|businessVerified/,
      'o veredito de negócio precisa existir e ser separado do de runtime',
    );
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * A UNIDADE VEM DO SERVIDOR, NÃO DE FIXTURE
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * Sem `unitId` a estação não carrega fila, e o gate ficaria eternamente em N/A.
   * A unidade precisa ser resolvida da resposta REAL de `/api/v1/me`, nunca
   * inventada nem assumida como `UN-PROD-001`.
   */
  it('resolução de unidade vem do servidor autenticado', () => {
    const source = readGate();
    assert.match(source, /resolvedUnitId/, 'o gate precisa resolver a unidade real');
    assert.match(
      source,
      /\/api\/v1\/me/,
      'a unidade deve vir de /api/v1/me, não de constante',
    );
    assert.doesNotMatch(
      source,
      /'UN-PROD-001'|"UN-PROD-001"/,
      'unidade não pode ser inventada no gate',
    );
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * A UNIDADE VEM DA FAIXA DE RESUMO QUE O OPERADOR VÊ
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * MEDIDO EM PRODUÇÃO (release 40237829572):
   *
   *   FAIL  UNIDADE operacional resolvida pelo servidor
   *         — nenhuma unidade publicada para o operador
   *
   * `/api/v1/me` devolve identidade e permissões, NÃO a unidade operacional. A
   * unidade aparece na faixa de resumo: `UNIDADE UN-PROD-001`, que a asserção
   * seguinte já lê.
   *
   * Este teste trava a fonte: a unidade tem de ser EXTRAÍDA do texto renderizado,
   * não presumida de um endpoint que não a publica.
   */
  it('unidade é extraída da faixa de resumo renderizada', () => {
    const source = readGate();
    assert.match(
      source,
      /unitFromStrip/,
      'a unidade deve ser extraída da faixa de resumo',
    );
    assert.match(
      source,
      /UNIDADE\\s\+/,
      'o extrator precisa casar o rótulo que a faixa realmente exibe',
    );
  });

  /**
   * PROVA DE NEGÓCIO EXIGE ORDEM REAL NA FILA — e entra por ela, como o operador.
   */
  it('prova de negócio entra pela fila e exige aceite + elegibilidade', () => {
    const source = readGate();
    assert.match(
      source,
      /ul\[aria-label="Itens de trabalho da medição"\] button/,
      'o gate precisa usar o contrato acessível real da fila',
    );
    assert.doesNotMatch(
      source,
      /button\[data-service-order-id\]/,
      'o componente real não publica data-service-order-id; esse seletor não pode voltar',
    );
    assert.match(
      source,
      /measurementWorkbenchRequests/,
      'o gate precisa observar requests de workbench para provar o lifecycle',
    );
    assert.match(
      source,
      /businessVerified = businessProof\.verified/,
      'negócio só é verificado pelo resultado semântico do payload autoritativo',
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
  it('estado vazio é decidido por estrutura, não por vocabulário', () => {
    const source = readGate();
    assert.match(
      source,
      /queueCount/,
      'o gate precisa decidir estado vazio pela fila real, não por palavra na tela',
    );
    assert.doesNotMatch(
      source,
      /noMeasurementOrder/,
      'a detecção por vocabulário reprovou produção saudável; não pode voltar',
    );
  });
});

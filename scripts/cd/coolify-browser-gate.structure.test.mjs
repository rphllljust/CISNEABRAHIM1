import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractOperationalUnit } from './coolify-browser-gate.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * O GATE NÃO PODE TER CÓDIGO ÚTIL DENTRO DE COMENTÁRIO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DEFEITO REAL (release 40237829572 e o SHA 2655856a)
 *
 * Um delimitador de fim de comentário desapareceu ao editar o bloco que documenta
 * a resolução de unidade. O efeito não foi um erro de sintaxe: a partir dali,
 * `page.goto`, a espera da navegação e a leitura da worklist ficaram DENTRO do
 * comentário. Depois, o código usava `worklistText`, que nunca era criado.
 *
 * O que os gates existentes disseram:
 *
 *   node --check                 → PASSOU (é comentário válido)
 *   assert.match(source, /.../)  → PASSOU (o texto continua no arquivo)
 *
 * Ou seja: sintaxe válida e regex satisfeita, com o código morto. A única forma
 * de pegar isso é provar que o módulo EXECUTA e que a função devolve o esperado.
 *
 * Este arquivo importa o módulo de verdade. Se um comentário engolir a declaração
 * de `worklistText`, o import continua funcionando — mas o teste de ordem
 * estrutural abaixo reprova, e o de extração falha se a função sumir.
 */
const here = dirname(fileURLToPath(import.meta.url));
const GATE_PATH = join(here, 'coolify-browser-gate.mjs');

function readGate() {
  return readFileSync(GATE_PATH, 'utf8');
}

/**
 * Remove comentários de forma ingênua-mas-suficiente para um arquivo nosso:
 * o que sobrar é CÓDIGO EXECUTÁVEL. É assim que se prova que uma linha não está
 * comentada — sem depender de AST nem de regex sobre o texto bruto.
 */
function executableSource(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('extractOperationalUnit — extração por comportamento', () => {
  it('extrai o código da faixa de resumo real', () => {
    const strip = 'UNIDADE UN-PROD-001   1 FALHARAM   0 PENDENTES   0 ESTORNADAS';
    assert.equal(extractOperationalUnit(strip), 'UN-PROD-001');
  });

  it('aceita código com ponto, hífen e underscore', () => {
    assert.equal(extractOperationalUnit('UNIDADE MATRIZ.SP-01 '), 'MATRIZ.SP-01');
  });

  it('devolve null quando a faixa não traz unidade', () => {
    assert.equal(extractOperationalUnit('Nenhum fato econômico nesta unidade'), null);
  });

  it('devolve null para entrada não-textual — nunca lança', () => {
    assert.equal(extractOperationalUnit(undefined), null);
    assert.equal(extractOperationalUnit(null), null);
    assert.equal(extractOperationalUnit(42), null);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * RÓTULO DE INTERFACE NÃO É CÓDIGO DE UNIDADE
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * DEFEITO REAL MEDIDO EM PRODUÇÃO (release 40241021656):
   *
   *   PASS  UNIDADE operacional resolvida pelo servidor — Selecione
   *
   * O gate extraiu "Selecione" — palavra do SELETOR de unidade da tela — e montou
   * `/app/measurement?unitId=Selecione`. O backend não reconheceu, o guard
   * redirecionou, e a estação nunca renderizou:
   *
   *   FAIL  MEDIÇÃO renderizada — 16 chars, shell=ausente
   *
   * Um valor plausível e errado é PIOR que nenhum: com null o gate sabe que não
   * tem unidade; com "Selecione" ele acha que tem.
   */
  it('rejeita rótulos de interface como unidade', () => {
    assert.equal(extractOperationalUnit('UNIDADE Selecione'), null);
    assert.equal(extractOperationalUnit('UNIDADE Selecione unidade para continuar'), null);
    assert.equal(extractOperationalUnit('UNIDADE Todas as unidades'), null);
    assert.equal(extractOperationalUnit('UNIDADE Carregando'), null);
  });

  it('aceita código real que contém separador ou dígito', () => {
    assert.equal(extractOperationalUnit('UNIDADE UN-PROD-001'), 'UN-PROD-001');
    assert.equal(extractOperationalUnit('UNIDADE MATRIZ.SP-01'), 'MATRIZ.SP-01');
    assert.equal(extractOperationalUnit('UNIDADE FILIAL_2'), 'FILIAL_2');
  });
});

describe('o gate executa — código útil não pode estar comentado', () => {
  /**
   * A PROVA CENTRAL: `worklistText` e a navegação precisam estar em CÓDIGO
   * EXECUTÁVEL, não dentro de comentário. Uma regex no texto bruto não distingue
   * os dois casos; remover os comentários, sim.
   */
  it('worklistText está em código executável', () => {
    const code = executableSource(readGate());
    assert.match(
      code,
      /const worklistText = await page\.locator\('body'\)\.innerText\(\);/,
      'worklistText ficou dentro de um comentário — o gate usaria variável inexistente',
    );
  });

  it('a navegação para a controladoria está em código executável', () => {
    const code = executableSource(readGate());
    assert.match(
      code,
      /await page\.goto\(`\$\{webUrl\}\/app\/accounting\/economic-posting`/,
      'a navegação ficou dentro de um comentário',
    );
  });

  it('a extração usa a função pura, sobre o texto da worklist', () => {
    const code = executableSource(readGate());
    assert.match(
      code,
      /const unitFromStrip = extractOperationalUnit\(worklistText\);/,
      'a unidade precisa ser extraída do texto realmente lido',
    );
  });

  /**
   * A ORDEM IMPORTA: ler a worklist antes de navegar para ela devolveria o corpo
   * da página anterior — um valor plausível e errado.
   */
  it('a worklist é lida DEPOIS da navegação, não antes', () => {
    const code = executableSource(readGate());
    const navIndex = code.indexOf('/app/accounting/economic-posting');
    const worklistIndex = code.indexOf("const worklistText = await page.locator('body').innerText();");
    assert.ok(navIndex > 0 && worklistIndex > 0, 'trechos ausentes');
    assert.ok(
      navIndex < worklistIndex,
      'a leitura da worklist acontece antes da navegação: leria a página errada',
    );
  });

  /**
   * `resolvedUnitId` precisa existir em código executável E alimentar a URL da
   * medição. Unidade extraída e não usada não prova nada.
   */
  it('resolvedUnitId alimenta a URL de medição', () => {
    const code = executableSource(readGate());
    assert.match(code, /const resolvedUnitId = unitFromStrip \?\? unitIdFromSession;/);
    assert.match(code, /measurement\?unitId=\$\{encodeURIComponent\(resolvedUnitId\)\}/);
  });
});

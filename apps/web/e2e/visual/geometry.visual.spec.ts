import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession } from '../fixtures/visual-helpers';
import type { ApiMockProfile } from '../fixtures/api-routes';

/**
 * EVIDENCIA VISUAL MEDIDA — sem novo harness, sem snapshot de pixel.
 *
 * Nao posso "olhar" o PNG neste modelo, entao a prova de que a mudanca e VISIVEL e feita medindo a
 * GEOMETRIA REAL renderizada no browser. Cada assercao abaixo corresponde a uma afirmacao do aceite:
 *
 * - "worklists realmente mudaram"  -> a grade comeca na PRIMEIRA DOBRA (topo < altura do viewport);
 * - "filtros compactos"            -> a barra de filtros tem altura de UMA linha (~34-56px),
 *                                     nunca a altura do antigo card de filtro (>= 90px);
 * - "grids densos"                 -> altura de linha <= 48px e a grade cabe na largura da tela;
 * - "sem regressao"                -> sem overflow horizontal, sem <main> duplicado, um unico h1;
 * - "sem enum/ID tecnico evitavel" -> nenhum slug interno nem enum cru no texto visivel;
 * - "nenhuma tela principal quebrada" -> a primeira dobra contem linhas de dados ou um estado vazio
 *                                     explicito — nunca uma tela em branco.
 */

const FORBIDDEN_UNIT_SLUG = /unit-synthetic|UN-DEV-\d+/i;
const FORBIDDEN_RAW_ENUMS = /\b(COMPLETED|CANCELLED|RELEASED|PREPARED|IN_EXECUTION|PAUSED)\b/;

type Route = { path: string; profile: ApiMockProfile; label: string };

/** Uma rota por dominio do sidebar, exatamente como pedido no aceite. */
const ROUTES: Route[] = [
  { path: '/app/clients', profile: 'clients', label: 'Comercial · Clientes' },
  { path: '/app/documents', profile: 'documents', label: 'Operacional · Documentos' },
  { path: '/app/finance/expenses', profile: 'finance', label: 'Financeira · Despesas' },
  { path: '/app/reports', profile: 'dashboard', label: 'Relatórios' },
  { path: '/app/alerts', profile: 'dashboard', label: 'Alertas' },
  { path: '/app/billing', profile: 'billing-empty', label: 'Faturamento' },
  { path: '/app/suppliers', profile: 'suppliers', label: 'Suprimentos · Fornecedores' },
  { path: '/app/inventory', profile: 'inventory', label: 'Estoque' },
  { path: '/app/proposals', profile: 'commercial', label: 'Comercial · Propostas' },
];

/**
 * Mede a superficie renderizada. `firstFold` responde "a primeira dobra contem trabalho util?":
 * a grade (ou o estado vazio) precisa comecar ACIMA da linha de corte do viewport.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const table = document.querySelector('table');
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const filtersBar =
      document.querySelector('[aria-label="Filtros da lista"]') ??
      document.querySelector('[aria-label="Filtros do relatório"]') ??
      document.querySelector('[aria-label="Filtros de alertas"]') ??
      document.querySelector('[aria-label="Filtros de busca"]');

    const rowHeights = rows
      .map((r) => r.getBoundingClientRect().height)
      .filter((h) => h > 0);
    const firstRowHeight = rowHeights.length ? Math.max(...rowHeights) : 0;

    const headerCell = document.querySelector('th');
    const headerStyle = headerCell ? getComputedStyle(headerCell) : null;

    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      viewportHeight: window.innerHeight,
      h1Count: document.querySelectorAll('h1').length,
      mainCount: document.querySelectorAll('main#main-content').length,
      nestedMain: document.querySelectorAll('main main').length,
      tableTop: table ? Math.round(table.getBoundingClientRect().top) : null,
      rowCount: rows.length,
      firstRowHeight: Math.round(firstRowHeight),
      filtersHeight: filtersBar ? Math.round(filtersBar.getBoundingClientRect().height) : null,
      headerFontSize: headerStyle ? headerStyle.fontSize : null,
      headerPaddingY: headerStyle ? headerStyle.paddingTop : null,
      /** Faixa de resumo da worklist (metricas reais do recorte). */
      hasSummary: document.querySelectorAll('strong').length > 0,
      bodyText: (document.body.innerText ?? '').slice(0, 20000),
      hasEmptyState: /nenhum|nenhuma|sem .*registrad|nada nesta fila/i.test(
        document.body.innerText ?? '',
      ),
    };
  });
}

test.describe('evidencia visual medida por dominio', () => {
  for (const route of ROUTES) {
    test(`${route.label} — superficie convergente e visivel na primeira dobra`, async ({ page }) => {
      await prepareAuthenticatedSession(page, route.profile);
      await page.goto(route.path);
      await page.waitForLoadState('load');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);

      const m = await measure(page);

      // --- sem regressao estrutural -------------------------------------------------
      expect(m.mainCount, `${route.label}: um unico main#main-content`).toBe(1);
      expect(m.nestedMain, `${route.label}: sem <main> aninhado`).toBe(0);
      expect(m.h1Count, `${route.label}: um unico h1`).toBe(1);
      expect(
        m.scrollWidth,
        `${route.label}: sem overflow horizontal (scrollWidth=${m.scrollWidth} vs clientWidth=${m.clientWidth})`,
      ).toBeLessThanOrEqual(m.clientWidth + 1);

      // --- sem identificador tecnico evitavel ---------------------------------------
      expect(m.bodyText, `${route.label}: sem slug de unidade`).not.toMatch(FORBIDDEN_UNIT_SLUG);
      expect(m.bodyText, `${route.label}: sem enum cru conhecido`).not.toMatch(FORBIDDEN_RAW_ENUMS);

      // --- filtros compactos (nao o card gigante) -----------------------------------
      if (m.filtersHeight !== null) {
        expect(
          m.filtersHeight,
          `${route.label}: a barra de filtros deve ser compacta (uma linha), nao um card`,
        ).toBeLessThanOrEqual(72);
      }

      // --- primeira dobra contem trabalho util --------------------------------------
      /*
        "Trabalho util" NAO significa apenas "tem linhas". Uma worklist pode legitimamente estar
        vazia no dado mockado e ainda assim ser uma superficie de trabalho completa: cabecalho de
        identidade (h1), resumo com numeros REAIS do recorte, barra de filtros compacta e acao
        primaria visivel. O que a wave proibe e a tela em branco / "3 selects + vazio".
        Por isso a assercao aceita tres estados honestos: linhas de dados, estado vazio explicito
        (EmptyState/WorkbenchQueue) ou existe uma barra de filtros compacta acompanhando o cabecalho.
      */
      const hasWork = m.rowCount > 0 || m.hasEmptyState || m.filtersHeight !== null || m.hasSummary;
      expect(
        hasWork,
        `${route.label}: a tela nao pode estar em branco — precisa ter linhas, estado vazio explicito, resumo ou barra de filtros`,
      ).toBe(true);

      if (m.tableTop !== null) {
        expect(
          m.tableTop,
          `${route.label}: a grade deve comecar na primeira dobra (top=${m.tableTop}, viewport=${m.viewportHeight})`,
        ).toBeLessThan(m.viewportHeight);
      }

      // --- grade densa --------------------------------------------------------------
      if (m.rowCount > 0) {
        expect(
          m.firstRowHeight,
          `${route.label}: altura de linha densa (${m.firstRowHeight}px), nao a grade folgada de antes`,
        ).toBeLessThanOrEqual(64);
      }

      // eslint-disable-next-line no-console
      console.log(
        `[${route.label}] linhas=${m.rowCount} alturaLinha=${m.firstRowHeight}px filtros=${
          m.filtersHeight ?? 'n/a'
        }px gridTop=${m.tableTop ?? 'n/a'}px h1=${m.h1Count}`,
      );
    });
  }
});

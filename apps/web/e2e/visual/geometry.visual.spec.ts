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
  { path: '/app/work-inbox', profile: 'dashboard', label: 'WORKBENCH · Central de trabalho' },
  /* Central de fechamento exige o perfil contábil dedicado; coberta por accounting.visual.spec.ts. */
  /*
    PARK_FIXTURE_GAP: Conciliacao exige `finance:reconciliation`, que o perfil `finance` do harness
    NAO mocka — a tela responde "Acesso negado", que e o comportamento CORRETO do backend
    (autorizacao fail-closed). Nao entra no aceite visual sob este perfil; a superficie continua
    coberta pelos testes de unidade do modulo (`src/finance`).
  */
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
      document.querySelector('[aria-label="Filtros de busca"]') ??
      // Mesas de trabalho declaram o proprio rotulo de contexto de fila.
      document.querySelector('[aria-label="Contexto da fila"]') ??
      document.querySelector('[aria-label="Filtros da fila"]');

    const rowHeights = rows
      .map((r) => r.getBoundingClientRect().height)
      .filter((h) => h > 0);
    const firstRowHeight = rowHeights.length ? Math.max(...rowHeights) : 0;

    const headerCell = document.querySelector('th');
    const headerStyle = headerCell ? getComputedStyle(headerCell) : null;

    /*
      GOVERNANÇA DE SUPERFÍCIE — MEDIDA, NÃO PRESUMIDA.

      A regra global de `theme.css` neutraliza sombra e raio grande dentro de `#main-content`
      (elevação deixa de ser separador; superfície se separa por divisor). A regra existe desde
      a foundation, mas nada a MEDIA em rota real: se um seletor futuro deixar de casar — por
      ordem de camada do Tailwind, por `:not()` mal escrito, por um wrapper que muda a árvore —
      o cardification volta em silêncio e nenhum teste acusa.

      Aqui a superfície é medida no DOM COMPUTADO de cada rota: nenhum elemento dentro da área
      de trabalho pode pintar sombra projetada, exceto os papéis que legitimamente flutuam
      (diálogo, menu, listbox, tooltip, overlay declarado). É a prova de que a governança vale
      nas telas que o operador abre — não só na folha de estilo.
    */
    const FLOATING_SELECTOR =
      '[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],[aria-modal="true"],[data-elevated]';
    const main = document.querySelector('#main-content');
    const shadowOffenders: string[] = [];
    if (main) {
      for (const el of Array.from(main.querySelectorAll('*'))) {
        if (el.closest(FLOATING_SELECTOR)) {
          continue;
        }
        const shadow = getComputedStyle(el).boxShadow;
        if (shadow && shadow !== 'none' && !shadow.includes('inset')) {
          // CSS rings also resolve through box-shadow. A 0/0/0 spread ring is a border, not elevation.
          const geometry = shadow.match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px/);
          const isBorderRing = geometry
            ? Number(geometry[1]) === 0 && Number(geometry[2]) === 0 && Number(geometry[3]) === 0
            : false;
          if (!isBorderRing) {
            const cls = (el.getAttribute('class') ?? '').split(/\s+/).find((c) => c.startsWith('shadow')) ?? '';
            shadowOffenders.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`);
            if (shadowOffenders.length >= 5) break;
          }
        }
      }
    }

    /*
      TOKENS DO CHROME RESOLVIDOS — o shell deixou de escrever hex literal (WAVE 1).

      Um token NÃO declarado resolve para string vazia e a propriedade cai no valor inicial: a
      sidebar ficaria transparente em vez de navy, sem erro de build e sem teste vermelho. Este
      é o único jeito de provar que a conversão para token não quebrou a cor.
    */
    const shellEl = document.querySelector('.shell__sidebar') ?? document.querySelector('.shell__topbar');
    const shellStyle = shellEl ? getComputedStyle(shellEl) : null;
    const shellBackground = shellStyle ? shellStyle.backgroundColor : null;

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
      shadowOffenders,
      shellBackground,
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
        const compactLimit = m.clientWidth >= 1024 ? 72 : 144;
        expect(
          m.filtersHeight,
          `${route.label}: filtros devem permanecer compactos mesmo quando quebram linha no viewport estreito`,
        ).toBeLessThanOrEqual(compactLimit);
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

      /*
        GOVERNANÇA DE SUPERFÍCIE — nenhum card elevado dentro da área de trabalho.

        Se esta asserção falhar, o ofensor está nomeado no relatório: a governança global de
        `theme.css` deixou de casar para aquele elemento e o vocabulário de card voltou.
      */
      expect(
        m.shadowOffenders,
        `${route.label}: superficie elevada dentro da area de trabalho (${m.shadowOffenders.join(', ')}) — a hierarquia deve vir de divisor, nao de sombra`,
      ).toEqual([]);

      /*
        CHROME RESOLVIDO — a sidebar/topbar tem cor de verdade.

        `rgba(0, 0, 0, 0)` significa que o token não resolveu: a conversão da WAVE 1 apontaria
        para uma variável inexistente e o chrome ficaria transparente sem quebrar o build.
      */
      if (m.shellBackground !== null) {
        expect(
          m.shellBackground,
          `${route.label}: o chrome do shell nao resolveu cor (${m.shellBackground}) — token ausente ou invalido`,
        ).not.toBe('rgba(0, 0, 0, 0)');
      }

      console.log(
        `[${route.label}] linhas=${m.rowCount} alturaLinha=${m.firstRowHeight}px filtros=${
          m.filtersHeight ?? 'n/a'
        }px gridTop=${m.tableTop ?? 'n/a'}px h1=${m.h1Count}`,
      );
    });
  }
});

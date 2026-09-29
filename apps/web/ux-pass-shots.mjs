/**
 * CAPTURA VISUAL DAS 5 TELAS DESTA PASS — browser real, HML real, sessao autenticada.
 *
 * Antes/depois com o MESMO viewport (1440x900, primeira dobra) para a comparacao ser
 * honesta. Salva PNG por tela e um log textual do que esta de fato na primeira dobra,
 * para o diagnostico nao depender de leitura humana da imagem.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';

const WEB = process.env.HML_WEB_URL ?? 'http://192.168.1.89:5174';
const API = process.env.HML_API_URL ?? 'http://192.168.1.89:3100';
const LOGIN = process.env.HML_SMOKE_LOGIN ?? 'hml-admin@cisne.invalid';
const PASSWORD = process.env.HML_SMOKE_PASSWORD ?? 'Synthetic-HML-Only-Password-123!';
const LABEL = process.env.SHOT_LABEL ?? 'before';
const OUT = `C:/CISNEABRAHIM/tmp/ux-pass/${LABEL}`;
const LOG = `C:/CISNEABRAHIM/tmp/ux-pass/${LABEL}.txt`;

mkdirSync(OUT, { recursive: true });
writeFileSync(LOG, `=== ${LABEL} @ ${new Date().toISOString()} ===\n`);

const SCREENS = [
  { id: 'catalogo', path: '/app/catalog' },
  { id: 'pessoas', path: '/app/people' },
  { id: 'nova-pessoa', path: '/app/people/new' },
  { id: 'documentos', path: '/app/documents' },
  { id: 'faturamento', path: '/app/billing' },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Login real pela tela.
await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
await page.locator('input[type="text"], input[name="login"], #login').first().fill(LOGIN);
await page.locator('input[type="password"]').first().fill(PASSWORD);
await page.getByRole('button', { name: /entrar/i }).first().click();
await page.getByText('ACESSO INSTITUCIONAL').waitFor({ state: 'detached', timeout: 45000 });
await page.waitForTimeout(1500);
appendFileSync(LOG, `login OK -> ${page.url()}\n`);

for (const screen of SCREENS) {
  await page.goto(`${WEB}${screen.path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);

  await page.screenshot({ path: `${OUT}/${screen.id}.png`, fullPage: false });

  const fold = await page.evaluate(() => {
    const text = (el) => (el?.innerText ?? '').replace(/\s+/g, ' ').trim();
    const rows = document.querySelectorAll('table tbody tr').length;
    const inputs = document.querySelectorAll('input, select, textarea').length;
    const firstCard = document.querySelector('main > div, main > section');

    /*
     * MEDIDA DE DENSIDADE E ESPACO OCIOSO, na primeira dobra (1440x900).
     * Nao e leitura visual: e a fracao da area util ocupada por texto real. Uma tela
     * que usa 8% da dobra com conteudo esta desperdicando a superficie.
     */
    const main = document.querySelector('main');
    const mainRect = main?.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    let textArea = 0;
    let elementsWithText = 0;
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.top > window.innerHeight || r.bottom < 0) continue;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join('');
      if (!own) continue;
      elementsWithText += 1;
      textArea += r.width * r.height;
    }
    // Colunas da tabela, quando existir: mede se a tabela carrega contexto ou so id.
    const headers = Array.from(document.querySelectorAll('table thead th')).map((th) => text(th));
    // Acao por linha: quantos links/botoes existem dentro das linhas.
    const rowActions = Array.from(document.querySelectorAll('table tbody tr')).map(
      (tr) => tr.querySelectorAll('a, button').length,
    );

    return {
      url: location.pathname + location.search,
      h1: text(document.querySelector('h1')),
      rowCount: rows,
      inputCount: inputs,
      columnHeaders: headers,
      rowActions,
      textCoveragePct: Math.round((textArea / viewportArea) * 1000) / 10,
      elementsWithText,
      mainHeightPx: Math.round(mainRect?.height ?? 0),
      firstBlock: text(firstCard).slice(0, 420),
      hasUuid: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
        document.body.innerText,
      ),
      hasTechnicalSlug: /unit-synthetic|unitId|clientId|assetId|periodId/i.test(
        document.body.innerText,
      ),
    };
  });

  appendFileSync(
    LOG,
    `\n--- ${screen.id} (${screen.path}) ---\n` +
      `URL: ${fold.url}\nH1: ${fold.h1}\nLinhas de tabela: ${fold.rowCount}\nControles: ${fold.inputCount}\n` +
      `Colunas: ${JSON.stringify(fold.columnHeaders)}\n` +
      `Acoes por linha: ${JSON.stringify(fold.rowActions)}\n` +
      `Cobertura de texto na dobra: ${fold.textCoveragePct}% (${fold.elementsWithText} elementos)\n` +
      `Altura do main: ${fold.mainHeightPx}px\n` +
      `UUID visivel: ${fold.hasUuid}\nSlug tecnico visivel: ${fold.hasTechnicalSlug}\n` +
      `Primeiro bloco: ${fold.firstBlock}\n`,
  );
  console.log(
    `[shot] ${screen.id} -> rows=${fold.rowCount} cols=${fold.columnHeaders.length} ` +
      `text=${fold.textCoveragePct}% uuid=${fold.hasUuid} slug=${fold.hasTechnicalSlug}`,
  );
}

await browser.close();
console.log(`\nScreenshots: ${OUT}`);
console.log(`Log: ${LOG}`);

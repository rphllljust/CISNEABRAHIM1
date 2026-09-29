/**
 * Prova de browser da ORDEM DE SERVIÇO — antes/depois, mesma resolucao.
 * Mede a PRIMEIRA DOBRA (1440x900): o que um gestor enxerga sem rolar.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';

const WEB = 'http://192.168.1.89:5174';
const API = 'http://192.168.1.89:3100';
const LOGIN = 'hml-admin@cisne.invalid';
const PASSWORD = 'Synthetic-HML-Only-Password-123!';
const LABEL = process.env.SHOT_LABEL ?? 'before';
const OUT = `C:/CISNEABRAHIM/tmp/os-pass/${LABEL}`;
const LOG = `C:/CISNEABRAHIM/tmp/os-pass/${LABEL}.txt`;
mkdirSync(OUT, { recursive: true });
writeFileSync(LOG, `=== OS ${LABEL} @ ${new Date().toISOString()} ===\n`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
await page.locator('input[type="text"], input[name="login"], #login').first().fill(LOGIN);
await page.locator('input[type="password"]').first().fill(PASSWORD);
await page.getByRole('button', { name: /entrar/i }).first().click();
await page.getByText('ACESSO INSTITUCIONAL').waitFor({ state: 'detached', timeout: 45000 });
await page.waitForTimeout(1200);

// Descobre uma OS real pela lista.
await page.goto(`${WEB}/app/service-orders`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
const firstOrder = await page.evaluate(() => {
  const link = document.querySelector('table tbody tr a');
  return link ? link.getAttribute('href') : null;
});
appendFileSync(LOG, `primeira OS: ${firstOrder}\n`);

if (!firstOrder) {
  appendFileSync(LOG, 'SEM OS NA BASE — nada a capturar\n');
  await browser.close();
  process.exit(0);
}

await page.goto(`${WEB}${firstOrder}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/os-detalhe.png`, fullPage: false });

const fold = await page.evaluate(() => {
  const text = (el) => (el?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const inFold = (el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
  };
  const visibleBlocks = [];
  for (const el of document.querySelectorAll('main h1, main h2, main h3, main dt, main th')) {
    if (inFold(el)) visibleBlocks.push(text(el));
  }
  // Onde cada bloco-chave comeca, em px a partir do topo.
  const offsetOf = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    return Math.round(el.getBoundingClientRect().top);
  };
  const main = document.querySelector('main');
  const viewportArea = window.innerWidth * window.innerHeight;
  let textArea = 0;
  for (const el of document.querySelectorAll('main *')) {
    if (!inFold(el)) continue;
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    if (!own) continue;
    const r = el.getBoundingClientRect();
    textArea += r.width * r.height;
  }
  const firstSection = document.querySelector('main section, main > div');
  return {
    url: location.pathname,
    h1: text(document.querySelector('h1')),
    blocksInFold: visibleBlocks,
    foldCoveragePct: Math.round((textArea / viewportArea) * 1000) / 10,
    mainHeight: Math.round(main?.getBoundingClientRect().height ?? 0),
    mainTop: offsetOf('main'),
    offsetAttention: offsetOf('.so-attention'),
    offsetStrip: offsetOf('.so-strip'),
    offsetStateFlow: offsetOf('[aria-label="Fluxo"]') ?? offsetOf('main section[aria-label]'),
    offsetNextAction: offsetOf('[aria-label*="róxim"], [aria-label*="Próxima"]'),
    firstSectionText: text(firstSection).slice(0, 400),
    hasUuid: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(document.body.innerText),
  };
});

appendFileSync(LOG, JSON.stringify(fold, null, 2) + '\n');
console.log(`[os] ${fold.url}`);
console.log(`  h1=${fold.h1}`);
console.log(`  blocos na dobra: ${fold.blocksInFold.length} -> ${JSON.stringify(fold.blocksInFold.slice(0, 18))}`);
console.log(`  cobertura de texto na dobra: ${fold.foldCoveragePct}%  mainHeight=${fold.mainHeight}px`);
console.log(`  uuid=${fold.hasUuid}`);
console.log(`  screenshot: ${OUT}/os-detalhe.png`);

await browser.close();

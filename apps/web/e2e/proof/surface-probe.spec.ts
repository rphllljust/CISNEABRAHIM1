import { test } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * SONDA DE DIAGNOSTICO — imprime a ARVORE DE REGIOES e as CAMADAS medidas.
 *
 * Nao afirma nada e nao falha: existe para descobrir QUAL elemento carrega a superficie de trabalho
 * em cada rota, e com que cor de fundo. A prova de contrato (`tier1-surface-contract.spec.ts`) mede
 * contra seletores estaveis; esta sonda e como esses seletores sao descobertos, e o que se roda
 * quando um deles muda.
 */

const ROUTES = [
  '/app/clients',
  '/app/contracts',
  '/app/assets',
  '/app/proposals',
  '/app/purchase-orders',
  '/app/finance/receivables',
  '/app/work-inbox',
  '/app/service-orders',
  '/app/documents',
  '/app/finance',
  '/app',
];

test.use({ viewport: { width: 1600, height: 900 } });

for (const route of ROUTES) {
  test(`sonda ${route}`, async ({ page }) => {
    const profile = route.includes('finance') || route === '/app' ? 'finance' : 'clients';
    await prepareAuthenticatedSession(page, profile);
    await page.goto(route);
    await stabilizePage(page);

    /*
     * ESPERA O DADO REAL. `shell-loading` e a faixa de espera do shell: medir antes dela sair
     * mediria o esqueleto, nao a superficie de trabalho. Nenhuma afirmacao de geometria vale
     * enquanto a pagina nao publicou o proprio conteudo.
     */
    await page
      .locator('.shell-loading')
      .first()
      .waitFor({ state: 'detached', timeout: 15_000 })
      .catch(() => undefined);
    await page.waitForTimeout(400);

    const report = await page.evaluate(() => {
      const describe = (el: Element, depth: number) => {
        const computed = window.getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
          depth,
          tag: el.tagName.toLowerCase(),
          region: el.getAttribute('data-region') ?? null,
          cls: (el.className ?? '').toString().slice(0, 90),
          bg: computed.backgroundColor,
          w: Math.round(box.width),
          h: Math.round(box.height),
          x: Math.round(box.x),
          y: Math.round(box.y),
        };
      };

      const nodes: ReturnType<typeof describe>[] = [];

      const shellContent = document.querySelector('.shell__content');
      if (shellContent) nodes.push(describe(shellContent, 0));

      /*
       * Percorre a partir da moldura da pagina, descendo por CONTEINERES de layout (div/section/main),
       * para revelar a cadeia de superficies que o shell e a pagina empilham.
       */
      const frame = document.querySelector('.shell-page-frame');
      const walk = (el: Element, depth: number) => {
        if (depth > 4) return;
        nodes.push(describe(el, depth));
        for (const child of Array.from(el.children)) {
          const tag = child.tagName.toLowerCase();
          if (tag === 'div' || tag === 'section' || tag === 'main' || tag === 'aside') {
            walk(child, depth + 1);
          }
        }
      };
      if (frame) walk(frame, 1);

      return {
        regions: Array.from(document.querySelectorAll('[data-region]')).map((el) => {
          const box = el.getBoundingClientRect();
          return {
            region: el.getAttribute('data-region'),
            tag: el.tagName.toLowerCase(),
            bg: window.getComputedStyle(el).backgroundColor,
            w: Math.round(box.width),
            h: Math.round(box.height),
          };
        }),
        /*
         * A CADEIA DE SUPERFICIE DE UMA REGIAO. Um `data-region` costuma ser um CONTEINER transparente
         * cujo filho pinta a superficie. Para medir "qual e o branco da area de trabalho" e preciso
         * subir/descer a arvore a partir da regiao, nao olhar so o proprio elemento.
         */
        surfaces: ['worklist-master', 'context-column', 'context-region'].flatMap((regionName) => {
          const root = document.querySelector(`[data-region="${regionName}"]`);
          if (!root) return [];
          const out: Array<{ region: string; path: string; bg: string; borderLeft: string; w: number; h: number }> = [];
          const visit = (el: Element, path: string, depth: number) => {
            if (depth > 3) return;
            const computed = window.getComputedStyle(el);
            const box = el.getBoundingClientRect();
            out.push({
              region: regionName,
              path: `${path}>${el.tagName.toLowerCase()}${el.getAttribute('data-region') ? `[${el.getAttribute('data-region')}]` : ''}`,
              bg: computed.backgroundColor,
              borderLeft: `${computed.borderLeftWidth} ${computed.borderLeftColor}`,
              w: Math.round(box.width),
              h: Math.round(box.height),
            });
            for (const child of Array.from(el.children).slice(0, 3)) {
              visit(child, path, depth + 1);
            }
          };
          visit(root, '', 0);
          return out.filter((entry) => entry.bg !== 'rgba(0, 0, 0, 0)' || entry.borderLeft.startsWith('1'));
        }),
        chain: nodes.filter((n) => n.depth <= 2),
      };
    });

    console.log(`\n===== ${route} =====`);
    console.log('--- cadeia de superficies (moldura -> conteudo) ---');
    for (const node of report.chain) {
      console.log(
        `${'  '.repeat(node.depth)}[${node.depth}] ${node.tag}${node.region ? ` region=${node.region}` : ''} bg=${node.bg} ${node.w}x${node.h} cls="${node.cls}"`,
      );
    }
    console.log('--- regioes declaradas ---');
    for (const region of report.regions) {
      console.log(`  ${region.region} <${region.tag}> bg=${region.bg} ${region.w}x${region.h}`);
    }
    console.log('--- superficies pintadas dentro das regioes ---');
    for (const surface of report.surfaces) {
      console.log(`  ${surface.path} bg=${surface.bg} borderLeft=${surface.borderLeft} ${surface.w}x${surface.h}`);
    }
  });
}

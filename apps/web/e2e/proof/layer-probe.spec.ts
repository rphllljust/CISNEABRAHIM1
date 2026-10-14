import { test } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * SONDA DE CAMADAS — imprime, para a regiao de trabalho, a CADEIA de ancestrais e descendentes com
 * o `background-color` computado de cada um.
 *
 * Existe porque `data-region="worklist-master"` nao aponta sempre para o elemento que PINTA. Sem
 * esta sonda, a prova de contrato mede o elemento errado e acusa defeito onde nao ha (ou pior, passa
 * onde nao deveria). Ela nao afirma nada: so mostra a arvore.
 */

const ROUTES: Array<{ route: string; profile: 'clients' | 'finance' | 'documents' }> = [
  { route: '/app/clients', profile: 'clients' },
  { route: '/app/documents', profile: 'documents' },
  { route: '/app/finance/receivables', profile: 'finance' },
];

test.use({ viewport: { width: 1600, height: 900 } });

for (const target of ROUTES) {
  test(`camadas ${target.route}`, async ({ page }) => {
    await prepareAuthenticatedSession(page, target.profile);
    await page.goto(target.route);
    await stabilizePage(page);
    await page
      .locator('.shell-loading')
      .first()
      .waitFor({ state: 'detached', timeout: 15_000 })
      .catch(() => undefined);
    await page.waitForTimeout(300);

    const report = await page.evaluate(() => {
      const describe = (el: Element, label: string) => {
        const computed = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          label,
          tag: el.tagName.toLowerCase(),
          region: el.getAttribute('data-region'),
          bg: computed.backgroundColor,
          border: `${computed.borderTopWidth}/${computed.borderLeftWidth}`,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          cls: (el.className ?? '').toString().slice(0, 70),
        };
      };

      const out: ReturnType<typeof describe>[] = [];
      const root = document.querySelector('[data-region="worklist-master"]');

      if (root) {
        /* Ancestrais: onde a regiao esta ancorada. */
        let ancestor: Element | null = root;
        let level = 0;
        while (ancestor && level < 8) {
          out.push(describe(ancestor, `ANCESTOR[${level}]`));
          ancestor = ancestor.parentElement;
          level += 1;
        }
        /* Descendentes pintados dentro da regiao. */
        for (const child of Array.from(root.querySelectorAll('*')).slice(0, 12)) {
          const bg = window.getComputedStyle(child).backgroundColor;
          if (bg !== 'rgba(0, 0, 0, 0)') {
            out.push(describe(child, 'DESCENDANT'));
          }
        }
      } else {
        /* Sem a regiao: lista o que existe para descobrir como a tela se ancora. */
        for (const el of Array.from(document.querySelectorAll('main > *, main > * > *')).slice(0, 10)) {
          out.push(describe(el, 'MAIN-LEVEL'));
        }
      }
      return out;
    });

    console.log(`\n===== ${target.route} =====`);
    for (const entry of report) {
      console.log(
        `  ${entry.label.padEnd(13)} <${entry.tag}> region=${entry.region ?? '-'} bg=${entry.bg} border=${entry.border} ${entry.size} cls="${entry.cls}"`,
      );
    }
  });
}

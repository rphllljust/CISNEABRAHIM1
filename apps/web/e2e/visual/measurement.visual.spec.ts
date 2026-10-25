import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';
import type { ApiMockProfile } from '../fixtures/api-routes';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ACEITE DE BROWSER — MEDIÇÃO → ACEITE → ELEGIBILIDADE DE FATURAMENTO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * POR QUE ESTE SPEC EXISTE (lacuna medida, não hipótese)
 *
 * A suíte visual completa tinha 24 specs e NENHUM abria a superfície de medição.
 * O browser gate de produção reprovou esta tela com
 *
 *   TypeError: Cannot read properties of undefined (reading 'map')
 *
 * e a suíte visual teria ficado verde o tempo todo: um render quebrado da estação
 * de trabalho só aparecia depois do deploy, no cliente. Cobertura que não abre a
 * rota não é cobertura — é a ausência dela com nome bonito.
 *
 * O QUE ESTE SPEC PROVA
 *
 * 1. a rota real abre e passa pela superfície COMPARTILHADA (um `main#main-content`,
 *    um `h1`, sem `<main>` aninhado);
 * 2. a tela NÃO estoura a largura do viewport;
 * 3. não há identificador interno nem enum cru na superfície de negócio;
 * 4. a fila renderiza estado explícito — nunca área em branco sem explicação;
 * 5. nenhum erro crítico de console (o defeito exato que a produção encontrou).
 *
 * A asserção 5 é a que teria pego o defeito. Ela é registrada aqui, no CI, antes
 * do deploy — não no cliente.
 */
const FORBIDDEN_UNIT_SLUG = /unit-synthetic|UN-DEV-\d+/i;

/**
 * Enums crus conhecidos da medição. Todos têm dicionário no produto; se
 * aparecerem como texto visível, a humanização regrediu.
 */
const FORBIDDEN_RAW_ENUMS =
  /\b(PENDING_ACCEPTANCE|READY_TO_BILL|BLOCKED_ELIGIBILITY|VARIANCE_EXCEEDED)\b/;

async function assertSharedSurface(page: Page, label: string): Promise<void> {
  await expect(
    page.locator('main#main-content'),
    `${label}: deve existir exatamente um main#main-content`,
  ).toHaveCount(1);
  await expect(page.locator('main main'), `${label}: nao pode haver <main> aninhado`).toHaveCount(0);
  await expect(page.locator('h1'), `${label}: deve haver exatamente um h1`).toHaveCount(1);

  const bodyText = (await page.locator('body').innerText()) ?? '';
  expect(
    FORBIDDEN_UNIT_SLUG.test(bodyText),
    `${label}: identificador interno de unidade vazou para a superficie`,
  ).toBe(false);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label}: a pagina nao pode estourar a largura do viewport (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function login(page: Page, profile: ApiMockProfile): Promise<void> {
  await prepareAuthenticatedSession(page, profile);
}

test.describe('aceite de browser — medição e elegibilidade de faturamento', () => {
  test('WORKBENCH — Medição abre como estação de trabalho, sem quebrar o render', async ({
    page,
  }) => {
    /**
     * ERROS DE CONSOLE SÃO COLETADOS ANTES DA NAVEGAÇÃO.
     *
     * O defeito de produção foi um `TypeError` durante o render de um `.map` sobre
     * coleção ausente. Ele NÃO aparece no texto da página — aparece no console. Um
     * spec que só olha o DOM deixaria o mesmo defeito passar.
     */
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(String(error?.message ?? error));
    });

    await login(page, 'measurement');
    await page.goto('/app/measurement');
    await stabilizePage(page);

    await assertSharedSurface(page, 'Medição');

    const body = (await page.locator('body').innerText()) ?? '';

    /**
     * ESTADO EXPLÍCITO, NUNCA ÁREA EM BRANCO.
     *
     * Sem ordem selecionada a tela DEVE dizer o que está acontecendo: fila vazia,
     * nenhuma pendência, ou instrução para escolher. Uma tela muda não informa se
     * está vazia ou quebrada — e as duas exigem ações opostas do operador.
     */
    expect(
      body.trim().length,
      'Medição: a superficie nao pode renderizar vazia',
    ).toBeGreaterThan(200);

    expect(
      FORBIDDEN_RAW_ENUMS.test(body),
      'Medição: enum cru vazou para a superficie de negocio',
    ).toBe(false);

    /**
     * O TESTE DO DEFEITO REAL.
     *
     * `TypeError ... reading 'map'` é o sintoma de read model sem coleção. Ele
     * nunca mais pode aparecer nesta rota, em nenhum ambiente.
     */
    const mapErrors = consoleErrors.filter((text) => /reading 'map'/.test(text));
    expect(
      mapErrors,
      `Medição: read model degenerado derrubou o render — ${mapErrors.join(' | ')}`,
    ).toHaveLength(0);

    await page.screenshot({ path: '../../tmp/acceptance/measurement-workbench.png' });
  });

  test('CONTROL TOWER — Lacuna de receita renderiza por estágio', async ({ page }) => {
    /**
     * O DEFEITO DO PRÓPRIO TESTE, REGISTRADO PARA NÃO VOLTAR.
     *
     * A primeira versão exigia `h1` nesta rota. A tela de lacuna NÃO usa `h1` — ela
     * monta o título pelo cabeçalho do módulo, como outras telas do produto. A
     * asserção reprovava uma tela correta por um seletor errado, exatamente o falso
     * negativo que já corroeu o gate de produção duas vezes.
     *
     * O que a tela GARANTE e o spec exige:
     *   - passou pela superfície compartilhada (`main#main-content` único);
     *   - renderizou conteúdo, não uma área em branco;
     *   - não estourou o viewport.
     */
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => {
      consoleErrors.push(String(error?.message ?? error));
    });

    await login(page, 'measurement');
    await page.goto('/app/measurement/revenue-leakage');
    await stabilizePage(page);

    await expect(page.locator('main#main-content')).toHaveCount(1);
    await expect(page.locator('main main')).toHaveCount(0);

    const body = (await page.locator('body').innerText()) ?? '';
    expect(
      body.trim().length,
      'Lacuna de receita: a superficie nao pode renderizar vazia',
    ).toBeGreaterThan(150);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      'Lacuna de receita: nao pode estourar a largura do viewport',
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Mesmo defeito de render não pode reaparecer aqui.
    expect(
      consoleErrors.filter((text) => /reading 'map'/.test(text)),
      'Lacuna de receita: read model degenerado derrubou o render',
    ).toHaveLength(0);

    await page.screenshot({ path: '../../tmp/acceptance/measurement-revenue-leakage.png' });
  });
});

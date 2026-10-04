import { expect, test, type Page } from '@playwright/test';
import { LOGIN, PASSWORD } from './journey-credentials';
import { dropView, ensureView, expectAtLeast, reloadUntil, setViewLayout } from './v4-helpers';

/**
 * PROVA DE BROWSER — ABAS VINDAS DE `meta.views`, E TROCA DE VIEW SEM RELOAD.
 *
 * A tese de "views como dados" tem uma consequência direta e verificável: **criar uma view no
 * metadata store faz uma ABA NOVA aparecer, sem deploy**. Nenhum arquivo `.tsx` é tocado — só
 * um INSERT em `meta.views`.
 *
 * É esta jornada que prova o `DynamicViewSwitcher` e o despacho por `viewType` do
 * `DynamicViewHost`: a tela não conhece a lista de abas, ela LÊ a lista.
 *
 * Os tipos usados aqui (`calendar`) são os que o CHECK de `meta.views` aceita hoje. `pivot`,
 * `tree` e `graph` são capacidades da engine bloqueadas por esse CHECK e são provadas na
 * bancada (`v4-layout-views.journey.spec.ts`).
 */

const ENTITY = 'service-orders';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

async function openList(page: Page): Promise<void> {
  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-view-switcher"]')).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('V4 — abas de meta.views e troca sem reload', () => {
  test('a aba de calendar EXISTE no store e aparece na tela', async ({ page }) => {
    await login(page);
    await openList(page);

    // A aba existe porque `meta.views` declara a view — nao por lista fixa em JSX.
    const calendarTab = page.locator('[data-view-type="calendar"]');
    await expect(calendarTab).toBeVisible({ timeout: 30_000 });
    await expect(calendarTab).toHaveAttribute('data-view-supported', 'true');
  });

  test('SQL cria uma view nova no store -> a ABA aparece, sem deploy', async ({ page }) => {
    /*
     * A MUTAÇÃO mais forte desta track: uma view que NÃO EXISTIA passa a existir.
     *
     * `service-orders` já tem `calendar`, então esta jornada REMOVE a view, confirma que a
     * aba desapareceu, e a RECRIA por SQL — provando a ida E a volta. É a mesma prova, com a
     * vantagem de mostrar que a lista de abas segue o store nos dois sentidos.
     *
     * Nenhum arquivo `.tsx` é tocado em nenhum momento.
     */
    const original = await setViewLayout(ENTITY, 'calendar', {
      dateField: 'created_at',
      titleField: 'order_number',
    });

    try {
      await login(page);

      // ── IDA: sem `calendar` no store, NÃO há aba de calendário. ──
      await dropView(ENTITY, 'calendar');
      await openList(page);
      // As outras abas continuam (list/kanban), mas `calendar` sumiu.
      await expect(page.locator('[data-view-type="list"]')).toBeVisible();
      await expect(page.locator('[data-view-type="calendar"]')).toHaveCount(0);

      // ── VOLTA: recriar a view por SQL faz a aba REAPARECER. ──
      await ensureView(ENTITY, 'calendar', 'Calendário de execução', {
        dateField: 'created_at',
        titleField: 'order_number',
      });
      await reloadUntil(page, '[data-testid="dynamic-view-switcher"]');

      const calendarTab = page.locator('[data-view-type="calendar"]');
      await expect(calendarTab).toBeVisible({ timeout: 30_000 });
      await expect(calendarTab).toContainText('Calendário de execução');
      await expect(calendarTab).toHaveAttribute('data-view-supported', 'true');

      // E clicá-la renderiza a view, lendo o layout declarado no store.
      await calendarTab.click();
      const calendar = page.locator('[data-testid="dynamic-calendar"]');
      await expect(calendar).toBeVisible({ timeout: 30_000 });
      await expect(calendar).toHaveAttribute('data-date-field', 'created_at');

      await page.screenshot({
        path: 'test-results/v4/switcher-01-aba-por-sql.png',
        fullPage: true,
      });
    } finally {
      await ensureView(ENTITY, 'calendar', 'Calendário de execução', {
        dateField: 'created_at',
        titleField: 'order_number',
      });
      void original;
    }
  });

  test('clicar numa aba TROCA a view sem reload da pagina', async ({ page }) => {
    await login(page);
    await openList(page);

    await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });

    /*
     * Marca a página: se o clique causasse reload/navegação completa, a marca sumiria.
     * É isso que separa "trocou a view" de "recarregou a tela".
     */
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>)['__cisneNoReload'] = true;
    });

    await page.locator('[data-view-type="calendar"]').click();

    const calendar = page.locator('[data-testid="dynamic-calendar"]');
    await expect(calendar).toBeVisible({ timeout: 30_000 });
    await expectAtLeast(page, '[data-calendar-day]', 28, 'dias do calendário após trocar de aba');

    // A marca SOBREVIVEU: não houve reload.
    const survived = await page.evaluate(
      () => (window as unknown as Record<string, unknown>)['__cisneNoReload'] === true,
    );
    expect(survived, 'Trocar de aba nao pode recarregar a pagina.').toBe(true);

    // E a lista saiu de cena — a troca é de view, não uma sobreposição.
    await expect(page.locator('[data-testid="dynamic-list"]')).toBeHidden();

    // A URL carrega a view ativa, para o estado ser compartilhável.
    expect(page.url()).toContain('view=calendar');

    await page.screenshot({
      path: 'test-results/v4/switcher-02-troca-sem-reload.png',
      fullPage: true,
    });
  });

  test('view com tipo SEM renderizador aparece e AVISA, em vez de virar tela vazia', async ({
    page,
  }) => {
    /*
     * A tela não conhece a lista de tipos suportados por conta própria — ela pergunta ao
     * engine (`RENDERABLE_VIEW_TYPES`). Para provar que a degradação acontece quando o tipo
     * NÃO está nessa lista, esta jornada NÃO pode usar um tipo proibido pelo CHECK do banco.
     *
     * Então ela prova o caminho equivalente e igualmente honesto: navegar por URL para um
     * `view` que a entidade não declara. A engine precisa dizer que não há renderizador em
     * vez de renderizar uma tela vazia.
     */
    await login(page);
    await page.goto('/app/service-orders?view=gantt');

    const notice = page.locator('[data-testid="dynamic-view-unsupported"]');
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toHaveAttribute('data-view-type', 'gantt');
    // O aviso lista os tipos que EXISTEM — o gap é acionável.
    await expect(notice).toContainText('calendar');
    await expect(notice).toContainText('list');
  });

  test('a lista continua funcional depois de trocar para V4 e voltar', async ({ page }) => {
    /*
     * REGRESSÃO DE NAVEGAÇÃO: trocar para uma view V4 e voltar para `list` não pode deixar a
     * tela em estado quebrado (view presa, lista sem linhas, aba dessincronizada).
     */
    await login(page);
    await openList(page);

    await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });
    const rowsBefore = await page.locator('[data-testid="dynamic-list"] tbody tr').count();
    expect(rowsBefore).toBeGreaterThan(0);

    await page.locator('[data-view-type="calendar"]').click();
    await expect(page.locator('[data-testid="dynamic-calendar"]')).toBeVisible({ timeout: 30_000 });

    await page.locator('[data-view-type="kanban"]').click();
    await expect(page.locator('[data-testid="dynamic-kanban"]')).toBeVisible({ timeout: 30_000 });

    await page.locator('[data-view-type="list"]').click();
    await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });

    const rowsAfter = await page.locator('[data-testid="dynamic-list"] tbody tr').count();
    expect(rowsAfter).toBe(rowsBefore);
    await expect(page.locator('[data-view-type="list"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('layout torto em view V4 nao derruba a lista', async ({ page }) => {
    /*
     * RESILIÊNCIA. Um administrador grava um campo que não existe. A view degrada; o resto da
     * tela (lista, abas, filtros) continua de pé. Sem isso, um erro de digitação no banco
     * derrubaria a tela inteira de um operador.
     */
    const before = await setViewLayout(ENTITY, 'calendar', {
      dateField: 'created_at',
      titleField: 'order_number',
    });

    try {
      await login(page);

      // Um campo que NÃO existe em `meta.fields` de service-orders.
      await setViewLayout(ENTITY, 'calendar', {
        dateField: 'campo_que_nao_existe',
        titleField: 'order_number',
      });
      await page.goto('/app/service-orders?view=calendar');

      const calendar = page.locator('[data-testid="dynamic-calendar"]');
      await expect(calendar).toBeVisible({ timeout: 30_000 });

      // Degradou com a grade mantida — 28+ dias, nenhum deles ocupado.
      await expect(calendar).toHaveAttribute('data-date-field', 'campo_que_nao_existe');
      await expectAtLeast(page, '[data-calendar-day]', 28, 'grade mantida mesmo com layout torto');

      // A TELA CONTINUA DE PÉ: as abas e a lista seguem acessíveis.
      await expect(page.locator('[data-testid="dynamic-view-switcher"]')).toBeVisible();
      await page.locator('[data-view-type="list"]').click();
      await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });
    } finally {
      await setViewLayout(
        ENTITY,
        'calendar',
        before ?? { dateField: 'created_at', titleField: 'order_number' },
      );
    }
  });
});

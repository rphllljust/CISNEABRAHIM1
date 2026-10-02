import { expect, test, type Page } from '@playwright/test';
import { LOGIN, PASSWORD } from './journey-credentials';
import { dropView, ensureView, expectAtLeast, reloadUntil, setViewLayout } from './v4-helpers';

/**
 * PROVA DE BROWSER — VISÃO DE CALENDÁRIO DIRIGIDA POR METADADO.
 *
 * A pergunta desta jornada NÃO é "o calendário aparece". É: **o layout do metadata store
 * decide o que o calendário desenha?** A prova é uma mutação por SQL e a observação do DOM
 * antes/depois — sem deploy, sem reload de bundle, sem tocar em TypeScript.
 *
 * Ela prova três coisas que `tsc exit 0` não prova:
 *   1. a grade cobre o mês inteiro (>= 28 dias), inclusive dias VAZIOS;
 *   2. `dateField` do store muda QUAL campo posiciona os cartões — provado por um campo
 *      alternativo que produz contagem diferente de dias ocupados;
 *   3. sem `dateField` a view DEGRADA e EXPLICA, em vez de renderizar uma grade vazia que o
 *      operador leria como "não há dado".
 */

const ENTITY = 'service-orders';
const VIEW = 'calendar';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

/** Abre a lista de OS já na aba de calendário. */
async function openCalendar(page: Page): Promise<void> {
  await page.goto(`/app/service-orders?view=${VIEW}`);
  await expect(page.locator('[data-testid="dynamic-calendar"]')).toBeVisible({ timeout: 30_000 });
}

test.describe('V4 — calendário dirigido por metadado', () => {
  test('a grade cobre o mes inteiro e o DOM declara o campo de data usado', async ({ page }) => {
    await login(page);
    await openCalendar(page);

    const calendar = page.locator('[data-testid="dynamic-calendar"]');
    await expect(calendar).toHaveAttribute('data-entity', ENTITY);
    await expect(calendar).toHaveAttribute('data-view-type', VIEW);

    // O DOM DIZ qual campo o layout mandou usar — sem isso a jornada não teria como
    // distinguir "leu o metadado" de "chutou uma coluna".
    await expect(calendar).toHaveAttribute('data-date-field', 'created_at');

    // Grade de mês: 42 células cobrem qualquer mês; o requisito é >= 28.
    const days = await expectAtLeast(page, '[data-calendar-day]', 28, 'dias do calendário');

    // Dias do mês corrente E dias de preenchimento das bordas — a grade não é uma lista
    // agrupada, ela mostra a AUSÊNCIA também.
    const inMonth = await page.locator('[data-calendar-day][data-in-month="true"]').count();
    expect(inMonth).toBeGreaterThanOrEqual(28);
    expect(days).toBeGreaterThanOrEqual(inMonth);

    await page.screenshot({ path: 'test-results/v4/calendar-01-grade.png', fullPage: true });
  });

  test('SQL muda layout.dateField -> o calendario usa OUTRO campo, sem deploy', async ({
    page,
  }) => {
    /*
     * A MUTAÇÃO. O store passa a posicionar os cartões por `updated_at` em vez de
     * `created_at`. Nenhum arquivo React é tocado — só uma linha de JSONB no banco.
     */
    const before = await setViewLayout(ENTITY, VIEW, {
      dateField: 'created_at',
      titleField: 'order_number',
    });

    try {
      await login(page);
      await openCalendar(page);

      const calendar = page.locator('[data-testid="dynamic-calendar"]');
      await expect(calendar).toHaveAttribute('data-date-field', 'created_at');

      // Dias OCUPADOS antes da mutação (células com ao menos um cartão).
      const occupiedBefore = await page
        .locator('[data-calendar-day][data-day-count]:not([data-day-count="0"])')
        .count();

      /*
       * `updated_at` é preenchido na listagem, então a mutação muda a DISTRIBUIÇÃO dos
       * cartões no mês. Contar dias ocupados antes/depois prova que o campo lido mudou de
       * verdade — um calendário que ignorasse o layout daria o mesmo número.
       */
      await setViewLayout(ENTITY, VIEW, {
        dateField: 'updated_at',
        titleField: 'order_number',
      });

      await reloadUntil(page, '[data-testid="dynamic-calendar"]');
      await expect(calendar).toHaveAttribute('data-date-field', 'updated_at');

      const occupiedAfter = await page
        .locator('[data-calendar-day][data-day-count]:not([data-day-count="0"])')
        .count();

      expect(
        occupiedAfter,
        'Depois de trocar dateField para updated_at, a distribuição de dias ocupados deveria mudar.',
      ).not.toBe(occupiedBefore);

      await page.screenshot({
        path: 'test-results/v4/calendar-02-apos-sql-updated-at.png',
        fullPage: true,
      });
    } finally {
      // RESTAURA: uma jornada que deixa o store mutado contamina a próxima execução.
      await setViewLayout(ENTITY, VIEW, before ?? { dateField: 'created_at', titleField: 'order_number' });
    }
  });

  test('sem dateField a view DEGRADA E EXPLICA, em vez de mentir com grade vazia', async ({
    page,
  }) => {
    const before = await setViewLayout(ENTITY, VIEW, { titleField: 'order_number' });

    try {
      await login(page);
      await page.goto(`/app/service-orders?view=${VIEW}`);

      const calendar = page.locator('[data-testid="dynamic-calendar"]');
      await expect(calendar).toHaveAttribute('data-calendar-gap', 'dateField', {
        timeout: 30_000,
      });

      // A mensagem NOMEIA a chave que falta — é o que torna o gap corrigível por SQL.
      await expect(calendar).toContainText('dateField');
    } finally {
      await setViewLayout(
        ENTITY,
        VIEW,
        before ?? { dateField: 'created_at', titleField: 'order_number' },
      );
    }
  });

  test('titleField do store define o TEXTO do cartao', async ({ page }) => {
    /*
     * `titleField=order_number` produz cartões com o número da OS. Trocá-lo por `status`
     * deve produzir cartões com o ESTADO. É a mesma prova de indireção, no eixo do título.
     */
    const before = await setViewLayout(ENTITY, VIEW, {
      dateField: 'updated_at',
      titleField: 'order_number',
    });

    try {
      await login(page);
      await openCalendar(page);

      const cards = page.locator('[data-calendar-card]');
      await expect.poll(async () => cards.count(), { timeout: 30_000 }).toBeGreaterThan(0);

      const firstWithNumber = await cards.first().getAttribute('data-calendar-card');
      expect(firstWithNumber ?? '').toMatch(/OS-/);

      await setViewLayout(ENTITY, VIEW, {
        dateField: 'updated_at',
        titleField: 'status',
      });
      await reloadUntil(page, '[data-testid="dynamic-calendar"]');

      const firstWithStatus = await cards.first().getAttribute('data-calendar-card');
      expect(firstWithStatus ?? '').not.toMatch(/OS-/);
      await expect(page.locator('[data-testid="dynamic-calendar"]')).toHaveAttribute(
        'data-title-field',
        'status',
      );
    } finally {
      await setViewLayout(
        ENTITY,
        VIEW,
        before ?? { dateField: 'created_at', titleField: 'order_number' },
      );
    }
  });

  test('colorField do store colore o cartao sem hexadecimal no metadado', async ({ page }) => {
    const before = await setViewLayout(ENTITY, VIEW, {
      dateField: 'updated_at',
      titleField: 'order_number',
      colorField: 'status',
    });

    try {
      await login(page);
      await openCalendar(page);

      const calendar = page.locator('[data-testid="dynamic-calendar"]');
      // O DOM declara que a cor vem de `status` — não de uma constante do componente.
      await expect(calendar).toHaveAttribute('data-color-field', 'status');
      await expect(calendar).toContainText('colorido por');
    } finally {
      await setViewLayout(
        ENTITY,
        VIEW,
        before ?? { dateField: 'created_at', titleField: 'order_number' },
      );
    }
  });

  test('uma view de calendario NOVA em outra entidade funciona sem codigo novo', async ({
    page,
  }) => {
    /*
     * GENERICIDADE. Criamos uma view `calendar` para `suppliers` — entidade que nunca teve
     * uma — apontando para `labelField`/`created_at`. Nenhuma linha de TypeScript muda.
     *
     * `calendar` ESTÁ na lista que o CHECK de `meta.views` aceita, então esta prova exercita
     * o caminho COMPLETO: store → API → engine → DOM.
     */
    await ensureView('suppliers', 'calendar', 'Calendário de cadastro', {
      dateField: 'created_at',
      titleField: 'legal_name',
    });

    try {
      await login(page);
      // O explorador renderiza a primeira view de apresentação da entidade escolhida.
      await page.goto('/app/admin/metadata');
      await expect(page.locator('[data-testid="metadata-explorer"]')).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-explorer-entity="suppliers"]').click();
      await expect(page.locator('[data-testid="explorer-entity-title"]')).toContainText('Fornecedor');

      // A view nova aparece na lista de views do store, provando que ela é DADO.
      await page.locator('[data-explorer-tab="views"]').click();
      await expect(page.locator('[data-explorer-view="calendar"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-explorer-view-layout="calendar"]')).toContainText('legal_name');

      // E a engine a RENDERIZA — o host escolhe o renderizador pelo viewType do store.
      const calendar = page.locator('[data-testid="dynamic-calendar"]');
      await expect(calendar).toBeVisible({ timeout: 30_000 });
      await expect(calendar).toHaveAttribute('data-title-field', 'legal_name');
      await expectAtLeast(page, '[data-calendar-day]', 28, 'dias do calendário de fornecedores');

      await page.screenshot({
        path: 'test-results/v4/calendar-03-outra-entidade.png',
        fullPage: true,
      });
    } finally {
      await dropView('suppliers', 'calendar');
    }
  });
});

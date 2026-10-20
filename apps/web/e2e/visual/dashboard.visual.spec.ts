import { test, expect } from '@playwright/test';
import {
  prepareAuthenticatedSession,
  stabilizePage,
} from '../fixtures/visual-helpers';

test.describe('executive dashboard visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'dashboard');
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /central de operações/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /fila de trabalho/i })).toBeVisible();
    await stabilizePage(page);
  });

  test('dashboard ready state', async ({ page }) => {
    /*
     * ALVO DO SNAPSHOT — o landmark real da página.
     *
     * O spec mirava `#main-content.dashboard-page` e mascarava `.dashboard-page__meta time` e
     * `.dashboard-command__refresh`. Nenhuma dessas classes existe no dashboard: ele é composto
     * por `ModulePage` (que publica `#main-content`) e pela árvore `dashboard-cc__*`. O locator
     * nunca resolvia — o teste ficava em timeout antes de comparar qualquer pixel, e o snapshot
     * persistido jamais foi exercitado.
     *
     * O alvo passa a ser `#main-content` (o `<main>` que a página realmente monta). As máscaras
     * saem: mascarar seletor inexistente é o mesmo que não mascarar, e horário dinâmico não é
     * renderizado nesse nó.
     */
    await expect(page.locator('#main-content')).toHaveScreenshot('dashboard-ready.png', {
      animations: 'disabled',
    });
  });
});

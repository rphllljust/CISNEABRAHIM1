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
    /*
     * A FILA TEM DE CARREGAR — NAO BASTAVA O TITULO EXISTIR.
     *
     * DEFEITO MEDIDO (revisao visual da baseline `dashboard-ready`): o painel renderizava
     * "Nao foi possivel falar com o servidor para montar a fila de trabalho." porque
     * `GET /api/v1/work-inbox` nao era mockado no fixture. A assercao anterior so exigia o
     * cabecalho "Fila de trabalho" — que aparece igual nos dois estados — entao o snapshot
     * congelou a FALHA DE REDE como se fosse a tela valida.
     *
     * O mock agora vive no fixture central (`fixtures/api-routes.ts`), o que corrige de uma vez
     * todos os consumidores do perfil `dashboard` em vez de um mock inline por spec.
     */
    await expect(
      page.getByText('Não foi possível falar com o servidor para montar a fila de trabalho.'),
    ).toHaveCount(0);
    await expect(page.getByText('OS-2026-0184').first()).toBeVisible();
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

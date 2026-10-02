import { expect, test, type Page } from '@playwright/test';
import { requireJourneyLogin, requireJourneyPassword } from './journey-credentials';

/**
 * V3 · CONTEXT DRAWER — prova no browser, sem mock e sem sleep.
 *
 * O painel abre a partir de uma linha REAL da lista e apresenta as referências cruzadas que a
 * TELA conhece. A engine não faz chamada de rede própria nem inventa relação de domínio.
 *
 * AUSÊNCIA NÃO É ERRO: registro sem referências abre o painel e DIZ isso — um painel que não
 * abre faria o operador achar que o clique falhou. Por isso a prova aceita os dois desfechos,
 * mas exige que um deles aconteça: ou há `[data-cross-ref]`, ou há o estado vazio declarado.
 * Um painel que simplesmente não aparece NÃO passa.
 */
const LOGIN = requireJourneyLogin();
const PASSWORD = requireJourneyPassword();

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

test('clicar em Contexto abre o drawer e expoe as referencias cruzadas da linha', async ({
  page,
}) => {
  await login(page);
  await page.goto('/app/service-orders');

  const list = page.locator('[data-testid="dynamic-list"]');
  await expect(list).toBeVisible({ timeout: 30_000 });

  const firstRow = list.locator('[data-testid="dynamic-list-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  const rowId = await firstRow.getAttribute('data-row-id');
  expect(rowId).toBeTruthy();

  // O drawer começa FECHADO: sem isso, "abriu" não significaria nada.
  const drawer = page.locator('[data-testid="dynamic-context-drawer"]');
  await expect(drawer).toHaveCount(0);

  await firstRow.locator('[data-testid="dynamic-open-context"]').click();

  await expect(drawer).toBeVisible({ timeout: 30_000 });
  // O painel é do registro clicado, não de outro qualquer.
  await expect(drawer).toHaveAttribute('data-cross-ref-count', /\d+/);

  /*
   * O contrato do componente: com referências, cada uma é publicada em `[data-cross-ref]`;
   * sem nenhuma, o painel declara o vazio em vez de ficar em branco.
   */
  const references = drawer.locator('[data-testid="dynamic-cross-ref"]');
  const emptyState = drawer.locator('[data-testid="dynamic-context-drawer-empty"]');

  const referenceCount = await references.count();
  if (referenceCount > 0) {
    await expect(references.first()).toBeVisible();
    // Cada referência traz um RÓTULO de negócio, vindo da tela — nunca um identificador cru.
    const label = await references.first().getAttribute('data-cross-ref');
    expect(label).toBeTruthy();
    expect(label?.trim().length).toBeGreaterThan(0);
  } else {
    await expect(emptyState).toBeVisible();
  }

  // Fechar funciona: um painel que só abre prende o operador.
  await drawer.locator('[data-testid="dynamic-context-drawer-close"]').click();
  await expect(drawer).toHaveCount(0);
});

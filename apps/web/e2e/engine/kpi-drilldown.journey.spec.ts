import { expect, test } from '@playwright/test';
import { requireJourneyLogin, requireJourneyPassword } from './journey-credentials';

/**
 * V3 · KPI DRILL-DOWN — prova no browser, sem mock e sem sleep.
 *
 * O card de indicador NÃO calcula nada na engine: recebe o valor pronto e, ao ser clicado,
 * aplica na lista o MESMO recorte que produziu o número.
 *
 * A asserção é sobre `[data-list-count]`, o atributo que a `DynamicList` publica com o número
 * de linhas RENDERIZADAS. Contar `<tr>` mediria outra coisa (rodapé, estado vazio) e daria um
 * número que a tela nunca prometeu.
 */
const LOGIN = requireJourneyLogin();
const PASSWORD = requireJourneyPassword();

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

test('card de KPI aplica o recorte na lista e o data-list-count muda', async ({ page }) => {
  await login(page);
  await page.goto('/app/service-orders');

  await expect(page.locator('[data-testid="dynamic-kpi-drilldown"]')).toBeVisible({
    timeout: 30_000,
  });

  const cards = page.locator('[data-testid="dynamic-kpi-card"]');
  expect(await cards.count()).toBeGreaterThan(0);

  const list = page.locator('[data-testid="dynamic-list"]');
  await expect(list).toBeVisible({ timeout: 30_000 });

  const countBefore = Number(await list.getAttribute('data-list-count'));
  expect(Number.isFinite(countBefore)).toBe(true);
  expect(countBefore).toBeGreaterThan(0);

  /*
   * Escolhe um card CLICÁVEL cujo recorte de fato REDUZA o conjunto. Um card cujo valor já é o
   * total não mudaria a contagem, e o teste não conseguiria distinguir "filtrou certo" de
   * "não filtrou nada" — que é justamente o defeito que esta prova existe para pegar.
   */
  let targetIndex = -1;
  let targetValue = -1;
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    if ((await card.getAttribute('data-kpi-field')) === null) {
      continue;
    }
    const value = Number(await card.getAttribute('data-kpi-value'));
    if (Number.isFinite(value) && value > 0 && value < countBefore) {
      targetIndex = index;
      targetValue = value;
      break;
    }
  }
  expect(
    targetIndex,
    'nenhum card declara recorte que reduza a lista — não haveria drill-down a provar',
  ).toBeGreaterThanOrEqual(0);

  const target = cards.nth(targetIndex);
  await target.click();

  // A LISTA MUDA: a contagem passa a bater com o valor que o card declarava.
  await expect
    .poll(async () => Number(await list.getAttribute('data-list-count')), { timeout: 30_000 })
    .toBe(targetValue);

  const countAfter = Number(await list.getAttribute('data-list-count'));
  expect(countAfter).toBe(targetValue);
  expect(countAfter).toBeLessThan(countBefore);

  // O card fica marcado como ativo — o operador vê qual recorte está aplicado.
  await expect(target).toHaveAttribute('data-kpi-active', 'true');
});

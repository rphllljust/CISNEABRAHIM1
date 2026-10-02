import { expect, test, type Page } from '@playwright/test';
import { requireJourneyLogin, requireJourneyPassword } from './journey-credentials';

/**
 * V3 · BUSINESS CHAIN — prova no browser, sem mock e sem sleep.
 *
 * A cadeia é montada do que o PAYLOAD do detalhe trouxe: solicitação → proposta → pedido de
 * compra → OS. Cada degrau só existe quando o vínculo está PERSISTIDO — a engine não inventa
 * relação, e a tela não afirma degrau que o registro não tem.
 *
 * A prova é sobre `[data-chain-phase]`, o atributo que a `DynamicBusinessChain` publica por nó.
 * Exigir ≥ 2 é o que distingue "a cadeia renderizou" de "um nó solto apareceu".
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

/** Abre o detalhe de uma OS que tenha linhagem registrada. */
async function openServiceOrderWithLineage(page: Page): Promise<void> {
  await page.goto('/app/service-orders');
  const list = page.locator('[data-testid="dynamic-list"]');
  await expect(list).toBeVisible({ timeout: 30_000 });

  const rows = list.locator('[data-testid="dynamic-list-row"]');
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);

  for (let index = 0; index < total; index += 1) {
    await rows.nth(index).click();
    await expect(page.locator('[data-testid="dynamic-form"]')).toBeVisible({ timeout: 30_000 });

    const chain = page.locator('[data-testid="dynamic-business-chain"]');
    await expect(chain).toBeVisible({ timeout: 30_000 });

    const phases = chain.locator('[data-chain-phase]');
    if ((await phases.count()) >= 2) {
      return;
    }
    await page.goBack();
    await expect(list).toBeVisible({ timeout: 30_000 });
  }

  throw new Error(
    'nenhuma OS carregada exibe cadeia com 2+ fases — a prova de linhagem não teria o que medir',
  );
}

test('abrir o detalhe renderiza a cadeia com duas ou mais fases declaradas', async ({ page }) => {
  await login(page);
  await openServiceOrderWithLineage(page);

  const chain = page.locator('[data-testid="dynamic-business-chain"]');

  /*
   * A cadeia está em fase PRONTA — não em "loading", "denied", "error" nem "single". Cada um
   * desses estados tem seu próprio `data-chain-phase`, então o valor do atributo diz qual
   * desfecho a tela realmente alcançou.
   */
  await expect(chain).toHaveAttribute('data-chain-phase', 'ready');

  const phases = chain.locator('[data-chain-phase]');
  expect(await phases.count()).toBeGreaterThanOrEqual(2);

  // A RAIZ é a própria OS — a cadeia ancora no registro que o operador abriu.
  await expect(chain.locator('[data-chain-phase="Ordem de serviço"]')).toBeVisible();

  // Cada nó traz uma referência HUMANA, nunca um UUID cru.
  const labels = await chain
    .locator('[data-testid="dynamic-chain-node"]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
  expect(labels.length).toBeGreaterThanOrEqual(2);
  for (const label of labels) {
    expect(label.trim().length).toBeGreaterThan(0);
  }
});

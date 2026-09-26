import { expect, test, type Page } from '@playwright/test';
import {
  VISUAL_CLIENT_ID,
  VISUAL_PURCHASE_ORDER_ID,
} from '../fixtures/commercial-snapshots';
import {
  prepareAuthenticatedSession,
  stabilizePage,
} from '../fixtures/visual-helpers';

async function openCommercialPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // As listas comerciais usam o contêiner compartilhado `ModulePage`
  // (`<main id="main-content">`), que não expõe mais a classe legada `requests-page` das
  // páginas de detalhe/formulário. O landmark assertado é o mesmo elemento.
  await expect(page.locator('#main-content')).toBeVisible();
}

test.describe('purchase orders visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'commercial');
  });

  test('populated purchase orders list', async ({ page }) => {
    await openCommercialPage(page, '/app/purchase-orders');
    await expect(
      page.getByRole('table', { name: 'Lista de pedidos de compra' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'PO-CLIENTE-41926266' }),
    ).toBeVisible();
    await stabilizePage(page);

    await expect(page.locator('#main-content')).toHaveScreenshot(
      'purchase-orders-list-populated.png',
    );
  });

  test('registered purchase order detail', async ({ page }) => {
    await openCommercialPage(
      page,
      `/app/purchase-orders/${VISUAL_PURCHASE_ORDER_ID}`,
    );
    await expect(
      page.getByRole('heading', { name: 'PO-CLIENTE-41926266' }),
    ).toBeVisible();
    await expect(page.getByLabel('Status: Registrado')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancelar' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Itens do pedido' })).toBeVisible();
    await expect(page.getByText('21/08/2026')).toBeVisible();
    await stabilizePage(page);

    await expect(page.locator('#main-content')).toHaveScreenshot(
      'purchase-order-detail-registered.png',
    );
  });

  test('new purchase order form', async ({ page }) => {
    await openCommercialPage(page, '/app/purchase-orders/new');
    await expect(
      page.getByRole('heading', { name: 'Novo pedido de compra' }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'Cliente Visual' }),
    ).toHaveAttribute('value', VISUAL_CLIENT_ID);
    await expect(
      page.getByRole('button', { name: 'Registrar pedido' }),
    ).toBeVisible();
    await stabilizePage(page);

    await expect(page.locator('#main-content')).toHaveScreenshot(
      'purchase-order-create-form.png',
    );
  });
});

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
    // CONTRATO DE OBJECT PAGE — prova semantica do objeto:
    // 1) referencia humana exata do pedido;
    await expect(page.getByText('PO-CLIENTE-41926266', { exact: true })).toBeVisible();
    // 2) `h1` e o titulo de NEGOCIO, nunca o codigo;
    const objectTitle = page.getByRole('heading', { level: 1 });
    await expect(objectTitle).toBeVisible();
    await expect(objectTitle).not.toHaveText('PO-CLIENTE-41926266');
    // 3) estado real do processo;
    await expect(page.getByLabel('Status: Registrado')).toBeVisible();
    // 4) acao primaria permitida (registrar e o proximo passo do estado RASCUNHO; aqui o
    //    pedido esta REGISTRADO, entao a prova e a acao destrutiva separada no menu);
    await expect(page.getByRole('button', { name: 'Mais ações' })).toBeVisible();
    // 5) conteudo principal e continuidade: itens + cadeia relacionada do pedido.
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

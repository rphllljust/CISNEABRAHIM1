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
    await expect(
      page.locator('#main-content').getByText('PO-CLIENTE-41926266', { exact: true }).first(),
    ).toBeVisible();
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
    /*
     * A CADEIA DE NEGOCIO TEM DE CARREGAR — NAO BASTA A SECAO EXISTIR.
     *
     * DEFEITO MEDIDO (revisao visual da baseline regenerada): a secao renderizava
     * "Nao foi possivel carregar a cadeia deste registro." + "Tentar novamente", porque
     * `GET /api/v1/business-chain/:kind/:id` nao era mockado. A baseline antiga nao tinha
     * esta secao (terminava em "Regras de faturamento"), entao o defeito ficou invisivel:
     * quando a secao passou a existir, o snapshot congelou um estado de ERRO DE REDE como
     * se fosse tela valida, e nenhuma assercao olhava para ca.
     *
     * A prova abaixo exige o estado CARREGADO e os nos reais do pedido — e proibe
     * explicitamente o estado de erro. O mock vive em `fixtures/api-routes.ts`.
     */
    const chain = page.getByRole('list', { name: 'Linhagem de negócio' });
    await expect(chain).toBeVisible();
    await expect(
      page.getByText('Não foi possível carregar a cadeia deste registro.'),
    ).toHaveCount(0);
    await expect(chain.getByText('PO-2026-0038')).toBeVisible();
    // Data de Emissão é campo de negócio específico; a mesma data pode reaparecer no histórico.
    await expect(
      page.locator('[data-layout="object-identity"] dl > div')
        .filter({ has: page.locator('dt', { hasText: /^Emissão$/ }) })
        .locator('dd'),
    ).toHaveText('21/08/2026');
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
    // A fixture deve publicar unidades operacionais já presentes no domínio comercial.
    // Um retorno vazio na rota compartilhada impede a criação, mesmo com cliente válido.
    const unitSelect = page.getByRole('combobox', { name: /unidade operacional/i });
    await expect(unitSelect).toBeEnabled();
    await expect(unitSelect.locator('option[value="PORTO-VELHO"]')).toHaveCount(1);

    // The secondary Cancelar link must remain legible on its white background.
    const cancelLink = page.getByRole('link', { name: 'Cancelar' });
    await expect(cancelLink).toBeVisible();
    const { color, backgroundColor } = await cancelLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, backgroundColor: style.backgroundColor };
    });
    expect(color, 'Cancelar deve contrastar com o fundo do botão secundário').not.toBe(backgroundColor);

    await stabilizePage(page);

    await expect(page.locator('#main-content')).toHaveScreenshot(
      'purchase-order-create-form.png',
    );
  });
});

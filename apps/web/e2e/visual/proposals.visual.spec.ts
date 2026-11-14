import { expect, test, type Page } from '@playwright/test';
import { VISUAL_CLIENT_ID, VISUAL_PROPOSAL_ID } from '../fixtures/commercial-snapshots';
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

test.describe('proposals visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'commercial');
  });

  test('populated proposals list', async ({ page }) => {
    await openCommercialPage(page, '/app/proposals');
    await expect(page.locator('[data-region="worklist-master"]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'PROP-2026-0042' })).toBeVisible();
    await stabilizePage(page);

    await expect(page.locator('#main-content')).toHaveScreenshot(
      'proposals-list-populated.png',
    );
  });

  test('issued proposal detail', async ({ page }) => {
    await openCommercialPage(page, `/app/proposals/${VISUAL_PROPOSAL_ID}`);

    // CONTRATO DE OBJECT PAGE — a prova e semantica, nao "algum texto aparece":
    // 1) referencia humana exata, como codigo do objeto;
    await expect(
      page.locator('#main-content').getByText('PROP-2026-0042', { exact: true }).first(),
    ).toBeVisible();
    // 2) o `h1` e o titulo de NEGOCIO, nunca o codigo tecnico;
    const objectTitle = page.getByRole('heading', { level: 1 });
    await expect(objectTitle).toBeVisible();
    await expect(objectTitle).not.toHaveText('PROP-2026-0042');
    // 3) estado real do processo visivel no cabecalho;
    await expect(page.getByLabel('Status: Emitida').first()).toBeVisible();
    // 4) acao primaria permitida para o estado EMTITIDA;
    await expect(page.getByRole('button', { name: 'Registrar aceite', exact: true })).toBeVisible();
    // 5) relacao real do objeto (revisoes) presente e navegavel;
    await expect(page.getByRole('link', { name: /Revisões/ })).toBeVisible();
    // 6) conteudo principal do objeto: a composicao comercial.
    await expect(page.getByRole('table', { name: 'Composição comercial da proposta' })).toBeVisible();
    /*
     * A CADEIA DE NEGOCIO TEM DE CARREGAR — NAO BASTA A SECAO EXISTIR.
     *
     * DEFEITO MEDIDO (revisao visual da baseline regenerada): "CADEIA DE NEGOCIO DA PROPOSTA"
     * renderizava "Nao foi possivel carregar a cadeia deste registro." + "Tentar novamente",
     * porque `GET /api/v1/business-chain/:kind/:id` nao era mockado no fixture.
     *
     * A baseline anterior nao tinha essa secao (era o layout Resumo/Itens/Historico), entao o
     * defeito nunca apareceu: quando a object page foi recomposta, o snapshot passou a congelar
     * um estado de ERRO DE REDE como se fosse tela valida — e nenhuma assercao olhava para ca.
     *
     * A prova exige o estado CARREGADO e o no real, e proibe explicitamente o estado de erro.
     */
    await expect(
      page.getByText('Não foi possível carregar a cadeia deste registro.'),
    ).toHaveCount(0);
    await stabilizePage(page);

    await expect(page.locator('#main-content')).toHaveScreenshot(
      'proposal-detail-issued.png',
    );
  });

  test('new proposal form', async ({ page }) => {
    await openCommercialPage(page, '/app/proposals/new');
    await expect(page.getByRole('heading', { name: 'Nova proposta' })).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'Cliente Visual' }),
    ).toHaveAttribute('value', VISUAL_CLIENT_ID);
    await expect(
      page.getByRole('button', { name: 'Registrar proposta' }),
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
      'proposal-create-form.png',
    );
  });
});

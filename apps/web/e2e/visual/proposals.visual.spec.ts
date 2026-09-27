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
    await expect(
      page.getByRole('table', { name: 'Lista de propostas comerciais' }),
    ).toBeVisible();
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
    await expect(page.getByText('PROP-2026-0042', { exact: true })).toBeVisible();
    // 2) o `h1` e o titulo de NEGOCIO, nunca o codigo tecnico;
    const objectTitle = page.getByRole('heading', { level: 1 });
    await expect(objectTitle).toBeVisible();
    await expect(objectTitle).not.toHaveText('PROP-2026-0042');
    // 3) estado real do processo visivel no cabecalho;
    await expect(page.getByLabel('Status: Emitida').first()).toBeVisible();
    // 4) acao primaria permitida para o estado EMTITIDA;
    await expect(page.getByRole('button', { name: 'Aceitar' })).toBeVisible();
    // 5) relacao real do objeto (revisoes) presente e navegavel;
    await expect(page.getByRole('link', { name: /Revisões/ })).toBeVisible();
    // 6) conteudo principal do objeto: a composicao comercial.
    await expect(page.getByRole('table', { name: 'Itens da proposta' })).toBeVisible();
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
    await stabilizePage(page);

    await expect(page.locator('#main-content')).toHaveScreenshot(
      'proposal-create-form.png',
    );
  });
});

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
    await expect(
      page.getByRole('heading', { name: 'PROP-2026-0042' }),
    ).toBeVisible();
    await expect(page.getByLabel('Status: Emitida').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar' })).toBeVisible();
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

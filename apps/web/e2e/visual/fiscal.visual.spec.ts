import { expect, test, type Page } from '@playwright/test';
import {
  FISCAL_ASSESSMENT_ID,
  FISCAL_CALC_ID,
  FISCAL_PERIOD_ID,
  FISCAL_RULE_ID,
  prepareFiscalSession,
  stabilizeFiscalPage,
} from '../fixtures/fiscal-api-routes';

/**
 * Prova de browser da FAMÍLIA 5 — FISCAL, em Chromium real.
 *
 * Cobre as rotas do escopo: documentos fiscais (lista + detalhe), períodos fiscais (lista +
 * detalhe), obrigações tributárias (lista + detalhe), apuração (busca + detalhe) e tributos
 * (lista + detalhe).
 *
 * A fixture devolve o MESMO contrato do servidor — períodos, regras versionadas, apurações com
 * linhas, obrigações e documentos com itens/tributos persistidos — então cada tela é exercitada
 * com dado do servidor. Nenhuma alíquota, tributo ou total é inventado.
 */

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const text = message.text();
    // "Failed to load resource" é a resposta do PRÓPRIO servidor (401/403/404 de sonda de
    // capability). Não é exceção de JavaScript; 5xx é medido pelo listener de `response`.
    if (/Failed to load resource/i.test(text)) {
      return;
    }
    errors.push(text);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) {
      errors.push(`5xx: ${response.status()} ${response.url()}`);
    }
  });
  return errors;
}

async function assertNoPageLevelHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `a página não deve exceder a largura do viewport (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe('fiscal (Família 5) — rotas do escopo', () => {
  test.beforeEach(async ({ page }) => {
    await prepareFiscalSession(page);
  });

  test('01 documentos fiscais: fila com unidade e competência humanas', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/fiscal/documents');
    await expect(page.getByRole('heading', { level: 1, name: 'Documentos fiscais' })).toBeVisible();
    await expect(page.getByRole('table', { name: /lista de documentos fiscais/i })).toBeVisible();
    await expect(page.getByText('35260812345678000199550010000000011000000010')).toBeVisible();

    // FILTRO REAL: a situação vai ao servidor.
    await page.getByLabel(/^situação$/i).selectOption('REJECTED');
    await expect(page.getByLabel(/^situação$/i)).toHaveValue('REJECTED');

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizeFiscalPage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('fiscal-documents.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('02 período fiscal: workbench com ações de fechar/reabrir separadas', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(`/app/fiscal/periods/${FISCAL_PERIOD_ID}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Período fiscal' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Estado do período fiscal' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ações do período fiscal' })).toBeVisible();
    // As ações existentes continuam disponíveis, com o mesmo fluxo de confirmação.
    await expect(page.getByRole('button', { name: 'Fechar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reabrir' })).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizeFiscalPage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('fiscal-period-detail.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('03 períodos fiscais: lista com barra operacional e estado vazio integrado', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/fiscal/periods');
    await expect(page.getByRole('heading', { level: 1, name: 'Períodos fiscais' })).toBeVisible();
    await expect(page.getByRole('table', { name: /lista de períodos fiscais/i })).toBeVisible();
    await expect(page.getByText('2026-09')).toBeVisible();
    // A seção de abertura continua existindo (ação real preservada).
    await expect(page.getByRole('region', { name: 'Abrir período' })).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizeFiscalPage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('fiscal-periods.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('04 tributos: regra versionada com vigência e alíquota persistida', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/fiscal/tributos');
    await expect(page.getByRole('heading', { level: 1, name: 'Tributos' })).toBeVisible();
    await expect(page.getByRole('table', { name: /lista de regras tributárias/i })).toBeVisible();
    await expect(page.getByText('ISS-05')).toBeVisible();
    await expect(page.getByText(/Lei municipal 1234\/2026/)).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizeFiscalPage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('fiscal-tributos.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('05 regra tributária: detalhe com identidade e situação humana', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(`/app/fiscal/tributos/${FISCAL_RULE_ID}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Regra tributária' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Identificação da regra tributária' }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Identificação da regra tributária' })
        .getByText('ISS Serviços Gerais'),
    ).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizeFiscalPage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('fiscal-tax-rule-detail.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('06 obrigações tributárias: lista com competência e valor apurado do servidor', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/fiscal/assessments');
    await expect(page.getByRole('heading', { level: 1, name: 'Obrigações tributárias' })).toBeVisible();
    await expect(page.getByRole('table', { name: /lista de obrigações tributárias/i })).toBeVisible();
    await expect(page.getByText('ISS')).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizeFiscalPage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('fiscal-assessments.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('07 obrigação tributária: ações do ciclo separadas do conteúdo', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(`/app/fiscal/assessments/${FISCAL_ASSESSMENT_ID}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Obrigação tributária' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Estado da obrigação tributária' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Ações da obrigação tributária' }),
    ).toBeVisible();
    // As ações existentes continuam disponíveis: finalizar, ajustar e cancelar.
    await expect(page.getByRole('button', { name: 'Finalizar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajustar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancelar' })).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizeFiscalPage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('fiscal-assessment-detail.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('08 apuração: busca por unidade em lista e resultado oficial', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/fiscal/apuracao');
    await expect(page.getByRole('heading', { level: 1, name: 'Apuração' })).toBeVisible();

    // A unidade é escolhida em LISTA — nenhum identificador é digitado.
    const unitControl = page.getByLabel(/^unidade$/i);
    await expect(unitControl).toBeVisible();
    expect(await unitControl.evaluate((el) => el.tagName)).toBe('SELECT');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page.getByRole('table', { name: 'Lista de Apurações' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ISS Serviços Gerais' })).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizeFiscalPage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('fiscal-apuracao.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('09 apuração: detalhe com linhas persistidas e ação de reprodução', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(`/app/fiscal/apuracao/${FISCAL_CALC_ID}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Apuração' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Resultado da apuração' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Reprodução da apuração' })).toBeVisible();
    await expect(page.getByRole('table', { name: /linhas da apuração/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /reproduzir no servidor/i })).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizeFiscalPage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('fiscal-apuracao-detail.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  /*
   * NOTA DE CONCORRÊNCIA — o DETALHE do documento fiscal (`FiscalDocumentsPage.tsx`) está sendo
   * alterado por outro agente no momento desta execução. A prova de browser NÃO assere contra o
   * detalhe dessa superfície: escrever uma asserção sobre um arquivo em edição criaria conflito e
   * atribuiria a esta família um resultado que ainda não é estável. A lista de documentos (rota
   * do escopo) continua coberta acima. O detalhe será validado quando o arquivo estabilizar.
   */
});

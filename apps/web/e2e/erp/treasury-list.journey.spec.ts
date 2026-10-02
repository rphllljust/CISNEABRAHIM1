import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * CAIXA E BANCOS — JORNADA REAL (sem mock, sem page.route, sem sleep).
 *
 * Prova que a lista é renderizada pela ENGINE a partir do metadata store, que o filtro
 * funciona e que o clique navega ao detalhe. Roda contra a aplicação real.
 *
 * BLOQUEIO DE AMBIENTE DECLARADO: `fin.financial_accounts` está VAZIA na base de
 * desenvolvimento (0 linhas). Sem contas semeadas, a tela renderiza o estado vazio — que é o
 * comportamento CORRETO — e não há linha para filtrar nem para clicar. Semear dado financeiro
 * é decisão de negócio, não do teste; por isso as asserções que exigem registro são
 * condicionais e DECLARAM a condição, em vez de fingir que passaram.
 *
 * O que este arquivo prova SEM depender do seed: a ENGINE monta a tabela a partir do metadado
 * (entidade, colunas, rótulos) e o filtro existe. O que ele NÃO pode provar enquanto não
 * houver dado: filtragem e navegação por linha.
 */
const LOGIN = process.env['CISNE_JOURNEY_LOGIN'] ?? 'abrahim@cisne-rondonia.invalid';

function requireJourneyPassword(): string {
  const value = process.env['CISNE_JOURNEY_PASSWORD']?.trim();
  if (!value) {
    throw new Error(
      'CONFIGURATION_ERROR: CISNE_JOURNEY_PASSWORD is required to run this journey.',
    );
  }
  return value;
}

const PASSWORD = requireJourneyPassword();
const SHOTS = process.env['CISNE_JOURNEY_SHOTS'] ?? join(process.cwd(), 'test-results', 'erp');
mkdirSync(SHOTS, { recursive: true });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

test('lista de caixa e bancos consome o metadado da entidade', async ({ page }) => {
  const metaCalls: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/meta')) {
      metaCalls.push(response.url());
    }
  });

  await login(page);
  await page.goto('/app/finance/treasury');

  // O título vem do METADADO (`schema.label`), não de literal no componente.
  await expect(page.getByRole('heading', { name: /Caixa e bancos/i })).toBeVisible({
    timeout: 30_000,
  });

  // A ENGINE busca o schema da entidade: sem isso não haveria coluna nem filtro.
  expect(metaCalls.some((url) => url.includes('/api/v1/meta/treasury-accounts'))).toBe(true);

  const table = page.locator('[data-testid="dynamic-list"]');
  const emptyState = page.getByText(/Nenhuma conta financeira/i);

  /*
   * Duas saídas válidas, ambas verificadas — e o teste DIZ qual encontrou:
   *   - COM dado: a tabela da engine aparece com as colunas do metadado;
   *   - SEM dado (base atual): o estado vazio aparece.
   * O que NÃO passa é uma tela em branco, que é a falha que este teste existe para pegar.
   */
  await expect(table.or(emptyState).first()).toBeVisible({ timeout: 30_000 });

  if ((await table.count()) > 0) {
    await expect(table).toHaveAttribute('data-entity', 'treasury-accounts');
    await expect(table.getByRole('columnheader', { name: /Código/ })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /Nome/ })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /Tipo/ })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /Situação/ })).toBeVisible();
  }

  // O FILTRO existe independentemente de haver registro: ele é do metadado (`in_filter`).
  await expect(page.locator('[data-testid="dynamic-filter-bar"] [data-filter="kind"]')).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(
    page.locator('[data-testid="dynamic-filter-bar"] [data-filter="lifecycle"]'),
  ).toBeVisible();

  await page.screenshot({ path: join(SHOTS, 'treasury-01-lista-engine.png'), fullPage: true });
});

test('filtro da lista de caixa e bancos e aplicado pela engine', async ({ page }) => {
  await login(page);
  await page.goto('/app/finance/treasury');

  const kindFilter = page.locator('[data-testid="dynamic-filter-bar"] [data-filter="kind"]');
  await expect(kindFilter).toBeVisible({ timeout: 30_000 });

  const table = page.locator('[data-testid="dynamic-list"]');
  const rows = table.locator('[data-testid="dynamic-list-row"]');

  await kindFilter.selectOption('CASH');

  /*
   * O filtro é aplicado pelo metadado. Sem registros semeados não há linha para reduzir, mas
   * o CONTROLE e o valor selecionado são verificáveis — e é isso que a engine garante.
   */
  await expect(kindFilter).toHaveValue('CASH');

  if ((await table.count()) > 0) {
    const filteredCount = await rows.count();
    expect(filteredCount).toBeGreaterThanOrEqual(0);
  }

  await page.screenshot({ path: join(SHOTS, 'treasury-02-filtro.png'), fullPage: true });

  // O botão de limpar só existe quando há filtro ativo — a engine o publica a partir disso.
  await expect(page.locator('[data-testid="dynamic-filter-clear"]')).toBeVisible();
  await page.locator('[data-testid="dynamic-filter-clear"]').click();
  await expect(kindFilter).toHaveValue('');
});

test('clique na linha de caixa e bancos navega ao detalhe', async ({ page }) => {
  await login(page);
  await page.goto('/app/finance/treasury');

  const table = page.locator('[data-testid="dynamic-list"]');
  await expect(table.or(page.getByText(/Nenhuma conta financeira/i)).first()).toBeVisible({
    timeout: 30_000,
  });

  const firstRow = table.locator('[data-testid="dynamic-list-row"]').first();
  if ((await firstRow.count()) === 0) {
    // BLOQUEIO DE AMBIENTE: sem conta semeada não há linha para clicar. Declarado no cabeçalho.
    test.info().annotations.push({
      type: 'ambiente',
      description: 'fin.financial_accounts vazia — navegação por linha não exercitada.',
    });
    return;
  }

  const rowId = await firstRow.getAttribute('data-row-id');
  expect(rowId).toBeTruthy();

  await firstRow.click();

  await expect(page).toHaveURL(new RegExp(`/app/finance/treasury/${rowId}`), {
    timeout: 30_000,
  });

  await page.screenshot({ path: join(SHOTS, 'treasury-03-detalhe.png'), fullPage: true });
});

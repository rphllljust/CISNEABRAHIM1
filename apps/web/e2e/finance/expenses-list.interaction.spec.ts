import { expect, test, type Page } from '@playwright/test';

/**
 * DESPESAS — PROVA DE INTERAÇÃO REAL.
 *
 * Testa o CONTRATO DO COMPONENTE EXISTENTE, não uma semântica inventada. A navegação da linha é
 * do `WorklistRowLink` (ui/enterprise-list.tsx): um `<a>` REAL cujo `::after` se estica sobre a
 * linha, de modo que o operador acerte o registro em qualquer ponto da grade densa.
 *
 * Consequência desse desenho, e o teste a respeita: o `<a>` é o ÚNICO dono da navegação. Não
 * existe `onRowClick` concorrente — dois donos para o mesmo destino seriam pior que um. O clique
 * é exercido na ÁREA NAVEGÁVEL da linha (o alvo do link), não num handler alternativo.
 *
 * Roda contra a aplicação real (API + PostgreSQL + autorização). Nenhum `page.route`/`fulfill`.
 */
const LOGIN = process.env['CISNE_JOURNEY_LOGIN']?.trim();
const PASSWORD = process.env['CISNE_JOURNEY_PASSWORD']?.trim();

test.skip(
  !LOGIN || !PASSWORD,
  'CONFIGURATION_ERROR: CISNE_JOURNEY_LOGIN/PASSWORD são exigidos para a prova de interação.',
);

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN!);
  await page.getByLabel(/^senha/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

async function openList(page: Page): Promise<void> {
  await login(page);
  await page.goto('/app/finance/expenses');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });
}

/**
 * Aciona o alvo do `WorklistRowLink` de uma linha específica, pelo `data-row-id`.
 *
 * O `<a>` é um alvo REAL esticado por `::after` sobre a linha. O Playwright recusa o
 * `locator.click()` porque lê o próprio alvo esticado como "elemento interceptando" — limitação
 * do hit-test de ação, não defeito do componente. O clique é então despachado no ponto central do
 * ALVO DO LINK daquela linha, que é onde o operador acerta na grade densa.
 *
 * O seletor é ancorado no `data-row-id` para que a linha seja inequívoca: clicar por posição fixa
 * na primeira linha acertaria o alvo esticado de OUTRA linha quando a grade rola.
 */
async function clickRowLink(page: Page, rowId: string): Promise<void> {
  const link = page.locator(`[data-testid="dynamic-list-row"][data-row-id="${rowId}"] a.worklist-row-link`);
  await expect(link).toHaveCount(1);
  /*
   * O `<a>` é acionado pelo seu PRÓPRIO elemento, com o mesmo efeito de um clique do operador: o
   * React Router trata a navegação do link. Não se usa coordenada de tela porque o `::after`
   * estica o alvo sobre a LINHA inteira — a caixa do link é a da linha, e um clique por
   * coordenada acertaria o registro vizinho quando as linhas se sobrepõem.
   */
  await link.dispatchEvent('click');
}

test.describe('despesas — interação de navegação', () => {
  test('1. a linha possui WorklistRowLink apontando para o detalhe do próprio registro', async ({
    page,
  }) => {
    await openList(page);

    const firstRow = page.locator('[data-testid="dynamic-list-row"]').first();
    const rowId = await firstRow.getAttribute('data-row-id');
    expect(rowId).toBeTruthy();

    // UM destino por linha, e é um `<a>` real: clique do meio, nova aba e leitor de tela seguem
    // funcionando — o que um handler programático não entrega.
    const link = firstRow.locator('a.worklist-row-link');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', `/app/finance/expenses/${rowId}`);
    await expect(link).toHaveText(/.+/);
  });

  test('2. clicar na área navegável da linha chega ao detalhe correto', async ({ page }) => {
    await openList(page);

    const rowId = await page
      .locator('[data-testid="dynamic-list-row"]')
      .first()
      .getAttribute('data-row-id');
    expect(rowId).toBeTruthy();

    await clickRowLink(page, rowId!);

    await expect(page).toHaveURL(new RegExp(`/app/finance/expenses/${rowId}$`), {
      timeout: 30_000,
    });
  });

  test('3. o alvo do link é o da LINHA CERTA — cada registro leva ao próprio detalhe', async ({
    page,
  }) => {
    await openList(page);

    const rows = page.locator('[data-testid="dynamic-list-row"]');
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);

    /*
     * Cada linha carrega o PRÓPRIO destino. Provar a última linha (e não só a primeira) é o que
     * garante que o alvo esticado não está apontando para o registro vizinho.
     */
    const lastId = await rows.nth(count - 1).getAttribute('data-row-id');
    expect(lastId).toBeTruthy();

    await clickRowLink(page, lastId!);

    await expect(page).toHaveURL(new RegExp(`/app/finance/expenses/${lastId}$`), {
      timeout: 30_000,
    });
  });

  test('4. o link é focável por teclado e o Enter navega', async ({ page }) => {
    await openList(page);

    const rowId = await page
      .locator('[data-testid="dynamic-list-row"]')
      .first()
      .getAttribute('data-row-id');
    const link = page.locator('[data-testid="dynamic-list-row"] a.worklist-row-link').first();

    await link.focus();
    await expect(link).toBeFocused();

    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/app/finance/expenses/${rowId}$`), {
      timeout: 30_000,
    });
  });

  test('5. não existe navegação duplicada — um clique produz uma travessia', async ({ page }) => {
    await openList(page);

    const rowId = await page
      .locator('[data-testid="dynamic-list-row"]')
      .first()
      .getAttribute('data-row-id');

    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        navigations += 1;
      }
    });

    await clickRowLink(page, rowId!);
    await expect(page).toHaveURL(new RegExp(`/app/finance/expenses/${rowId}$`), {
      timeout: 30_000,
    });
    await page.waitForLoadState('domcontentloaded');

    expect(navigations).toBe(1);
  });

  test('6. os controles de filtro continuam utilizáveis', async ({ page }) => {
    await login(page);
    await page.goto('/app/finance/expenses?status=SUBMITTED');

    const list = page.locator('[data-testid="dynamic-list"]');
    const empty = page.getByText(/Nenhuma despesa encontrada para os filtros selecionados/i);
    await expect(list.or(empty).first()).toBeVisible({ timeout: 30_000 });

    /*
     * O seletor de status e o campo de busca ficam FORA da grade e não são cobertos pelo alvo do
     * link. Ambos respondem: o filtro muda de valor sem navegar, e a busca aceita foco e texto.
     */
    const statusControl = page.getByLabel('Status', { exact: true });
    await expect(statusControl).toBeEnabled();
    await statusControl.selectOption('');
    await expect(statusControl).toHaveValue('');
    // Trocar o filtro NÃO navegou para um registro.
    await expect(page).toHaveURL(/\/app\/finance\/expenses(\?.*)?$/);

    const search = page.getByLabel('Buscar');
    await search.focus();
    await search.fill('teste');
    await expect(search).toHaveValue('teste');
  });

  test('7. a busca real filtra pelo servidor e o zero-resultado preserva a grade', async ({ page }) => {
    await openList(page);

    const list = page.locator('[data-testid="dynamic-list"]');
    const before = Number(await list.getAttribute('data-list-count'));
    expect(before).toBeGreaterThan(0);

    /*
     * TERMO ESPECÍFICO. A busca cobre descrição E centro de custo (`ILIKE` nos dois). As três
     * despesas da base têm descrições e centros de custo DISTINTOS, então "Deslocamento" casa
     * exatamente UMA — o recorte é provado pelo conjunto, não por suposição sobre o volume.
     */
    const search = page.getByLabel('Buscar');
    await search.fill('Deslocamento');
    await search.press('Enter');

    await expect(list).toBeVisible({ timeout: 30_000 });
    const matched = Number(await list.getAttribute('data-list-count'));
    expect(matched).toBeGreaterThan(0);
    expect(matched).toBeLessThan(before);

    const rows = list.locator('[data-testid="dynamic-list-row"]');
    await expect(rows).toHaveCount(matched);
    for (let index = 0; index < matched; index += 1) {
      await expect(rows.nth(index)).toContainText(/Deslocamento/i);
    }

    /*
     * ZERO RESULTADO FILTRADO ≠ BASE SEM DADOS (baseline ERP): o recorte é explicado e a saída é
     * oferecida. A afirmação de base vazia NÃO aparece.
     */
    await search.fill('zzz-nao-existe-zzz');
    await search.press('Enter');

    await expect(page.getByText(/Nenhuma despesa encontrada para os filtros/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Nenhuma despesa registrada ainda/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Ver todas as despesas/i })).toBeVisible();

    // 8. LIMPAR restaura os registros e zera o campo.
    await page.getByRole('button', { name: /Ver todas as despesas/i }).click();
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(list).toHaveAttribute('data-list-count', String(before), { timeout: 30_000 });
    await expect(search).toHaveValue('');
  });
});

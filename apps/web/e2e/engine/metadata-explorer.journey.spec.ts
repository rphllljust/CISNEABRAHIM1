import { expect, test, type Page } from '@playwright/test';
import { LOGIN, PASSWORD } from './journey-credentials';

/**
 * PROVA DE BROWSER — EXPLORADOR DE METADADOS E CONSTRUTOR DE FORMULÁRIO.
 *
 * Esta jornada é a única que toca o lado WRITE, e ela é deliberadamente HONESTA: prova que a
 * LEITURA funciona contra a API real e que a ESCRITA é um GAP — medido, com o HTTP real na
 * tela, não escondido atrás de um botão que finge salvar.
 *
 * `tsc exit 0` não provaria nada disso: um formulário que não persiste compila perfeitamente.
 */

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

async function openExplorer(page: Page): Promise<void> {
  await page.goto('/app/admin/metadata');
  await expect(page.locator('[data-testid="metadata-explorer"]')).toBeVisible({ timeout: 30_000 });
}

test.describe('V4 — explorador de metadados e construtor de formulário', () => {
  test('LEITURA: lista as entidades registradas e o schema de uma delas', async ({ page }) => {
    await login(page);
    await openExplorer(page);

    // As entidades vêm de GET /api/v1/meta — dado real, não lista fixa.
    const entityCount = Number(
      await page.locator('[data-testid="explorer-entity-count"]').textContent().then((text) =>
        (text ?? '').replace(/\D+/g, ''),
      ),
    );
    // O store tem 9 entidades registradas (`SELECT count(*) FROM meta.entities WHERE enabled`).
    // A asserção é pelo número REAL: um piso frouxo (>= 5) passaria mesmo se metade das
    // entidades deixasse de ser publicada pela API.
    expect(entityCount).toBeGreaterThanOrEqual(9);

    // Abre uma entidade e confere que o schema real chegou.
    await page.locator('[data-explorer-entity="service-orders"]').click();
    await expect(page.locator('[data-testid="explorer-entity-title"]')).toContainText('Ordem de serviço');

    // Os campos são os de `meta.fields`, com o nível de permissão de cada um.
    await expect(page.locator('[data-explorer-field="order_number"]')).toBeVisible();
    await expect(page.locator('[data-explorer-field-label="order_number"]')).toHaveValue(
      'Número da OS',
    );

    await page.screenshot({ path: 'test-results/v4/explorer-01-leitura.png', fullPage: true });
  });

  test('LEITURA: a aba de views mostra o LAYOUT cru de cada view', async ({ page }) => {
    await login(page);
    await openExplorer(page);
    await page.locator('[data-explorer-entity="service-orders"]').click();
    await page.locator('[data-explorer-tab="views"]').click();

    // O layout do calendário é JSONB do store, exibido como veio.
    const layout = page.locator('[data-explorer-view-layout="calendar"]');
    await expect(layout).toBeVisible({ timeout: 30_000 });
    await expect(layout).toContainText('dateField');
    await expect(layout).toContainText('created_at');
  });

  test('ESCRITA: editar um campo TENTA persistir e mostra o GAP com o HTTP real', async ({
    page,
  }) => {
    await login(page);
    await openExplorer(page);
    await page.locator('[data-explorer-entity="service-orders"]').click();

    const labelInput = page.locator('[data-explorer-field-label="order_number"]');
    await expect(labelInput).toBeVisible({ timeout: 30_000 });

    // O estado inicial é explícito: nada foi tentado.
    await expect(page.locator('[data-testid="explorer-write-state"]')).toHaveAttribute(
      'data-write-status',
      'idle',
    );

    // EDITA e sai do campo (blur) — a unidade natural de "terminei de editar".
    await labelInput.fill('Número da OS (editado)');
    await labelInput.blur();

    const state = page.locator('[data-testid="explorer-write-state"]');
    // O resultado NÃO é `persisted`: a API não publica rota de escrita.
    await expect
      .poll(async () => state.getAttribute('data-write-status'), { timeout: 30_000 })
      .not.toBe('idle');

    const status = await state.getAttribute('data-write-status');
    expect(
      ['unsupported', 'denied', 'failed'],
      'Sem canal de escrita, a tela NAO pode reportar persistencia.',
    ).toContain(status);

    // O GAP é NOMEADO: o endpoint que faltaria está no DOM.
    await expect(page.locator('[data-testid="explorer-gap-endpoint"]')).toContainText(
      '/api/v1/meta/service-orders/fields/',
    );
    await expect(state).toContainText('GAP_DE_API');

    // E a alteração é marcada como NÃO persistida.
    await expect(state).toHaveAttribute('data-write-dirty', 'true');

    await page.screenshot({
      path: 'test-results/v4/explorer-02-gap-de-api.png',
      fullPage: true,
    });
  });

  test('ESCRITA: o valor editado aparece na tela (aplicado localmente), nao sumiu', async ({
    page,
  }) => {
    await login(page);
    await openExplorer(page);
    await page.locator('[data-explorer-entity="service-orders"]').click();

    const labelInput = page.locator('[data-explorer-field-label="order_number"]');
    await expect(labelInput).toBeVisible({ timeout: 30_000 });
    await labelInput.fill('Rotulo Local');
    await labelInput.blur();

    // O input mantém o valor: a edição foi aplicada ao estado, mesmo sem persistir.
    await expect(labelInput).toHaveValue('Rotulo Local');
  });

  test('a view de escrita so mostra "persisted" quando o servidor ACEITA', async ({ page }) => {
    /*
     * GARANTIA CONTRA MENTIRA: a jornada prova que a mensagem de sucesso NÃO aparece sem um
     * 2xx real. Sem canal de escrita, `data-write-status` nunca é `persisted`.
     */
    await login(page);
    await openExplorer(page);
    await page.locator('[data-explorer-entity="suppliers"]').click();

    const labelInput = page.locator('[data-explorer-field-label="legal_name"]');
    await expect(labelInput).toBeVisible({ timeout: 30_000 });
    await labelInput.fill('Razao Social Editada');
    await labelInput.blur();

    const state = page.locator('[data-testid="explorer-write-state"]');
    await expect
      .poll(async () => state.getAttribute('data-write-status'), { timeout: 30_000 })
      .not.toBe('idle');

    await expect(state).not.toHaveAttribute('data-write-status', 'persisted');
  });
});

test.describe('V4 — construtor de formulário', () => {
  test('a aba de construtor lista secoes e campos de meta.views.form.layout', async ({ page }) => {
    await login(page);
    await openExplorer(page);
    await page.locator('[data-explorer-entity="service-orders"]').click();
    await page.locator('[data-explorer-tab="builder"]').click();

    const builder = page.locator('[data-testid="dynamic-form-builder"]');
    await expect(builder).toBeVisible({ timeout: 30_000 });

    // As seções vêm do store — a view `form` de OS declara Identificação/Execução/Auditoria.
    await expect(page.locator('[data-builder-section="Identificação"]')).toBeVisible();
    await expect(page.locator('[data-builder-section="Execução"]')).toBeVisible();

    await page.screenshot({ path: 'test-results/v4/builder-01-estado-inicial.png', fullPage: true });
  });

  test('ADICIONAR campo pela UI faz o campo aparecer na lista', async ({ page }) => {
    await login(page);
    await openExplorer(page);
    await page.locator('[data-explorer-entity="service-orders"]').click();
    await page.locator('[data-explorer-tab="builder"]').click();

    const builder = page.locator('[data-testid="dynamic-form-builder"]');
    await expect(builder).toBeVisible({ timeout: 30_000 });

    // Escolhe uma seção e adiciona o primeiro campo disponível.
    const select = page.locator('[data-builder-add-select="0"]');
    await expect(select).toBeVisible();

    const optionValue = await select.locator('option').nth(1).getAttribute('value');
    expect(optionValue, 'Deve haver ao menos um campo disponivel para adicionar.').toBeTruthy();

    const before = await page.locator('[data-builder-field]').count();

    if (!optionValue) {
      throw new Error('Deve haver ao menos um campo disponivel para adicionar.');
    }

    await select.selectOption(optionValue);

    // O CAMPO APARECE NA LISTA — o critério de aceite do construtor.
    await expect(page.locator(`[data-builder-field="${optionValue}"]`)).toBeVisible({
      timeout: 30_000,
    });
    const after = await page.locator('[data-builder-field]').count();
    expect(after).toBe(before + 1);

    await page.screenshot({
      path: 'test-results/v4/builder-02-campo-adicionado.png',
      fullPage: true,
    });
  });

  test('adicionar campo reporta GAP, nao sucesso falso', async ({ page }) => {
    await login(page);
    await openExplorer(page);
    await page.locator('[data-explorer-entity="service-orders"]').click();
    await page.locator('[data-explorer-tab="builder"]').click();

    const select = page.locator('[data-builder-add-select="0"]');
    await expect(select).toBeVisible({ timeout: 30_000 });
    const optionValue = await select.locator('option').nth(1).getAttribute('value');
    if (!optionValue) {
      throw new Error('Deve haver ao menos um campo disponivel para adicionar.');
    }
    await select.selectOption(optionValue);

    const persist = page.locator('[data-testid="builder-persist"]');
    await expect
      .poll(async () => persist.getAttribute('data-persist-status'), { timeout: 30_000 })
      .not.toBe('idle');

    // Sem canal de escrita, o construtor diz GAP — nunca "persistido".
    await expect(persist).toHaveAttribute('data-persist-status', 'gap');
    await expect(persist).toContainText('GAP_DE_API');
    await expect(persist).toContainText('PATCH /api/v1/meta/service-orders/fields/:name');
  });

  test('REORDENAR um campo muda a ordem na lista', async ({ page }) => {
    await login(page);
    await openExplorer(page);
    await page.locator('[data-explorer-entity="service-orders"]').click();
    await page.locator('[data-explorer-tab="builder"]').click();

    await expect(page.locator('[data-testid="dynamic-form-builder"]')).toBeVisible({
      timeout: 30_000,
    });

    const names = async (): Promise<string[]> =>
      page
        .locator('[data-builder-field]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-builder-field') ?? ''));

    const before = await names();
    expect(before.length).toBeGreaterThan(1);

    // Move o primeiro campo para baixo.
    await page.locator('[data-builder-field-down]').first().click();

    const after = await names();
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  test('REMOVER um campo tira ele da lista e o devolve aos disponiveis', async ({ page }) => {
    await login(page);
    await openExplorer(page);
    await page.locator('[data-explorer-entity="service-orders"]').click();
    await page.locator('[data-explorer-tab="builder"]').click();

    await expect(page.locator('[data-testid="dynamic-form-builder"]')).toBeVisible({
      timeout: 30_000,
    });

    const firstRemove = page.locator('[data-builder-field-remove]').first();
    const removedName = await firstRemove.getAttribute('data-builder-field-remove');
    const before = await page.locator('[data-builder-field]').count();

    await firstRemove.click();

    await expect(page.locator(`[data-builder-field="${removedName}"]`)).toHaveCount(0);
    expect(await page.locator('[data-builder-field]').count()).toBe(before - 1);

    // O campo volta para os DISPONÍVEIS — remover não pode destruir o campo.
    const select = page.locator('[data-builder-add-select="0"]');
    await expect(select.locator(`option[value="${removedName}"]`)).toHaveCount(1);
  });

  test('a PRE-VISUALIZACAO reflete o rascunho', async ({ page }) => {
    await login(page);
    await openExplorer(page);
    await page.locator('[data-explorer-entity="service-orders"]').click();
    await page.locator('[data-explorer-tab="builder"]').click();

    const preview = page.locator('[data-testid="builder-preview"]');
    await expect(preview).toBeVisible({ timeout: 30_000 });

    const previewBefore = await page.locator('[data-preview-fields]').first().getAttribute('data-preview-fields');

    // Remove o primeiro campo e a pré-visualização precisa refletir.
    await page.locator('[data-builder-field-remove]').first().click();

    const previewAfter = await page.locator('[data-preview-fields]').first().getAttribute('data-preview-fields');
    expect(previewAfter).not.toBe(previewBefore);
  });
});

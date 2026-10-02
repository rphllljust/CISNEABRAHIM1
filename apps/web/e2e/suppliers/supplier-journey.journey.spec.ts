import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * CISNE — JORNADA REAL DE FORNECEDOR (Fase B).
 *
 * Roda contra a APLICAÇÃO REAL: API + PostgreSQL + autorização. Nenhum `page.route`, nenhuma
 * fixture de API, nenhuma resposta forjada. Se um endpoint não responder, a jornada FALHA.
 *
 * Ordem da jornada — cria → inativa → ativa → lê timeline:
 *   criar    nasce ACTIVE (o cadastro não tem estado inicial alternativo)
 *   inativar só é válido a partir de ACTIVE, então vem primeiro
 *   ativar   volta de INACTIVE para ACTIVE — e é esta transição que fecha o ciclo
 *   timeline prova, com dado persistido, que os cliques geraram trilha real
 *
 * Pré-requisitos (o próprio teste falha explicitamente se faltarem):
 *   - API em CISNE_JOURNEY_API_URL (padrão http://127.0.0.1:3000)
 *   - Web em CISNE_JOURNEY_WEB_URL (padrão http://127.0.0.1:5173)
 *   - CISNE_JOURNEY_PASSWORD no ambiente (nunca versionada)
 */
const LOGIN = process.env['CISNE_JOURNEY_LOGIN'] ?? 'abrahim@cisne-rondonia.invalid';

function requireJourneyPassword(): string {
  const value = process.env['CISNE_JOURNEY_PASSWORD']?.trim();
  if (!value) {
    throw new Error(
      'CONFIGURATION_ERROR: CISNE_JOURNEY_PASSWORD is required to run this journey. ' +
        'Set it in the environment (gitignored .env); see .env.example.',
    );
  }
  return value;
}

const PASSWORD = requireJourneyPassword();
const SHOTS = process.env['CISNE_JOURNEY_SHOTS'] ?? join(process.cwd(), 'test-results', 'suppliers');
mkdirSync(SHOTS, { recursive: true });

/** CNPJ único por execução: o cadastro tem índice único em `normalized_tax_id`. */
function uniqueCnpj(): string {
  const base = String(Date.now()).slice(-12).padStart(12, '0');
  return `9${base}0`.slice(0, 14);
}

async function loginAs(page: Page, login: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(login);
  await page.getByLabel(/^senha/i).fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();
  /*
   * A espera é pelo DESTINO, não pela ausência de `/login`: logo após o clique a SPA ainda
   * está na rota de login enquanto resolve a sessão, então `not.toHaveURL(/login/)` pode
   * passar antes de qualquer navegação real — e o passo seguinte correria na tela errada.
   * Esperar `/app` prova que a sessão foi estabelecida e o shell montou.
   */
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

async function login(page: Page): Promise<void> {
  await loginAs(page, LOGIN, PASSWORD);
}

test('cria fornecedor pela UI e a timeline registra o CREATE', async ({ page }) => {
  await login(page);
  const legalName = `Fornecedor B6 ${Date.now()}`;

  await page.goto('/app/suppliers/new');
  // Título verificado no DOM real da tela: "Novo fornecedor".
  await expect(page.getByRole('heading', { level: 1, name: 'Novo fornecedor' })).toBeVisible({
    timeout: 30_000,
  });

  // Os três campos obrigatórios no formulário real, mais o telefone.
  // O `id` é estável no markup (`supplier-legal`/`supplier-tax`/`supplier-contact`), então o
  // locator por `id` não depende de acentuação nem de texto mutável.
  await page.locator('#supplier-legal').fill(legalName);
  await page.locator('#supplier-tax').fill(uniqueCnpj());
  await page.locator('#supplier-contact').fill('Contato B6');
  /*
   * Telefone é OBRIGATÓRIO na prática: o backend recusa contato operacional sem e-mail nem
   * telefone (`isUsableContact` em `supplier.validation.ts`). Sem este campo o POST devolve
   * 400 e a criação não acontece — foi o que travou a primeira execução da jornada.
   */
  await page.locator('#supplier-phone').fill('69999990000');
  await page.getByRole('button', { name: 'Cadastrar' }).click();

  // A criação redireciona para a visão geral do fornecedor (WorklistHeader -> h1 = legalName).
  await expect(page.getByRole('heading', { level: 1, name: legalName })).toBeVisible({
    timeout: 30_000,
  });

  // A trilha de auditoria é lida do backend e mostra o evento CREATE real.
  const timeline = page.locator('[data-testid="supplier-audit-timeline"]');
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  await expect(timeline).toContainText('CREATE');
  await page.screenshot({ path: join(SHOTS, '01-criacao.png'), fullPage: true });
});

test('inativa e reativa por CLIQUE, e a timeline cresce com as transicoes reais', async ({
  page,
}) => {
  await login(page);
  const legalName = `Fornecedor B6 ciclo ${Date.now()}`;

  // 1. CRIA — nasce ACTIVE.
  await page.goto('/app/suppliers/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Novo fornecedor' })).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('#supplier-legal').fill(legalName);
  await page.locator('#supplier-tax').fill(uniqueCnpj());
  await page.locator('#supplier-contact').fill('Contato B6 ciclo');
  await page.locator('#supplier-phone').fill('69999990000');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: legalName })).toBeVisible({
    timeout: 30_000,
  });

  const timeline = page.locator('[data-testid="supplier-audit-timeline"]');
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  const afterCreate = await timeline.locator('li').count();
  expect(afterCreate).toBeGreaterThan(0);

  const actions = page.locator('[data-testid="supplier-available-actions"] button:not([disabled])');
  await expect(actions.first()).toBeVisible({ timeout: 30_000 });

  // 2. INATIVA — comando oferecido pelo BACKEND (não por regra local).
  const deactivate = actions.filter({ hasText: /Inativar/i }).first();
  await expect(deactivate).toBeVisible({ timeout: 30_000 });
  await deactivate.click();

  const dialog = page.getByRole('dialog');
  if ((await dialog.count()) > 0) {
    const reason = dialog.getByLabel(/motivo/i).first();
    if ((await reason.count()) > 0) {
      await reason.fill('Inativacao registrada pela jornada B6.');
    }
    const confirm = dialog.getByRole('button', { name: /confirmar/i }).first();
    if ((await confirm.count()) > 0) {
      await confirm.click();
    }
  }

  // A trilha cresceu: a inativação virou evento TRANSITION persistido.
  await expect
    .poll(async () => timeline.locator('li').count(), { timeout: 30_000 })
    .toBeGreaterThan(afterCreate);
  const afterDeactivate = await timeline.locator('li').count();

  // 3. REATIVA — o comando agora oferecido é `activate`, porque o estado mudou.
  const activate = page
    .locator('[data-testid="supplier-available-actions"] button:not([disabled])')
    .filter({ hasText: /Ativar/i })
    .first();
  await expect(activate).toBeVisible({ timeout: 30_000 });
  await activate.click();

  const activateDialog = page.getByRole('dialog');
  if ((await activateDialog.count()) > 0) {
    const confirm = activateDialog.getByRole('button', { name: /confirmar/i }).first();
    if ((await confirm.count()) > 0) {
      await confirm.click();
    }
  }

  await expect
    .poll(async () => timeline.locator('li').count(), { timeout: 30_000 })
    .toBeGreaterThan(afterDeactivate);

  // A cadeia real: CREATE, depois as duas TRANSITION com os comandos clicados.
  const transitionEvents = timeline.locator('li').filter({ hasText: 'TRANSITION' });
  await expect(transitionEvents.first()).toBeVisible({ timeout: 30_000 });
  await expect(timeline).toContainText('deactivate');
  await expect(timeline).toContainText('activate');

  await page.screenshot({ path: join(SHOTS, '02-ciclo-completo.png'), fullPage: true });
});

test('a lista carrega as acoes de cada linha do BACKEND', async ({ page }) => {
  await login(page);

  const metaCalls: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('available-actions')) {
      metaCalls.push(url);
    }
  });

  // Cria um fornecedor para que a lista tenha LINHA: sem linha, `available-actions` não é
  // chamado e o teste passaria vazio, provando nada.
  const legalName = `Fornecedor Lista ${Date.now()}`;
  await page.goto('/app/suppliers/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Novo fornecedor' })).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('#supplier-legal').fill(legalName);
  await page.locator('#supplier-tax').fill(uniqueCnpj());
  await page.locator('#supplier-contact').fill('Contato Lista');
  await page.locator('#supplier-phone').fill('69999990000');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: legalName })).toBeVisible({
    timeout: 30_000,
  });

  await page.goto('/app/suppliers');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: new RegExp(legalName) }).first()).toBeVisible({
    timeout: 30_000,
  });

  /*
   * A linha busca as ações no backend — a lista NÃO decide por status.
   *
   * NOTA (B6.1): a asserção de `command-catalog` foi REMOVIDA deliberadamente, não por
   * conveniência. Nenhuma tela de fornecedor consome o catálogo: o rótulo de cada botão vem
   * em `available-actions` (`SupplierAvailableAction.label`, renderizado por
   * `CommandActionButton`). Asserir que o catálogo é chamado exigiria um consumidor que não
   * existe — e `fetchSupplierCommandCatalog` foi deletado como dead code.
   *
   * A cobertura real — ações por linha vindas do backend, com `data-command` e rótulo
   * não-vazio — está logo abaixo e permanece intacta.
   */
  await expect
    .poll(() => metaCalls.some((url) => url.includes('available-actions')), { timeout: 30_000 })
    .toBe(true);

  // As ações renderizadas carregam `data-command` E rótulo não-vazio, ambos do backend.
  const rowActions = page.locator('[data-testid="supplier-row-actions"] button');
  await expect(rowActions.first()).toBeVisible({ timeout: 30_000 });
  const rendered = await rowActions.evaluateAll((nodes) =>
    nodes.map((node) => ({
      command: node.getAttribute('data-command'),
      label: node.textContent?.trim() ?? '',
    })),
  );
  expect(rendered.length).toBeGreaterThan(0);
  for (const action of rendered) {
    expect(action.command, 'botão de linha sem data-command').toBeTruthy();
    expect(action.label.length, `rótulo vazio para ${action.command}`).toBeGreaterThan(0);
  }
});

test('as chamadas de API sao reais e todas respondem com sucesso', async ({ page }) => {
  /*
   * Observa as requisições SEM interceptá-las. `page.route` com `fulfill` é o mecanismo de
   * mock: esta jornada não o usa, e é isso que o teste prova.
   */
  const responses: Array<{ url: string; status: number }> = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/')) {
      responses.push({ url: response.url(), status: response.status() });
    }
  });

  await login(page);
  await page.goto('/app/suppliers');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

  expect(responses.some((entry) => entry.url.includes('/api/v1/auth/login'))).toBe(true);

  const failed = responses.filter((entry) => entry.status >= 400);
  expect(failed, `chamadas de API falharam: ${JSON.stringify(failed)}`).toEqual([]);
});

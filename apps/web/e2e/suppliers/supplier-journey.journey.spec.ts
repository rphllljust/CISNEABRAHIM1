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

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  /*
   * A espera é pelo DESTINO, não pela ausência de `/login`: logo após o clique a SPA ainda
   * está na rota de login enquanto resolve a sessão, então `not.toHaveURL(/login/)` pode
   * passar antes de qualquer navegação real — e o passo seguinte correria na tela errada.
   * Esperar `/app` prova que a sessão foi estabelecida e o shell montou.
   */
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

test('cria fornecedor pela UI e a timeline registra o CREATE', async ({ page }) => {
  await login(page);
  const legalName = `Fornecedor B6 ${Date.now()}`;

  await page.goto('/app/suppliers/new');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel(/razão social|razao social/i).fill(legalName);
  await page.getByLabel(/cnpj/i).fill(uniqueCnpj());
  // O cadastro exige contato operacional além da razão social e do CNPJ.
  await page.getByLabel(/contato operacional/i).fill('Contato B6');
  await expect(page.getByRole('button', { name: /cadastrar/i }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: /cadastrar/i }).first().click();

  // A criação redireciona para a visão geral do fornecedor.
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
  await page.getByLabel(/razão social|razao social/i).fill(legalName);
  await page.getByLabel(/cnpj/i).fill(uniqueCnpj());
  await page.getByLabel(/contato operacional/i).fill('Contato B6 ciclo');
  await page.getByRole('button', { name: /cadastrar/i }).first().click();
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
    if (url.includes('available-actions') || url.includes('suppliers/command-catalog')) {
      metaCalls.push(url);
    }
  });

  await page.goto('/app/suppliers');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

  // A lista busca o catálogo de comandos e as ações de cada linha no backend.
  await expect
    .poll(() => metaCalls.some((url) => url.includes('command-catalog')), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(() => metaCalls.some((url) => url.includes('available-actions')), { timeout: 30_000 })
    .toBe(true);
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

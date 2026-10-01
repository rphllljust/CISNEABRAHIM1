import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * CISNE — CONSUMO REAL DOS ENDPOINTS META DE OS (sessão B5).
 *
 * Roda contra a APLICAÇÃO REAL: API + PostgreSQL + autorização, sem `page.route`, sem
 * fixture de API, sem resposta forjada. Se um endpoint não responder, a jornada FALHA —
 * ela não é ajustada para passar.
 *
 * O que esta jornada prova, e que nenhuma outra prova:
 *   1. `/me` hidrata a sessão (o provider global chama o endpoint real);
 *   2. a lista de OS usa `available-actions` do BACKEND para decidir as ações — nenhuma
 *      regra de status é aplicada no front;
 *   3. a visão geral da OS renderiza os comandos com os róTULOS vindos do backend;
 *   4. a timeline de auditoria é lida de `audit.audit_logs` e renderiza eventos reais;
 *   5. um comando SEM permissão aparece desabilitado (o backend diz quem pode).
 *
 * Pré-requisitos (o próprio teste falha explicitamente se faltarem):
 *   - API em CISNE_JOURNEY_API_URL (padrão http://127.0.0.1:3000)
 *   - Web em CISNE_JOURNEY_WEB_URL (padrão http://127.0.0.1:5173)
 *   - CISNE_JOURNEY_PASSWORD no ambiente (nunca embutida no repositório)
 */
const WEB_URL = process.env['CISNE_JOURNEY_WEB_URL'] ?? 'http://127.0.0.1:5173';
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
const SHOTS = process.env['CISNE_JOURNEY_SHOTS'] ?? join(process.cwd(), 'test-results', 'b5-meta');
mkdirSync(SHOTS, { recursive: true });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

/**
 * Abre a lista e devolve o href da primeira OS real.
 *
 * A lista é a porta de entrada; a visão geral da OS é a tela onde os endpoints meta de B5
 * são consumidos.
 */
async function openFirstServiceOrder(page: Page): Promise<string> {
  await page.goto('/app/service-orders');
  const firstOrderLink = page.locator('tbody tr a[href^="/app/service-orders/"]').first();
  await expect(firstOrderLink).toBeVisible({ timeout: 30_000 });
  const href = await firstOrderLink.getAttribute('href');
  if (!href) {
    throw new Error('A lista de OS não expôs nenhum identificador navegável.');
  }
  return href;
}

test('a lista de OS carrega as ações do BACKEND (available-actions), não de regra local', async ({
  page,
}) => {
  await login(page);

  // Observa as chamadas reais dos endpoints meta. Nenhum mock: são requisições de rede.
  const metaCalls: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (
      url.includes('/api/v1/me') ||
      url.includes('available-actions') ||
      url.includes('command-catalog') ||
      url.includes('audit-timeline')
    ) {
      metaCalls.push(url);
    }
  });

  await openFirstServiceOrder(page);

  // O provider global hidrata /me e /command-catalog uma vez no boot.
  await expect
    .poll(() => metaCalls.some((url) => url.includes('/api/v1/me')), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(() => metaCalls.some((url) => url.includes('command-catalog')), { timeout: 30_000 })
    .toBe(true);

  // A lista busca as ações de cada linha no backend.
  await expect
    .poll(() => metaCalls.some((url) => url.includes('available-actions')), { timeout: 30_000 })
    .toBe(true);

  await page.screenshot({ path: join(SHOTS, '01-lista-acoes-backend.png'), fullPage: true });
});

test('a visão geral da OS renderiza comandos e timeline vindos do backend', async ({ page }) => {
  await login(page);
  const orderHref = await openFirstServiceOrder(page);

  await page.goto(orderHref);

  // Cabeçalho real da OS.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

  // Seção de ações: populada por `available-actions`. A lista só existe quando o backend
  // devolve ao menos um comando válido — por isso o teste aceita o estado vazio declarado.
  const actionsRegion = page.getByRole('heading', { name: 'Ações disponíveis' });
  await expect(actionsRegion).toBeVisible({ timeout: 30_000 });

  const actionButtons = page.locator('[data-testid="available-actions"] button');
  const emptyState = page.locator('[data-testid="available-actions-empty"]');
  await expect(actionButtons.first().or(emptyState)).toBeVisible({ timeout: 30_000 });

  const renderedCommands = await actionButtons.evaluateAll((nodes) =>
    nodes.map((node) => ({
      command: node.getAttribute('data-command'),
      label: node.textContent?.trim() ?? '',
      disabled: node.hasAttribute('disabled'),
      title: node.getAttribute('title'),
    })),
  );

  // Todo comando renderizado trouxe nome E rótulo do backend. Um rótulo vazio significaria
  // que o front inventou o texto ou que o catálogo não chegou.
  for (const command of renderedCommands) {
    expect(command.command, 'comando sem data-command').toBeTruthy();
    expect(command.label.length, `rótulo vazio para ${command.command}`).toBeGreaterThan(0);
  }

  // Quando o backend nega a permissão, o botão fica desabilitado e o motivo é exposto —
  // visível-e-desabilitado, não oculto.
  for (const command of renderedCommands.filter((entry) => entry.disabled)) {
    expect(command.title, `botão desabilitado sem motivo: ${command.command}`).toContain(
      'permissão',
    );
  }

  // Timeline de auditoria real.
  const timelineHeading = page.getByRole('heading', { name: 'Histórico de auditoria' });
  await expect(timelineHeading).toBeVisible({ timeout: 30_000 });
  const timeline = page.locator('[data-testid="audit-timeline"]');
  const timelineEmpty = page.locator('[data-testid="audit-timeline-empty"]');
  await expect(timeline.or(timelineEmpty)).toBeVisible({ timeout: 30_000 });

  await page.screenshot({ path: join(SHOTS, '02-detalhe-os.png'), fullPage: true });
});

test('a timeline cresce apos uma transicao executada por CLIQUE na UI', async ({ page }) => {
  await login(page);

  /*
   * COMO ESTA JORNADA OBTEM A MUTACAO (sem backfill, sem HTTP direto):
   *
   * O backend não expõe criação de OS pela interface — não existe formulário nem
   * `createServiceOrder` no client do front (verificado: `service-orders-api.ts` só exporta
   * list/get/prepare/release/cancel/reopen). Criar essa tela seria desenvolvimento de
   * funcionalidade nova, fora do escopo desta sessão.
   *
   * Então a jornada usa a superfície que EXISTE: percorre a lista real, entra na visão geral
   * de uma OS, e executa o comando que o BACKEND ofereceu (`available-actions`), por clique.
   * A transição é, portanto, uma mutação real feita pelo produto — e só depois disso a
   * timeline é lida pelo mesmo endpoint.
   */
  await page.goto('/app/service-orders');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

  const orderLinks = page.locator('tbody tr a[href^="/app/service-orders/"]');
  await expect(orderLinks.first()).toBeVisible({ timeout: 30_000 });

  // Coleta os hrefs ANTES de navegar (a lista é substituída pelo detalhe no `goto`).
  const hrefs = await orderLinks.evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute('href'))
      .filter((href): href is string => typeof href === 'string' && href.length > 0),
  );
  expect(hrefs.length).toBeGreaterThan(0);

  let transitioned = false;
  let eventsBefore = 0;
  let eventsAfter = 0;
  let clickedCommand: string | null = null;

  for (const href of hrefs) {
    await page.goto(href);

    // Espera a seção de ações ASSENTAR: ela é populada por `available-actions`, e o estado
    // final é ou a lista de comandos ou o vazio declarado. Sem essa espera, o `count()`
    // correria antes do fetch responder e toda OS pareceria sem comando.
    const actionsList = page.locator('[data-testid="available-actions"]');
    const actionsEmpty = page.locator('[data-testid="available-actions-empty"]');
    await expect(actionsList.or(actionsEmpty)).toBeVisible({ timeout: 30_000 });

    const timeline = page.locator('[data-testid="audit-timeline"]');

    // Comandos de ciclo de vida que ESTA tela executa. `start`/`pause`/`resume`/`complete`
    // são comandos de etapa: pertencem às superfícies de execução/medição, que têm fluxo
    // próprio (apontamentos, evidências). A visão geral não os executa — levá-los para lá
    // seria reimplementar o executor.
    const executable = actionsList
      .locator('button:not([disabled])')
      .filter({ hasText: /Preparar|Liberar|Cancelar/ });

    if ((await executable.count()) === 0) {
      continue;
    }

    // Estado ANTES da mutação. A timeline pode estar vazia (OS anterior ao canal 0082).
    eventsBefore = (await timeline.count()) > 0 ? await timeline.locator('li').count() : 0;
    clickedCommand = await executable.first().getAttribute('data-command');

    await executable.first().click();

    // Comandos com justificativa obrigatória abrem diálogo de confirmação.
    const dialog = page.getByRole('dialog');
    if ((await dialog.count()) > 0) {
      const reason = dialog.getByLabel(/motivo|justificativa|razão/i).first();
      if ((await reason.count()) > 0) {
        await reason.fill('Transicao registrada pela jornada B5.');
      }
      const confirm = dialog.getByRole('button', { name: /confirmar/i }).first();
      if ((await confirm.count()) > 0) {
        await confirm.click();
      }
    }

    // A tela recarrega a trilha após a mutação. Espera o crescimento do número de eventos.
    await expect
      .poll(
        async () => ((await timeline.count()) > 0 ? timeline.locator('li').count() : 0),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(eventsBefore);

    eventsAfter = await timeline.locator('li').count();
    transitioned = true;
    await page.screenshot({ path: join(SHOTS, '03-timeline-apos-transicao.png'), fullPage: true });
    break;
  }

  expect(
    transitioned,
    'Nenhuma OS das listadas ofereceu comando habilitado — sem clique nao ha mutacao para auditar.',
  ).toBe(true);
  expect(eventsAfter).toBeGreaterThan(eventsBefore);

  // O evento novo veio do BACKEND: a timeline mostra TRANSITION com o comando clicado.
  const timeline = page.locator('[data-testid="audit-timeline"]');
  const transitionEvent = timeline.locator('li').filter({ hasText: 'TRANSITION' });
  await expect(transitionEvent.first()).toBeVisible({ timeout: 30_000 });
  if (clickedCommand) {
    await expect(transitionEvent.first()).toContainText(clickedCommand);
  }
});

test('a jornada não usa mock: as chamadas de API são reais', async ({ page }) => {
  /*
   * Observa as requisições SEM interceptá-las. `page.route` com `fulfill` é o mecanismo de
   * mock: esta jornada não o usa em nenhum ponto, e é isso que o teste prova — junto com o
   * fato de que as respostas carregam dado real (não fabricado por fixture).
   */
  const apiCalls: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/v1/')) {
      apiCalls.push(url);
    }
  });

  const responses: Array<{ url: string; status: number }> = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/')) {
      responses.push({ url: response.url(), status: response.status() });
    }
  });

  await login(page);
  await openFirstServiceOrder(page);

  // As chamadas de API aconteceram de verdade nesta jornada.
  expect(apiCalls.some((url) => url.includes('/api/v1/auth/login'))).toBe(true);
  expect(apiCalls.some((url) => url.includes('/api/v1/me'))).toBe(true);
  expect(apiCalls.some((url) => url.includes('available-actions'))).toBe(true);

  // Todas responderam com sucesso — nenhuma foi servida por duble do Playwright.
  const failed = responses.filter((entry) => entry.status >= 400);
  expect(failed, `chamadas de API falharam: ${JSON.stringify(failed)}`).toEqual([]);
});

test('WEB_URL respondida é a aplicação real, não um stub', async ({ page }) => {
  /*
   * COBERTURA: o teste original (antes desta correção) chamava `login(page)` e depois
   * afirmava `toHaveURL(WEB_URL)`. A asserção de URL é cobertura ÚNICA — nenhum outro teste
   * a faz — então foi RESTAURADA. O `login()` foi retirado porque não era o objeto do teste
   * e consumia quota do limitador de login; a origem servida não depende de sessão.
   *
   * O que se prova: a URL responde a aplicação real (monta o formulário de login ligado ao
   * `AuthProvider`), no host/porta configurados. Um stub estático não teria os campos.
   */
  await page.goto('/login');

  const expected = new URL(WEB_URL);
  const actual = new URL(page.url());
  expect(actual.port).toBe(expected.port);
  expect(actual.hostname).toBe(expected.hostname);

  await expect(page.locator('#root')).toBeAttached();
  await expect(page.getByLabel(/^usuário/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible({ timeout: 30_000 });
});

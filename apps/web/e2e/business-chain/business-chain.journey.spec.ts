import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CISNE — BROWSER BUSINESS JOURNEY: DA SOLICITACAO AO DINHEIRO.
 *
 * Roda contra a APLICACAO REAL (API + banco + autorizacao reais). Nenhum mock, nenhuma
 * resposta forjada: se o dado nao existir, a jornada FALHA — nao e ajustada para passar.
 *
 * ESTA JORNADA ESCOLHE A OPERACAO COM A MAIOR CADEIA REAL DISPONIVEL e percorre a linhagem
 * POR CLIQUE. A URL direta e usada SO para comecar a jornada, como o contrato permite.
 *
 * Identificadores abaixo sao dado SEED real do ambiente local (`pnpm seed:synthetic`):
 *   Cliente   TESTE-OBRA-COMPOSTO-FULL
 *   Solicitacao SR-2026-871A0804
 *   Proposta  PROP-2026-0C9837A8
 *   PO        PO-2026-AE256908
 *   OS        OS-2026-DC493F21
 *   Medicao   Medicao de OS-2026-DC493F21
 *   Nota      NF-2026-000008
 *   Recebivel derivado da NF-2026-000003 (cadeia com liquidacao).
 */

const WEB_URL = process.env.CISNE_JOURNEY_WEB_URL ?? 'http://127.0.0.1:5173';
const API_URL = process.env.CISNE_JOURNEY_API_URL ?? 'http://127.0.0.1:3000';
const LOGIN = process.env.CISNE_JOURNEY_LOGIN ?? 'abrahim@cisne-rondonia.invalid';

/**
 * SENHA VEM DO AMBIENTE — sem default silencioso.
 *
 * Estes arquivos carregavam a senha de homologacao em texto plano como fallback, o mesmo defeito
 * que o commit 6d65e3e removeu dos scripts de seed: o valor vaza em qualquer clone e o login de
 * teste passa a existir por acidente, em vez de por configuracao explicita.
 *
 * O padrao da casa ja esta definido: o valor vem do ambiente (`.env`, gitignored; os NOMES
 * documentados em `.env.example`) e a ausencia FALHA ALTO. Um teste que nao consegue autenticar
 * deve dizer por que, nao autenticar com uma credencial embutida no repositorio.
 */
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

const SHOTS = process.env.CISNE_JOURNEY_SHOTS ?? join(process.cwd(), 'test-results', 'business-chain');

/** Recebivel cuja linhagem termina em liquidacao (cadeia mais longa ate o dinheiro). */
const RECEIVABLE_ID = '5aef87a8-ca34-4259-82a7-e4e1b7bf6533';

/** Guarda contra regressao: identificador interno NUNCA pode aparecer como rotulo. */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
mkdirSync(SHOTS, { recursive: true });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

test.describe('cadeia empresarial — jornada real por clique', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get(`${API_URL}/api/v1/health`);
    expect(health.ok(), `API nao respondeu em ${API_URL}`).toBe(true);
    const web = await request.get(WEB_URL);
    expect(web.ok(), `Web nao respondeu em ${WEB_URL}`).toBe(true);
  });

  test('do recebivel ate a solicitacao: cada relacao abre o objeto real', async ({ page }) => {
    await login(page);

    // URL direta SO para iniciar a jornada — o contrato permite explicitamente.
    await page.goto(`/app/finance/receivables/${RECEIVABLE_ID}`);

    const lineage = page.getByRole('list', { name: 'Linhagem de negócio' });
    await expect(lineage).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: join(SHOTS, '01-recebivel-cadeia.png'), fullPage: true });

    const steps = lineage.getByRole('listitem');
    const count = await steps.count();
    expect(count, 'a cadeia real deve ter mais de um no').toBeGreaterThan(1);

    // INVARIANTE 1 — nenhum identificador interno aparece como rotulo na cadeia.
    const lineageText = (await lineage.innerText()).trim();
    expect(UUID_PATTERN.test(lineageText), `uuid exposto na cadeia:\n${lineageText}`).toBe(false);

    // INVARIANTE 2 — toda referencia humana persistida esta visivel.
    const references = await lineage.getByRole('link').allInnerTexts();
    expect(references).toContain('NF-2026-000003');
    expect(references).toContain('Cobrança da NF-2026-000003');
    expect(references.some((value) => value.startsWith('OS-2026-'))).toBe(true);
    expect(references.some((value) => value.startsWith('SR-2026-'))).toBe(true);
    expect(references.some((value) => value.startsWith('Medição de '))).toBe(true);

    // INVARIANTE 2b — cada referencia e UNICA: um clique abre UM item, nunca um conjunto ambiguo.
    expect(new Set(references).size).toBe(references.length);

    // INVARIANTE 3 — a cadeia preserva o passado: a nota CANCELADA continua no historico.
    const cancelled = steps.filter({ hasText: 'Cancelado' });
    expect(await cancelled.count(), 'a nota cancelada deve permanecer na cadeia').toBeGreaterThan(0);

    // INVARIANTE 4 — a liquidacao aparece e o recebivel vivo aparece como liquidado.
    await expect(lineage.getByText('Liquidação de NF-2026-000003')).toBeVisible();
    await expect(lineage.getByText('Liquidado', { exact: true })).toBeVisible();

    // CLIQUE 1 — a nota que originou o recebivel.
    await lineage.getByRole('link', { name: 'NF-2026-000003', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/service-orders\/[0-9a-f-]+\/billing\/document$/);
    await page.screenshot({ path: join(SHOTS, '02-nota-fatura-origem.png'), fullPage: true });

    // CLIQUE 2 — a medicao que originou o faturamento.
    await page.goBack();
    await expect(lineage).toBeVisible({ timeout: 30_000 });
    await lineage.getByRole('link', { name: /^Medição de OS-/ }).click();
    await expect(page).toHaveURL(/\/app\/service-orders\/[0-9a-f-]+\/measurement$/);
    await page.screenshot({ path: join(SHOTS, '03-medicao.png'), fullPage: true });

    // CLIQUE 3 — a ordem de servico executada.
    await page.goBack();
    await expect(lineage).toBeVisible({ timeout: 30_000 });
    await lineage.getByRole('link', { name: /^OS-2026-/ }).click();
    await expect(page).toHaveURL(/\/app\/service-orders\/[0-9a-f-]+\/planning$/);
    await page.screenshot({ path: join(SHOTS, '04-ordem-de-servico.png'), fullPage: true });

    // CLIQUE 4 — a solicitacao que abriu a historia.
    await page.goBack();
    await expect(lineage).toBeVisible({ timeout: 30_000 });
    await lineage.getByRole('link', { name: /^SR-2026-/ }).click();
    await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]+$/);
    await page.screenshot({ path: join(SHOTS, '05-solicitacao.png'), fullPage: true });

    // CLIQUE 5 — a raiz: o cliente.
    await page.goBack();
    await expect(lineage).toBeVisible({ timeout: 30_000 });
    await lineage.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/app\/clients\/[0-9a-f-]+$/);
    await page.screenshot({ path: join(SHOTS, '06-cliente-raiz.png'), fullPage: true });
  });

  test('do comercial ao faturamento: proposta e pedido do cliente na cadeia', async ({ page }) => {
    await login(page);

    // Cadeia mais longa com origem COMERCIAL: solicitacao -> proposta -> PO -> OS -> medicao -> nota.
    await page.goto('/app/service-orders/688a4838-1055-49ce-83d7-10dcd0bbd5bd/planning');

    const lineage = page.getByRole('list', { name: 'Linhagem de negócio' });
    await expect(lineage).toBeVisible({ timeout: 30_000 });

    const references = await lineage.getByRole('link').allInnerTexts();
    expect(references).toEqual([
      'TESTE-OBRA-COMPOSTO-FULL',
      'SR-2026-871A0804',
      'PROP-2026-0C9837A8',
      'PO-2026-AE256908',
      'OS-2026-DC493F21',
      'Medição de OS-2026-DC493F21',
      'NF-2026-000008',
    ]);

    // INVARIANTE — nenhum identificador interno como rotulo.
    expect(UUID_PATTERN.test(references.join(' | '))).toBe(false);

    // INVARIANTE — cada referencia humana e UNICA na cadeia: um clique abre UM item.
    expect(new Set(references).size).toBe(references.length);

    // Cadeia parcial REAL: sem recebivel nesta operacao, o no simplesmente nao existe —
    // nao ha placeholder, nem contagem oculta, nem aviso de dominio ausente.
    await expect(lineage.getByText(/Recebível/)).toHaveCount(0);
    await expect(lineage.getByText(/ocult|sem permissão para ver/i)).toHaveCount(0);

    await page.screenshot({ path: join(SHOTS, '07-comercial-ao-faturamento.png'), fullPage: true });

    // CLIQUE — a proposta comercial, a partir da cadeia da propria OS.
    await lineage.getByRole('link', { name: 'PROP-2026-0C9837A8' }).click();
    await expect(page).toHaveURL(/\/app\/proposals\/[0-9a-f-]+$/);
    await page.screenshot({ path: join(SHOTS, '08-proposta.png'), fullPage: true });
  });
});

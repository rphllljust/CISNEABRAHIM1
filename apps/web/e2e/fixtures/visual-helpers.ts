import { expect, type Page } from '@playwright/test';
import { installApiMocks, type ApiMockProfile } from './api-routes';

const TEST_LOGIN = 'visual.user';
const TEST_PASSWORD = 'Password1!';

export async function prepareAuthenticatedSession(
  page: Page,
  profile: ApiMockProfile = 'dashboard',
): Promise<void> {
  await installApiMocks(page, profile);
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(TEST_LOGIN);
  await page.getByLabel(/^senha/i).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: /^entrar/i }).click();
  /*
   * ÂNCORA DE SESSÃO — o `<h1>` REAL da tela de destino.
   *
   * Este helper esperava `heading level 1 /visão geral/i`. "Visão geral" é o rótulo da REGIÃO
   * na barra lateral (um `<p>` dentro de `region "Visão geral"`), nunca o título da página. O
   * `<h1>` do dashboard é "Central de operações".
   *
   * O efeito era o helper nunca confirmar a sessão: todas as suítes visuais que dependem dele
   * (dashboard, contabilidade, clientes, faturamento, relatórios, alertas) falhavam no MESMO
   * ponto, com `element(s) not found` — inclusive em viewport mobile, onde nada disso muda.
   *
   * A âncora agora é o título que a página realmente publica. Nenhum snapshot foi tocado:
   * a correção é do fixture, não da expectativa visual.
   */
  await expect(
    page.getByRole('heading', { level: 1, name: /central de operações/i }),
  ).toBeVisible();
}

export async function stabilizePage(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  /*
   * ÂNCORA DE MONTAGEM DO SHELL — esperar o SINAL, não um relógio.
   *
   * MEDIDO: depois que a bancada passou a esticar até a dobra (`items-stretch` no grid do
   * workspace), a primeira pintura faz mais trabalho de layout e o shell ainda publicava
   * "Carregando navegação…" quando os specs mediam ou clicavam. O sintoma variava por spec:
   * `main#main-content` ausente, `<h1>` ausente, clique sem alvo — sempre a MESMA causa.
   *
   * A espera por `fontes` + `load` não cobria essa janela. Esta espera é por um estado
   * OBSERVÁVEL do produto (a navegação terminou) e pela existência do `<main>`; nenhuma
   * asserção de teste foi afrouxada, porque este helper não asserta contrato — só sincroniza.
   */
  await expect(page.getByText('Carregando navegação…')).toHaveCount(0);
  await expect(page.locator('main#main-content')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

export const DASHBOARD_SCREENSHOT_MASKS = ['.dashboard-page__meta time', '.dashboard-page__refresh'];

export const BILLING_READY_SELECTOR = '[aria-label="Fila de faturamento"]';

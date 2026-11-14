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
  /*
   * A NAVEGAÇÃO PRECISA TER CONCLUÍDO ANTES DE SE EXIGIR O TÍTULO DA PÁGINA.
   *
   * MEDIDO: entre o commit que fecha o login e o commit que revela a navegação, o shell publica
   * "Carregando navegação…" e a árvore da rota ainda não está montada. Asserir o `<h1>` nesse
   * intervalo produz `element(s) not found` de forma intermitente — medido em `dashboard.visual`,
   * `documents.visual` e `dashboard-fold`, sem defeito algum na tela.
   *
   * Esta é a espera por um estado OBSERVÁVEL do produto. Nenhuma expectativa foi afrouxada.
   */
  await expect(page.getByText('Carregando navegação…')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { level: 1, name: /central de operações/i }),
  ).toBeVisible();
}

export async function stabilizePage(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  /*
   * ÂNCORA DE MONTAGEM DO SHELL — apenas a NAVEGAÇÃO, nunca um elemento exclusivo de uma rota.
   *
   * MEDIDO: `waitForLoadState('load')` + `document.fonts.ready` não cobrem o intervalo em que o
   * shell ainda publica "Carregando navegação…" e a árvore da página ainda não foi montada. Os
   * sintomas variavam por spec — `<h1>` "Central de operações" ausente, `main#main-content`
   * ausente, clique sem alvo — sempre com a mesma causa: a asserção rodava antes do commit do
   * React que revela a navegação.
   *
   * A espera é por um estado OBSERVÁVEL e COMUM a todas as telas: a barra lateral terminou de
   * carregar. NÃO se exige `main#main-content` aqui — a tela de LOGIN não possui `<main>`, e uma
   * tentativa anterior que impunha esse elemento globalmente reprovou login e routes-geometry.
   *
   * Este helper não asserta contrato: apenas sincroniza. Nenhuma expectativa de teste foi
   * afrouxada por ele.
   */
  await expect(page.getByText('Carregando navegação…')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

export const DASHBOARD_SCREENSHOT_MASKS = ['.dashboard-page__meta time', '.dashboard-page__refresh'];

export const BILLING_READY_SELECTOR = '[aria-label="Fila de faturamento"]';

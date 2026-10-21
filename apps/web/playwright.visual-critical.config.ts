import { defineConfig } from '@playwright/test';

const previewPort = 4173;

/**
 * VISUAL-CRITICAL — o subconjunto CURTO, DETERMINÍSTICO e OBRIGATÓRIO do visual regression.
 *
 * ---------------------------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------------------------------------------------------------------------
 *
 * A suíte visual completa (`playwright.config.ts`) roda 24 specs em 3 viewports (mobile, tablet,
 * desktop) = até 72 comparações de screenshot. No CI ela levou 15m47s — e virou o caminho
 * crítico do pipeline depois que o build caiu para ~56s.
 *
 * O problema de arquitetura não era a suíte ser lenta: era ela ser OBRIGATÓRIA por inteiro. Um
 * ajuste de densidade numa tela de Contabilidade não deveria bloquear a promoção de uma correção
 * de backend por 16 minutos.
 *
 * DIVISÃO (sem reduzir cobertura total)
 *
 *   visual-critical (este arquivo) — as superfícies que, se quebrarem, quebram o PRODUTO:
 *       - login (porta de entrada), dashboard (primeira dobra), shell/rotas.
 *     Um viewport por spec (`desktop`): o objetivo é detectar QUEBRA ESTRUTURAL, não regressão
 *     de pixel em três larguras. Roda em minutos, é determinístico e obrigatório.
 *
 *   visual-full (playwright.config.ts, inalterado) — a cobertura COMPLETA: todas as specs, todos
 *     os viewports, todos os snapshots. Continua rodando, continua obrigatória no `release-full`,
 *     mas fora do caminho crítico do release normal.
 *
 * NENHUM SNAPSHOT É REMOVIDO E NENHUM `maxDiffPixelRatio` É AFROUXADO. O que muda é QUANDO cada
 * camada bloqueia: quebra estrutural bloqueia sempre; regressão de pixel em viewport secundário
 * bloqueia o `visual-full`, que continua sendo um gate.
 */
export default defineConfig({
  testDir: './e2e/visual',
  snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: [['list']],
  expect: {
    // MESMO limiar da suíte completa. Não afrouxar é o ponto: o critical não pode ser mais
    // permissivo que o full, senão vira teatro.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    browserName: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Porto_Velho',
    trace: 'on-first-retry',
    colorScheme: 'light',
  },
  /*
   * UM viewport apenas (desktop, 1280x720).
   *
   * O critical responde "a tela ainda existe, na estrutura esperada?". Viewport secundário
   * responde "o pixel bate em 390px?" — pergunta legítima, mas pertence ao `visual-full`. Rodar
   * três viewports aqui reintroduziria o custo que esta divisão existe para remover.
   *
   * Os snapshots `desktop` deste config ficam em `*-desktop.png`, os MESMOS que a suíte completa
   * já usa: nenhum snapshot novo é gerado e nenhum existente é descartado.
   */
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: {
    command: 'corepack pnpm run build && corepack pnpm run preview:visual',
    url: `http://127.0.0.1:${previewPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

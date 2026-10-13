import { defineConfig } from '@playwright/test';

/**
 * PROVA DE RENDERIZACAO DE `/app` — config dedicada.
 *
 * O `playwright.config.ts` da raiz constroi o bundle (`build && preview`) e testa tres viewports com
 * snapshots versionados. Aqui o objetivo e outro: RENDERIZAR a rota contra um dev server ja em
 * execucao e MEDIR a geometria em 1728x900. Sem `webServer` (o servidor e provido por quem roda),
 * sem snapshot — a prova e o numero medido e o screenshot capturado.
 *
 * Rodar:
 *   pnpm --filter @cisne/web exec playwright test --config e2e/proof/playwright.proof.config.ts
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results-proof',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:5199',
    browserName: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Porto_Velho',
    colorScheme: 'light',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});

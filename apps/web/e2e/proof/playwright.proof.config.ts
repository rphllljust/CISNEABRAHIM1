import { defineConfig } from '@playwright/test';

/**
 * PROVA DE RENDERIZACAO — config dedicada, sem `webServer`.
 *
 * O servidor e provido por quem roda (build + `preview:visual` na 4173, ou um dev server na 5199).
 * A prova e o NUMERO MEDIDO e o screenshot capturado — nao um snapshot versionado.
 *
 * Rodar:
 *   pnpm --filter @cisne/web run build && pnpm --filter @cisne/web run preview:visual
 *   pnpm --filter @cisne/web exec playwright test --config e2e/proof/playwright.proof.config.ts
 */
const port = process.env.PROOF_PORT ?? '4173';

export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results-proof',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Porto_Velho',
    colorScheme: 'light',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});

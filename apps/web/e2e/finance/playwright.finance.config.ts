import { defineConfig } from '@playwright/test';

/**
 * JANELA DAS TELAS FINANCE MIGRADAS PARA A ENGINE.
 *
 * Roda contra a APLICAÇÃO REAL: API + PostgreSQL + autorização. Nenhum `page.route`, nenhum
 * `fulfill`, nenhum `webServer` — os servidores reais precisam estar no ar, porque o que esta
 * jornada prova é que o METADADO dirige a tela.
 *
 * Rodar:
 *   pnpm --filter @cisne/web exec playwright test --config e2e/finance/playwright.finance.config.ts
 */
export default defineConfig({
  testDir: '.',
  // Saída FORA do testDir: com `testDir: '.'` o Playwright limparia o próprio diretório de testes.
  outputDir: '../../test-results-finance',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env['CISNE_JOURNEY_WEB_URL'] ?? 'http://127.0.0.1:5173',
    browserName: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Porto_Velho',
    colorScheme: 'light',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
});

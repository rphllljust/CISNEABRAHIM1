import { defineConfig } from '@playwright/test';

/**
 * CISNE — BROWSER BUSINESS JOURNEY (cadeia empresarial).
 *
 * Diferente da suite visual (`playwright.config.ts`), esta jornada roda contra a APLICACAO
 * REAL: API + banco local, dados reais, autorizacao real. Ela nao usa mock nenhum.
 *
 * Pre-requisitos (validados pelo proprio teste, que falha explicitamente se faltarem):
 *   - API em CISNE_JOURNEY_API_URL (padrao http://127.0.0.1:3000)
 *   - Web em CISNE_JOURNEY_WEB_URL (padrao http://127.0.0.1:5173)
 *
 * A jornada NAO eh uma suite de regressao de CI: ela prova, com dado real, que a cadeia
 * empresarial e navegavel por clique ponta a ponta.
 */
export default defineConfig({
  testDir: './',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    baseURL: process.env.CISNE_JOURNEY_WEB_URL ?? 'http://127.0.0.1:5173',
    browserName: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Porto_Velho',
    colorScheme: 'light',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
});

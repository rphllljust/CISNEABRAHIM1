import { defineConfig } from '@playwright/test';

/**
 * Config da prova de browser do catalogo: roda contra a APLICACAO REAL ja em execucao
 * (web de dev em 5173 + API em 3000), sem build de preview e sem mocks.
 */
export default defineConfig({
  testDir: './e2e/catalog',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    baseURL: process.env.CISNE_JOURNEY_WEB_URL ?? 'http://127.0.0.1:5173',
    browserName: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Porto_Velho',
    colorScheme: 'light',
    trace: 'off',
  },
});

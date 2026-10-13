import { defineConfig } from '@playwright/test';

/**
 * PROVA DE PRODUÇÃO — `@cisne/web` publicado, sem mock e sem dev server.
 *
 * Diferente de `e2e/proof` (dev server + API mockada, para medir geometria de forma determinística),
 * aqui o alvo é a URL REAL. Não há `webServer`: quem serve é o Railway.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results-prod',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 180_000,
  use: {
    browserName: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Porto_Velho',
    colorScheme: 'light',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});

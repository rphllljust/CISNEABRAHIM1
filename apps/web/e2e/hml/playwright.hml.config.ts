import { defineConfig } from '@playwright/test';

/**
 * Prova de HML REAL — sem `webServer`, sem fixture, sem mock.
 *
 * O alvo é o artefato servido pelo container `cisne_hml_web` e as APIs reais do `cisne_hml_api`.
 * Rodar apenas:
 *   pnpm --filter @cisne/web exec playwright test --config e2e/hml/playwright.hml.config.ts
 *
 * Credenciais vêm do ambiente (as mesmas de `.env.hml`); nenhuma é versionada aqui.
 */
export default defineConfig({
  testDir: '.',
  /**
   * DIRETÓRIO DE SAÍDA FORA DO testDir.
   *
   * Com `testDir: '.'` o Playwright usaria `e2e/hml` como diretório de resultados e LIMPARIA o
   * próprio diretório de testes a cada execução (o spec era apagado). A saída vai para um
   * caminho próprio, que não interfere nas suítes visuais.
   */
  outputDir: '../../test-results-hml',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    browserName: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Porto_Velho',
    colorScheme: 'light',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});

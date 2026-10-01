import { defineConfig } from '@playwright/test';

/**
 * CISNE — CONSUMO REAL DOS ENDPOINTS META (sessão B5).
 *
 * Diferente de `playwright.config.ts` (suite visual, que usa `page.route` com fixtures),
 * esta jornada roda contra a APLICAÇÃO REAL: API + PostgreSQL + autorização. Nenhum mock.
 *
 * Pré-requisitos (o próprio teste falha explicitamente se faltarem):
 *   - API em CISNE_JOURNEY_API_URL (padrão http://127.0.0.1:3000)
 *   - Web em CISNE_JOURNEY_WEB_URL (padrão http://127.0.0.1:5173)
 *   - CISNE_JOURNEY_PASSWORD no ambiente
 *
 * Rodar apenas:
 *   pnpm --filter @cisne/web exec playwright test --config e2e/meta/playwright.meta.config.ts
 *
 * Sem `webServer`: os servidores reais precisam estar no ar. Subir um `vite preview` aqui
 * apontaria para um bundle estático servindo a API de produção, não a API local — o oposto
 * do que esta jornada precisa provar.
 */
export default defineConfig({
  testDir: '.',
  // Saída FORA do testDir: com `testDir: '.'` o Playwright limparia o próprio diretório de
  // testes a cada execução (o mesmo defeito já documentado em `e2e/hml`).
  outputDir: '../../test-results-meta',
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

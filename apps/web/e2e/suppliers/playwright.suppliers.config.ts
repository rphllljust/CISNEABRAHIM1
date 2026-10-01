import { defineConfig } from '@playwright/test';

/**
 * CISNE — JORNADA REAL DE FORNECEDOR (Fase B).
 *
 * Diferente de `playwright.config.ts` (suíte visual, com fixtures), esta jornada roda contra
 * a APLICAÇÃO REAL: API + PostgreSQL + autorização. Nenhum `page.route`, nenhum `fulfill`.
 *
 * Pré-requisitos (o próprio teste falha explicitamente se faltarem):
 *   - API em CISNE_JOURNEY_API_URL (padrão http://127.0.0.1:3000)
 *   - Web em CISNE_JOURNEY_WEB_URL (padrão http://127.0.0.1:5173)
 *   - CISNE_JOURNEY_PASSWORD no ambiente
 *
 * Rodar apenas:
 *   pnpm --filter @cisne/web exec playwright test --config e2e/suppliers/playwright.suppliers.config.ts
 *
 * Sem `webServer`: os servidores reais precisam estar no ar. Subir um `vite preview` aqui
 * apontaria para bundle estático falando com a API de produção — o oposto do que a jornada
 * precisa provar.
 */
export default defineConfig({
  testDir: '.',
  // Saída FORA do testDir: com `testDir: '.'` o Playwright limparia o próprio diretório de
  // testes a cada execução (defeito já documentado em `e2e/hml` e `e2e/meta`).
  outputDir: '../../test-results-suppliers',
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

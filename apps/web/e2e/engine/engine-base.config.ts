import type { PlaywrightTestConfig } from '@playwright/test';

/**
 * BASE COMPARTILHADA DAS JANELAS DE ENGINE.
 *
 * A suíte de engine tem 51 testes e uma janela única não a comporta dentro de um timeout
 * curto: uma rodada truncou em 26/51 e outra em 34/51. Teste NÃO EXECUTADO é indistinguível
 * de "passou" quando só se lê o total, então a suíte foi partida em três janelas pequenas,
 * cada uma completa e verificável, compartilhando exatamente esta configuração.
 *
 * Diferente de `playwright.config.ts` (suíte visual, com fixtures), estas jornadas rodam
 * contra a APLICAÇÃO REAL: API + PostgreSQL + autorização. Nenhum `page.route`, nenhum
 * `fulfill`.
 *
 * Pré-requisitos (a jornada falha explicitamente se faltarem):
 *   - API em CISNE_JOURNEY_API_URL (padrão http://127.0.0.1:3000)
 *   - Web em CISNE_JOURNEY_WEB_URL (padrão http://127.0.0.1:5173)
 *   - CISNE_JOURNEY_LOGIN e CISNE_JOURNEY_PASSWORD no ambiente
 *
 * Sem `webServer`: os servidores reais precisam estar no ar. Subir um `vite preview` aqui
 * apontaria para bundle estático falando com a API de produção — o oposto do que a jornada
 * precisa provar.
 */
export const engineBaseConfig: PlaywrightTestConfig = {
  testDir: '.',
  // Saída FORA do testDir: com `testDir: '.'` o Playwright limparia o próprio diretório de
  // testes a cada execução (defeito já documentado em `e2e/hml` e `e2e/meta`).
  outputDir: '../../test-results-engine',
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
};

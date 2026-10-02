import { defineConfig } from '@playwright/test';

/**
 * CONFIG DA JORNADA DE I18N.
 *
 * Mesma regra das jornadas de engine/ERP desta wave: roda contra a APLICAÇÃO REAL (API +
 * PostgreSQL + autorização), sem `page.route`, sem `fulfill` e sem `sleep`. O que esta
 * jornada prova é que TROCAR O IDIOMA muda o DOM renderizado — e um mock de rede não
 * provaria isso, porque o texto vem do bundle e do metadata store, não de uma resposta
 * forjada.
 *
 * Sem `webServer`: os servidores reais precisam estar no ar, porque um `vite preview`
 * serviria um bundle construído de outro checkout.
 *
 * Pré-requisitos (o próprio teste falha explicitamente se faltarem):
 *   - Web em CISNE_JOURNEY_WEB_URL (padrão http://127.0.0.1:5173)
 *   - API em CISNE_JOURNEY_API_URL (padrão http://127.0.0.1:3000)
 *   - CISNE_JOURNEY_LOGIN e CISNE_JOURNEY_PASSWORD no ambiente
 *
 * Rodar apenas:
 *   pnpm --filter @cisne/web exec playwright test --config e2e/i18n/playwright.i18n.config.ts
 */
export default defineConfig({
  testDir: '.',
  // Saída FORA do testDir: com `testDir: '.'` o Playwright limparia o próprio diretório de
  // testes a cada execução (defeito já documentado em `e2e/hml` e `e2e/meta`).
  outputDir: '../../test-results-i18n',
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
    /*
     * O idioma do NAVEGADOR é fixado em pt-BR de propósito.
     *
     * A resolução inicial do app é preferência salva → idioma do navegador → padrão. Fixar
     * pt-BR elimina a única variável fora do controle do teste: se o projeto pedisse en-US
     * e o app abrisse em inglês, a prova de que "o seletor troca o idioma" ficaria ambígua
     * com "o app já abriu em inglês".
     */
    locale: 'pt-BR',
    timezoneId: 'America/Porto_Velho',
    colorScheme: 'light',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
});

import { defineConfig } from '@playwright/test';

/**
 * BIG WAVE 07 — smoke do BUILD DE PRODUCAO.
 *
 * Sobe os artefatos ja construidos (web `vite preview` em 4173, API `NODE_ENV=production`
 * em 3000) — o `webServer` NAO builda nada aqui, para que o alvo seja exatamente o que
 * saiu do pipeline de release.
 */
export default defineConfig({
  testDir: './e2e/w07',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 180_000,
  use: {
    baseURL: process.env.CISNE_W07_WEB_URL ?? 'http://127.0.0.1:4173',
    browserName: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Porto_Velho',
    colorScheme: 'light',
    trace: 'off',
  },
});

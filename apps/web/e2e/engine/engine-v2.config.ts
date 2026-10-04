import { defineConfig } from '@playwright/test';
import { engineBaseConfig } from './engine-base.config';

/**
 * JANELA V2 — AS CAPACIDADES DA ENGINE V4.
 *
 * Cobre o que a Track 1 entregou: calendário dirigido por metadado, abas de `meta.views`, a
 * bancada das views que o CHECK do banco ainda não permite declarar, e o explorador de
 * metadados com o construtor de formulário.
 *
 * Rodar:
 *   pnpm --filter @cisne/web exec playwright test --config e2e/engine/engine-v2.config.ts
 */
export default defineConfig({
  ...engineBaseConfig,
  outputDir: '../../test-results-engine-v2',
  testMatch: /(calendar-view|view-switcher|v4-layout-views|metadata-explorer)\.journey\.spec\.ts/,
});

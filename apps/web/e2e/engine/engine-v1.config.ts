import { defineConfig } from '@playwright/test';
import { engineBaseConfig } from './engine-base.config';

/**
 * JANELA V1 — AS 4 CAPACIDADES DE SCHEMA DO METADATA V2.
 *
 * Cobre o que é declarado em `meta.fields`/`meta.views` e lido pela engine: agregação de
 * coluna, campo computado, campo condicional e cor de linha por regra.
 *
 * Rodar:
 *   pnpm --filter @cisne/web exec playwright test --config e2e/engine/engine-v1.config.ts
 */
export default defineConfig({
  ...engineBaseConfig,
  outputDir: '../../test-results-engine-v1',
  testMatch: /(aggregations|computed-fields|conditional-fields|row-accents)\.journey\.spec\.ts/,
});

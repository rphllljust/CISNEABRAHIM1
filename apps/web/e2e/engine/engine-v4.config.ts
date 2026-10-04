import { defineConfig } from '@playwright/test';
import { engineBaseConfig } from './engine-base.config';

/**
 * JANELA V4 — GENERICIDADE DA ENGINE SOBRE DUAS ENTIDADES.
 *
 * Cobre as jornadas que provam que a engine é GENÉRICA e não `suppliers`-specific: as mesmas
 * três mutações (campo novo, transição nova, ordem nova) aplicadas a `service-orders` e a
 * `suppliers`, com workflow e views diferentes.
 *
 * O nome da janela é V4 por ser a suíte de referência da engine de ERP; não confundir com as
 * capacidades "V4" da Track 1, que vivem na janela `engine-v2.config.ts`.
 *
 * Rodar:
 *   pnpm --filter @cisne/web exec playwright test --config e2e/engine/engine-v4.config.ts
 */
export default defineConfig({
  ...engineBaseConfig,
  outputDir: '../../test-results-engine-v4',
  testMatch: /(service-orders-engine|suppliers-engine)\.journey\.spec\.ts/,
});

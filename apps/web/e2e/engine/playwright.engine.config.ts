import { defineConfig } from '@playwright/test';
import { engineBaseConfig } from './engine-base.config';

/**
 * SUÍTE COMPLETA DE ENGINE — as três janelas de uma vez.
 *
 * A suíte tem 51 testes e NÃO cabe numa janela de execução com timeout curto: uma rodada
 * truncou em 26/51 e outra em 34/51, e teste não executado é indistinguível de "passou".
 * Para rodar tudo, prefira as três janelas — cada uma completa e verificável:
 *
 *   engine-v1.config.ts  capacidades de schema do metadata v2
 *   engine-v2.config.ts  capacidades da engine v4 (Track 1)
 *   engine-v4.config.ts  genericidade sobre service-orders e suppliers
 *
 * Este arquivo continua existindo para descoberta (`--list`) e para quem tiver janela longa.
 */
export default defineConfig({
  ...engineBaseConfig,
  outputDir: '../../test-results-engine',
});

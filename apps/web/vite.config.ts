/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite derives import.meta.env.DEV/PROD from process.env.NODE_ENV rather than
 * from --mode. When `vite build` runs without NODE_ENV=production (CI, Docker
 * builder stage, plain `pnpm build`) the bundle would embed DEV=true/PROD=false
 * development-flavor React — bloated and with dev-only behavior. This plugin
 * pins NODE_ENV=production for every production-mode build.
 */
function forceProductionNodeEnv(): Plugin {
  return {
    name: 'cisne:force-production-node-env',
    config(_userConfig, env) {
      if (env.mode === 'production' && process.env['NODE_ENV'] !== 'production') {
        process.env['NODE_ENV'] = 'production';
      }
      return {};
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), forceProductionNodeEnv()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    fileParallelism: false,
    env: {
      VITE_FEATURE_MODULE_REPORTS: 'true',
      VITE_FEATURE_MODULE_OPERATIONAL_PROFITABILITY: 'true',
      /**
       * CONTRATOS entram no gate de release como os demais modulos construidos.
       *
       * Ate esta correcao `/app/contracts` estava declarado como modulo na navegacao
       * (`featureFlag: contracts`) mas AUSENTE de `GATED_WEB_PATH_PREFIXES`: com a flag
       * desligada o item sumia do menu e a URL direta continuava abrindo o produto. Agora o
       * web concorda com a API, que ja gateia `commercial/contracts`.
       *
       * Como o ambiente de teste nao declara as flags de HML, a rota de contratos passaria a
       * redirecionar para `/app/no-access` e o fluxo inteiro de contratos viraria um falso
       * negativo. Declarar a flag aqui mantem o modulo LIGADO no teste — que e o recorte que
       * as suites de contratos exercitam — sem afrouxar o gate em runtime.
       */
      VITE_FEATURE_MODULE_CONTRACTS: 'true',
    },
  },
});

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

config({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    // Serializa o acesso ao TEST_DATABASE_URL compartilhado entre PROCESSOS (advisory lock),
    // igual ao @cisne/api. Sem isto, specs que truncam tabelas compartilhadas colidem com
    // qualquer outro runner na mesma base e o gate falha com "deadlock detected".
    setupFiles: ['./src/test-builders/integration-test-db-serializer.ts'],
  },
});

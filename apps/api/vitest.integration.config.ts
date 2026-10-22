import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { loadVitestEnv } from './src/test/load-vitest-env';

loadVitestEnv();

/**
 * CONFIG DE INTEGRACAO — SHARD-AWARE, SEM PERDER A GARANTIA DE ISOLAMENTO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ERA O GARGALO (medido, nao estimado)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 114 arquivos `*.integration.spec.ts`, 38.727 linhas, executados com:
 *
 *     maxWorkers: 1
 *     fileParallelism: false
 *     sequence.concurrent: false
 *
 * Fila unica. O passo `Integration tests` do run 39719203623 comecou em 03:52:58Z e seguia
 * `in_progress` ~11 min depois, contra `timeout-minutes: 30` do job.
 *
 * POR QUE ESTAVA SERIAL, E POR QUE ISSO NAO PODE SER REVERTIDO POR ATACADO
 *
 * `integration-test-db-serializer.ts` adquire `pg_advisory_lock(INTEGRATION_TEST_DB_LOCK_KEY)`
 * antes de CADA arquivo. Todos os 114 compartilham UM database (`cisne_ci_integration`).
 * Advisory locks no Postgres sao escopados POR DATABASE: liberar `maxWorkers` contra o MESMO
 * database nao paraleliza nada — apenas move a serializacao do Vitest para o Postgres, onde ela
 * aparece como espera de lock, que e pior de diagnosticar. Foi exatamente esse raciocinio que o
 * `ci.yml` ja aplicou ao separar `database-and-integration` de `api-e2e`.
 *
 * A CORRECAO: ISOLAMENTO POR DATABASE, NAO REMOCAO DO LOCK
 *
 * Cada shard roda contra um database PROPRIO (`cisne_ci_integration_s1`, `_s2`, ...). Como o
 * lock e por database, dois shards em databases diferentes pegam locks diferentes mesmo com a
 * MESMA chave `0x43534e45` — a exclusividade do database torna o lock global inofensivo por
 * construcao. Nenhuma linha de `integration-test-db-lock.ts` muda, e o lock continua protegendo
 * o que deve proteger: acesso concorrente ao MESMO database dentro do proprio shard.
 *
 * `maxWorkers: 1` e `fileParallelism: false` PERMANECEM. Dentro de um shard o database e unico,
 * logo os arquivos continuam serializados — de proposito. O ganho vem do PARALELISMO ENTRE
 * shards, nao de concorrencia dentro de um database compartilhado.
 *
 * COMPATIBILIDADE
 *
 * Sem `INTEGRATION_SHARD`, nada muda: ambiente local continua com fila unica contra um database.
 * O comportamento anterior e preservado byte a byte quando a variavel nao existe.
 */
const shard = process.env['INTEGRATION_SHARD']?.trim() || undefined;

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    pool: 'forks',
    // DENTRO DO SHARD: continua serial. O database do shard e unico; paralelizar aqui so
    // empilharia espera de advisory lock.
    maxWorkers: 1,
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 180_000,
    testTimeout: 300_000,
    globalSetup: ['./src/test/ensure-migrations.ts'],
    setupFiles: ['./src/test/integration-test-db-serializer.ts'],
    // ENTRE SHARDS: o Vitest distribui os arquivos por hash estavel do caminho. Dois shards
    // (`1/4` e `2/4`) recebem particoes DISJUNTAS — nenhum arquivo roda duas vezes, nenhum
    // arquivo deixa de rodar. A cobertura total e identica a da fila unica.
    ...(shard ? { shard } : {}),
  },
});

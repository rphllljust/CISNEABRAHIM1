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
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * REGRESSAO DE THROUGHPUT — CAUSA RAIZ (medida no run 39777460790)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * SINTOMA: `Integration (3/4)` levou 13m14s, MAIS que os 11m21s que a suite INTEIRA (114
 * arquivos) levava em fila unica. Cada shard deveria rodar ~29 arquivos, nao 114.
 *
 * CAUSA: `test.shard` NAO aceita a string `'I/N'`. O sequenciador do Vitest faz
 *
 *     const { index, count } = config.shard;            // coverage.DfSpMS-b.js:3458
 *     const shardSize  = Math.ceil(files.length / count);
 *     const shardStart = shardSize * (index - 1);
 *     const shardEnd   = shardSize * index;
 *     files...slice(shardStart, shardEnd)
 *
 * Com `config.shard = '1/4'` (string), `index` e `count` sao `undefined`:
 *
 *     shardSize  = Math.ceil(114 / undefined) = NaN
 *     slice(NaN, NaN) -> 0 entradas -> o Vitest NAO filtra nada
 *
 * Resultado: CADA um dos 4 shards executava os 114 arquivos. Quatro runners fazendo 4x o
 * trabalho, com `maxWorkers: 1`, sem nenhum paralelismo util — e o shard ficou mais lento que a
 * suite inteira porque ainda pagava o proprio setup.
 *
 * `--shard=I/N` pela CLI funciona porque a CLI CONVERTE para `{ index, count }` antes de chegar
 * aqui. Ao configurar `test.shard` no arquivo, a conversao precisa ser feita por nos.
 *
 * CORRECAO: converter a forma `I/N` para `{ index, count }` num numeros. Nenhum shard a mais, a
 * menos, nenhuma cobertura alterada: o Vitest volta a particionar 29/29/29/27.
 */
function parseShard(raw: string | undefined): { index: number; count: number } | undefined {
  if (!raw) {
    return undefined;
  }
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw);
  if (!match) {
    // Falha FECHADA: um shard malformado nao pode virar "roda tudo silenciosamente", que foi
    // exatamente o defeito acima. Melhor quebrar o job do que mascarar 4x a cobertura.
    throw new Error(
      `INTEGRATION_SHARD must use the form "<index>/<count>", received "${raw}". ` +
        'No valid shard would silently fall back to running the entire suite.',
    );
  }
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 1 || index > count) {
    throw new Error(
      `INTEGRATION_SHARD out of range: "${raw}". Expected 1 <= index <= count, both integers.`,
    );
  }
  return { index, count };
}

const shard = parseShard(process.env['INTEGRATION_SHARD']?.trim() || undefined);

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
    // ENTRE SHARDS: particao disjunta calculada pelo proprio Vitest a partir de `{ index, count }`.
    ...(shard ? { shard } : {}),
  },
});

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
 * `test.shard` — O CONTRATO REAL DO VITEST (lido do codigo-fonte, 3.2.7)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Eu errei duas vezes aqui antes de ler a fonte. Registro o fato para ninguem repetir:
 *
 *   `resolveConfig` (coverage.DfSpMS-b.js:3568) faz:
 *
 *       if (options.shard) {
 *         const [indexString, countString] = options.shard.split('/');   // <- STRING
 *         ...
 *         resolved.shard = { index, count };                              // <- converte
 *       }
 *
 * Ou seja: na CONFIG, `shard` e uma STRING `'I/N'`, e o proprio Vitest a converte para
 * `{ index, count }` antes de usa-la. Passar `{ index, count }` na config NAO e aceito:
 *
 *       TypeError: options.shard.split is not a function or its return value is not iterable
 *
 * (reproduzido localmente neste repositorio ao tentar `{}` na config). O `{ index, count }` e o
 * formato INTERNO consumido pelo sequenciador (`BaseSequencer.shard`), nao o formato de entrada.
 *
 * O que EU NUNCA DEVO FAZER DE NOVO:
 *   - "corrigir" a forma da string para objeto achando que o sequenciador le a config direto;
 *   - manter validacao propria que transforme o valor, em vez de deixar o Vitest validar.
 *
 * O Vitest JA valida a forma e falha fechado: `count <= 0`, `index <= 0`, `index > count` e
 * entrada sem `/` lancam erro com mensagem propria. Reimplementar essa validacao aqui so
 * adiciona uma segunda fonte de verdade sobre a mesma regra — foi o que me levou ao erro.
 */
const shard = process.env['INTEGRATION_SHARD']?.trim() || undefined;

/**
 * INSTRUMENTACAO (FASE 1 do CI-FAST). Reporter ativado apenas quando o executor define o
 * arquivo de saida — em uso local nada muda e nenhum arquivo e criado.
 */
const timingsFile = process.env['INTEGRATION_TIMINGS_FILE']?.trim() || undefined;

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
    // O executor cria o banco a partir de um TEMPLATE ja migrado (FASE 4). Rodar o globalSetup
    // de migracao novamente sobre um clone aplicaria a cadeia inteira outra vez — custo puro,
    // ja que o template e a fonte de verdade do schema. `INTEGRATION_SCHEMA_PREPARED=1` sinaliza
    // exatamente essa condicao; sem ela (local, ou shard legado) o globalSetup roda como sempre.
    globalSetup:
      process.env['INTEGRATION_SCHEMA_PREPARED'] === '1' ? [] : ['./src/test/ensure-migrations.ts'],
    setupFiles: ['./src/test/integration-test-db-serializer.ts'],
    // STRING 'I/N' — o Vitest faz `options.shard.split('/')` e converte para { index, count }.
    ...(shard ? { shard } : {}),
    // O CAMINHO DO REPORTER PRECISA CHEGAR AO REPORTER.
    //
    // Antes: `reporters: ['default', './src/test/ci-timings-reporter.mjs']` — a variavel
    // `INTEGRATION_TIMINGS_FILE` decidia SE o reporter era ativado, mas seu VALOR nunca era
    // repassado. O reporter caia no default relativo e gravava em `apps/api/artifacts/ci/`
    // (cwd do Vitest), enquanto `integration-timings.mjs collect` procurava em
    // `<repo>/artifacts/ci/` e falhava com "no integration timing files found".
    //
    // Consequencia medida (run 39830834987): o collect falhava, nenhum historico era gravado, o
    // cache nao tinha o que salvar, e o LPT voltava ao SEED no run seguinte — silenciosamente,
    // porque o warning de telemetria era o unico sinal.
    //
    // O formato de tupla `[path, options]` e o que o Vitest usa para passar opcoes ao
    // construtor de um reporter customizado.
    ...(timingsFile
      ? { reporters: ['default', ['./src/test/ci-timings-reporter.mjs', { outputPath: timingsFile }]] }
      : {}),
  },
});

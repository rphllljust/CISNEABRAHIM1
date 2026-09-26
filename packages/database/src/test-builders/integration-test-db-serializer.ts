import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import {
  acquireAdvisoryLockWithTimeout,
  INTEGRATION_TEST_DB_LOCK_KEY,
  releaseIntegrationTestDatabaseLock,
} from './integration-test-db-lock';

/**
 * Serializa a suíte de integração do `@cisne/database` contra o banco de teste compartilhado.
 *
 * Problema comprovado: os specs deste pacote truncam tabelas compartilhadas
 * (`TRUNCATE ... RESTART IDENTITY CASCADE` = ACCESS EXCLUSIVE) e não havia NENHUMA serialização
 * entre processos. Quando outro runner toca o mesmo `TEST_DATABASE_URL` — a suíte do `@cisne/api`,
 * um seed/CLI ou um segundo Vitest execução concorrente — o PostgreSQL responde
 * `deadlock detected` (e, em cascata, violações de FK porque a escrita anterior foi desfeita),
 * fazendo o gate canônico `pnpm test:integration` falhar de forma NÃO determinística.
 *
 * O controle correto já existe neste pacote (`pg_advisory_lock` por processo, exportado por
 * `integration-test-db-lock.ts`) e já é aplicado pelo `@cisne/api` em
 * `apps/api/src/test/integration-test-db-serializer.ts`. Aqui ele é aplicado ao pacote que o
 * exporta, para que a serialização valha nos dois lados da mesma base — sem novo mecanismo,
 * sem banco por worker e sem afrouxar asserção alguma.
 *
 * O lock é adquirido uma vez por arquivo de spec (beforeAll/afterAll) e liberado no fim; com
 * `fileParallelism: false` os arquivos permanecem sequenciais dentro do processo.
 */
const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for integration database serialization.');
}

let serializerPool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
let serializerPoolEnded = false;
let serializerClient: PoolClient | undefined;
let lockHeld = false;

function getSerializerPool(): Pool {
  if (serializerPoolEnded) {
    serializerPool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
    serializerPoolEnded = false;
  }
  return serializerPool;
}

async function shutdownSerializer(): Promise<void> {
  if (serializerClient && lockHeld) {
    try {
      await releaseIntegrationTestDatabaseLock(serializerClient, INTEGRATION_TEST_DB_LOCK_KEY);
    } catch {
      // Conexão já pode ter sido terminada (ex.: pg_terminate_backend); o lock cai com a sessão.
      serializerClient.release(true);
      serializerClient = undefined;
    }
    lockHeld = false;
  }
  serializerClient?.release();
  serializerClient = undefined;
  if (!serializerPoolEnded) {
    serializerPoolEnded = true;
    await serializerPool.end();
  }
}

beforeAll(async () => {
  const pool = getSerializerPool();
  serializerClient = await pool.connect();
  try {
    await acquireAdvisoryLockWithTimeout(serializerClient, INTEGRATION_TEST_DB_LOCK_KEY, 180_000);
    lockHeld = true;
  } catch (error) {
    serializerClient.release(true);
    serializerClient = undefined;
    throw error;
  }
}, 180_000);

afterAll(async () => {
  await shutdownSerializer();
}, 180_000);

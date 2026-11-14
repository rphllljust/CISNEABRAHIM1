import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import {
  acquireAdvisoryLockWithTimeout,
  INTEGRATION_TEST_DB_LOCK_KEY,
  releaseIntegrationTestDatabaseLock,
} from '@cisne/database';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for integration/E2E database serialization.');
}

process.env['DATABASE_POOL_MAX'] ??= '1';
// Integration files share one Vitest worker. Auto-started pollers race
// explicit claimPending/publishBatch/processBatch and leak across files
// when TestingModule.init() is not paired with close(). Production default
// remains enabled unless these env vars are === 'false'.
process.env['OUTBOX_PUBLISHER_ENABLED'] = 'false';
process.env['INBOX_PROCESSOR_ENABLED'] = 'false';

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

function releaseSerializerClient(destroy = false): void {
  if (!serializerClient) {
    return;
  }
  try {
    if (destroy) {
      serializerClient.release(true);
    } else {
      serializerClient.release();
    }
  } catch {
    // Connection may already be terminated (e.g. pg_terminate_backend).
  }
  serializerClient = undefined;
}

async function releaseSerializerLock(): Promise<void> {
  if (!serializerClient || !lockHeld) {
    return;
  }
  let released = false;
  try {
    released = await releaseIntegrationTestDatabaseLock(serializerClient, INTEGRATION_TEST_DB_LOCK_KEY);
  } catch {
    // Connection may already be terminated (e.g. pg_terminate_backend).
  } finally {
    lockHeld = false;
  }
  if (!released) {
    releaseSerializerClient(true);
  }
}

async function shutdownSerializerPool(): Promise<void> {
  await releaseSerializerLock();
  releaseSerializerClient(true);
  if (serializerPoolEnded) {
    return;
  }
  serializerPoolEnded = true;
  await serializerPool.end();
}

async function ensureTestDefaultIssuer(client: PoolClient): Promise<void> {
  const legal = await client.query<{ id: string }>(
    `SELECT id FROM pty.legal_entities WHERE legal_name = 'CISNE TEST ISSUER' LIMIT 1`,
  );
  let legalEntityId = legal.rows[0]?.id;
  if (!legalEntityId) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pty.legal_entities (legal_name, trade_name)
       VALUES ('CISNE TEST ISSUER', 'CISNE TEST')
       RETURNING id`,
    );
    legalEntityId = inserted.rows[0]!.id;
  }

  const establishment = await client.query<{ id: string }>(
    `SELECT id FROM pty.establishments WHERE legal_entity_id = $1 AND code = 'MATRIZ' LIMIT 1`,
    [legalEntityId],
  );
  let establishmentId = establishment.rows[0]?.id;
  if (!establishmentId) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pty.establishments (
         legal_entity_id, code, trade_name, is_default_issuer,
         street, number, district, city, state, postal_code, country
       ) VALUES ($1, 'MATRIZ', 'CISNE TEST', true,
         'RUA TESTE', '100', 'CENTRO', 'PORTO VELHO', 'RO', '76801000', 'BR')
       RETURNING id`,
      [legalEntityId],
    );
    establishmentId = inserted.rows[0]!.id;
  } else {
    await client.query(
      `UPDATE pty.establishments
       SET is_default_issuer = true, status = 'ACTIVE', updated_at = NOW()
       WHERE id = $1`,
      [establishmentId],
    );
  }

  await client.query(
    `INSERT INTO pty.establishment_tax_registrations (establishment_id, tax_kind, normalized_number, status)
     SELECT $1, 'CNPJ', '11897171000181', 'ACTIVE'
     WHERE NOT EXISTS (
       SELECT 1 FROM pty.establishment_tax_registrations
       WHERE tax_kind = 'CNPJ' AND normalized_number = '11897171000181' AND status = 'ACTIVE'
     )`,
    [establishmentId],
  );
}

beforeAll(async () => {
  serializerClient = await getSerializerPool().connect();
  try {
    await acquireAdvisoryLockWithTimeout(serializerClient, INTEGRATION_TEST_DB_LOCK_KEY, 180_000);
    lockHeld = true;
    await ensureTestDefaultIssuer(serializerClient);
    await clearRateLimitBuckets(serializerClient);
  } catch (error) {
    releaseSerializerClient(true);
    throw error;
  }
}, 180_000);

/**
 * LIMPA O CONTADOR DE RATE LIMIT ENTRE ARQUIVOS DE TESTE.
 *
 * Antes do rate limit compartilhado (`sec.rate_limit_bucket`), o contador vivia em um `Map`
 * por processo. Cada arquivo de teste tinha, na pratica, o proprio teto, e ~30 logins
 * espalhados pelas suites E2E nunca somavam.
 *
 * Com o contador no banco — que e o que faz o limite valer entre replicas em producao — essas
 * mesmas chamadas caem no MESMO bucket: `clientKey` e `ip:user-agent`, e suites que nao enviam
 * `user-agent` compartilham a chave `127.0.0.1:unknown`. O sexto login da execucao recebia 429
 * e suites alheias ao rate limit passavam a falhar (`expected 429 to be 200`).
 *
 * A limpeza e POR ARQUIVO, nunca por requisicao: dentro de um arquivo o limite continua valendo
 * integralmente, e o teste autoritativo (`auth.e2e.spec.ts` › "rate limits abusive login
 * attempts") segue provando o 429 real. Nada aqui toca a politica de producao: nenhum limiar
 * muda, nenhum bypass e instalado na aplicacao.
 *
 * Sem isto, a alternativa seria isolar cada suite mandando um `user-agent` proprio — o que
 * espalharia uma preocupacao de infraestrutura de teste por dezenas de specs e deixaria a
 * proxima suite nova com o mesmo problema.
 */
async function clearRateLimitBuckets(client: PoolClient): Promise<void> {
  try {
    await client.query('DELETE FROM sec.rate_limit_bucket');
  } catch (error) {
    // A tabela pode nao existir em suites que rodam sobre um schema anterior a 0119.
    // Nesse caso nao ha contador compartilhado a limpar — o store cai em memoria.
    const code = (error as { code?: string }).code;
    if (code !== '42P01') {
      throw error;
    }
  }
}

afterAll(async () => {
  if (serializerClient) {
    await clearRateLimitBuckets(serializerClient);
  }
  await shutdownSerializerPool();
}, 180_000);

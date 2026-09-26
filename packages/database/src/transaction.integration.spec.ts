import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withTransaction, type TransactionError } from './transaction';

/**
 * CONTRATO DE `withTransaction` (PostgreSQL integration)
 *
 * Guarda do defeito comprovado que motivou o helper: `pool.query('BEGIN')` seguido de
 * `pool.query('COMMIT')` nao e uma transacao, porque `Pool.query` usa uma conexao por statement.
 * O BEGIN ficava numa conexao (que voltava ao pool em `idle in transaction`, segurando locks) e o
 * COMMIT em outra: nao havia atomicidade, e a conexao presa podia ser reutilizada por outro
 * consumidor do mesmo pool.
 *
 * As assercoes abaixo so podem passar se BEGIN, os statements e COMMIT/ROLLBACK rodarem na MESMA
 * conexao dedicada, mantida fora do pool durante toda a operacao — que e exatamente o contrato
 * que os seeds dependem (`runDevelopmentSeed`, `runProductionBootstrap`, `ensureDevPaymentMatrix`).
 *
 * A sonda usa `authorization.scope_refs` (PK por scope_type+ref_id, sem FK para identidade) para
 * nao criar DDL de teste no banco compartilhado.
 */

describe('withTransaction — transacao real em conexao dedicada', () => {
  let pool: Pool;
  let observer: Pool;
  const probeRefId = `TX-PROBE-${randomUUID()}`;

  const insertProbe = (client: PoolClient) =>
    client.query(
      `INSERT INTO "authorization".scope_refs (scope_type, ref_id) VALUES ('UNIT', $1)`,
      [probeRefId],
    );

  const probeVisible = async (): Promise<number> => {
    const result = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "authorization".scope_refs WHERE ref_id = $1`,
      [probeRefId],
    );
    return Number(result.rows[0]?.count ?? '0');
  };

  const idleInTransaction = async (): Promise<number> => {
    const result = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'idle in transaction'
          AND pid <> pg_backend_pid()`,
    );
    return Number(result.rows[0]?.count ?? '0');
  };

  beforeAll(async () => {
    const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for transaction tests.');
    }
    pool = new Pool({ connectionString: testDatabaseUrl, max: 4 });
    observer = new Pool({ connectionString: testDatabaseUrl, max: 1 });
    await observer.query(`DELETE FROM "authorization".scope_refs WHERE ref_id = $1`, [probeRefId]);
  });

  afterEach(async () => {
    await observer.query(`DELETE FROM "authorization".scope_refs WHERE ref_id = $1`, [probeRefId]);
  });

  afterAll(async () => {
    await observer.query(`DELETE FROM "authorization".scope_refs WHERE ref_id = $1`, [probeRefId]);
    await pool.end();
    await observer.end();
  });

  it('commita o trabalho quando a operacao termina', async () => {
    await withTransaction(pool, async (client) => {
      await insertProbe(client);
    });

    expect(await probeVisible()).toBe(1);
  });

  it('mantem a transacao numa conexao dedicada: o pool nao ve os dados antes do commit', async () => {
    let transactionPid = 0;
    let pooledQueryPid = 0;
    let visibleOutside = -1;

    await withTransaction(pool, async (client) => {
      const pid = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      transactionPid = pid.rows[0]!.pid;
      await insertProbe(client);

      // Qualquer query pelo pool durante a transacao tem de usar OUTRA conexao (a atual esta
      // emprestada) e nao pode enxergar o trabalho ainda nao commitado.
      const outside = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      pooledQueryPid = outside.rows[0]!.pid;
      visibleOutside = await probeVisible();
    });

    expect(pooledQueryPid).not.toBe(transactionPid);
    expect(visibleOutside).toBe(0);
    expect(await probeVisible()).toBe(1);
  });

  it('executa todos os statements da unidade logica na MESMA sessao e transacao', async () => {
    let statements = 0;

    await withTransaction(pool, async (client) => {
      /**
       * `ON COMMIT DROP` faz o proprio PostgreSQL provar a mesma transacao: se qualquer
       * statement escapasse para `pool.query`, ele rodaria em outra sessao/transacao e a tabela
       * temporaria ja teria sido descartada (ou nunca existiria) -> erro de relacao inexistente.
       */
      await client.query('CREATE TEMP TABLE tx_contract_probe (id int) ON COMMIT DROP');
      await client.query('INSERT INTO tx_contract_probe (id) VALUES (1)');
      const read = await client.query<{ pid: number; xid: string }>(
        'SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid FROM tx_contract_probe',
      );
      const session = await client.query<{ pid: number; xid: string }>(
        'SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid',
      );

      expect(read.rows[0]!.pid).toBe(session.rows[0]!.pid);
      expect(read.rows[0]!.xid).toBe(session.rows[0]!.xid);
      statements += 1;
    });

    expect(statements).toBe(1);
    // `ON COMMIT DROP` + transacao encerrada: a sessao do observer nao enxerga tabela alguma.
    const leftover = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_class WHERE relname = 'tx_contract_probe'`,
    );
    expect(leftover.rows[0]?.count).toBe('0');
  });

  it('desfaz tudo e propaga o erro quando a operacao falha', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await insertProbe(client);
        throw new Error('INJECTED_TRANSACTION_FAILURE');
      }),
    ).rejects.toThrow('INJECTED_TRANSACTION_FAILURE');

    expect(await probeVisible()).toBe(0);
  });

  it('nao deixa conexao presa em idle in transaction depois da falha', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await insertProbe(client);
        throw new Error('INJECTED_TRANSACTION_FAILURE');
      }),
    ).rejects.toThrow('INJECTED_TRANSACTION_FAILURE');

    expect(await idleInTransaction()).toBe(0);
  });

  it('preserva a falha primaria e descarta a conexao quando o ROLLBACK tambem falha', async () => {
    const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
    const localPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
    const releaseSignals: unknown[] = [];
    // `pg-pool` emite `release` com o erro passado ao release: prova observavel do sinal de descarte.
    localPool.on('release', (err) => {
      releaseSignals.push(err);
    });

    try {
      const failure = await withTransaction(localPool, async (client) => {
        await insertProbe(client);
        // Perda real de conexao antes do desfecho da transacao: o ROLLBACK nao pode ser confirmado.
        await client.end();
        throw new Error('INJECTED_PRIMARY_FAILURE');
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('INJECTED_PRIMARY_FAILURE');
      expect((failure as TransactionError).rollbackFailure).toBeInstanceOf(Error);

      // A conexao recebeu o sinal de descarte (release com erro), em vez de voltar ao reuso.
      expect(releaseSignals.some((signal) => signal instanceof Error)).toBe(true);
      expect(localPool.totalCount).toBe(0);

      // Nada do trabalho interrompido ficou persistido e o pool segue utilizavel.
      expect(await probeVisible()).toBe(0);
      const reusable = await localPool.query<{ ok: number }>('SELECT 1 AS ok');
      expect(reusable.rows[0]?.ok).toBe(1);
    } finally {
      localPool.removeAllListeners('release');
      await localPool.end();
    }
  });
});

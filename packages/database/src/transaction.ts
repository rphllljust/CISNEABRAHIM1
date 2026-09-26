import type { Pool, PoolClient } from 'pg';

/**
 * Executa `run` dentro de UMA transacao real, sempre na mesma conexao dedicada.
 *
 * Defeito comprovado que este helper evita — `pool.query('BEGIN')` + `pool.query('COMMIT')`
 * NAO e uma transacao: `Pool.query` empresta uma conexao por statement e a devolve ao pool em
 * seguida, de modo que o BEGIN fica numa conexao, o COMMIT em outra e os statements do meio
 * rodam em autocommit. A transacao nunca existiu; a conexao que recebeu o BEGIN ainda volta ao
 * pool em estado `idle in transaction`, segurando locks, e pode ser reutilizada por outro
 * consumidor do mesmo pool.
 *
 * O padrao correto (documentado em node-postgres, secao Transactions) e `pool.connect()` +
 * BEGIN/COMMIT/ROLLBACK + `release()` na MESMA conexao, com ROLLBACK no caminho de erro e
 * `release()` incondicional no `finally` — o mesmo idioma ja usado em
 * `apps/api/src/finance/repositories/bank-reconciliation.repository.ts`.
 *
 * Caminho de erro (hardening):
 * - a falha da OPERACAO continua sendo a causa primaria propagada, com a propria identidade
 *   (classe, `code` e demais campos preservados para o mapeamento de erro do chamador);
 * - se o ROLLBACK tambem falhar, o erro secundario nao substitui a causa primaria: ele fica
 *   anexado em `rollbackFailure` (ver `TransactionError`) e a conexao e **descartada**, nao
 *   devolvida ao pool. Sessao cujo encerramento de transacao nao pode ser confirmado esta em
 *   estado desconhecido e contaminaria o proximo consumidor (brianc/node-postgres#154). O
 *   mecanismo e o previsto pelo proprio `pg-pool`: `client.release(err)` remove a conexao do pool
 *   (`_release`: "include an error to remove it from the pool").
 */

/** Erro que carrega, alem da falha primaria, a falha secundaria do ROLLBACK. */
export type TransactionError = Error & { rollbackFailure?: unknown };

/**
 * Anexa a falha de ROLLBACK ao erro primario sem descarta-lo e sem substituir a mensagem.
 * Se o erro primario for imutavel/selado, o anexo e dispensado — a causa primaria continua
 * propagada intacta.
 */
function attachRollbackFailure(primary: unknown, rollbackFailure: unknown): void {
  if (typeof primary !== 'object' || primary === null) {
    return;
  }
  try {
    (primary as TransactionError).rollbackFailure = rollbackFailure;
  } catch {
    // Erro nao extensivel: preservar a causa primaria e mais importante que o anexo.
  }
}

export async function withTransaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  // Sinaliza ao pool que a conexao nao deve voltar ao reuso. Fica indefinido no caminho saudavel.
  let evictWith: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackFailure) {
      attachRollbackFailure(error, rollbackFailure);
      evictWith =
        rollbackFailure instanceof Error ? rollbackFailure : new Error(String(rollbackFailure));
    }
    throw error;
  } finally {
    client.release(evictWith);
  }
}

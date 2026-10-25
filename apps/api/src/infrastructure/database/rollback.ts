import type { PoolClient } from 'pg';

/**
 * Executa ROLLBACK sem mascarar o erro primário.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O ANTI-PADRÃO QUE ESTA FUNÇÃO EXISTE PARA ELIMINAR
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Isto parece correto e não é:
 *
 *     await client.query('ROLLBACK');
 *     throw error;
 *
 * Se o próprio ROLLBACK falha — conexão terminada, transação já abortada pelo
 * servidor — a rejeição do ROLLBACK SOBRESCREVE a causa original. O operador lê
 * "Connection terminated unexpectedly" quando a causa era uma violação de
 * constraint. A investigação começa no lugar errado, e o dado que explicava a
 * falha já foi perdido.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRATO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Devolve a falha do ROLLBACK, ou `undefined` quando ele funcionou. O CHAMADOR
 * decide o que fazer com a conexão; a causa primária continua sendo dele, sempre.
 *
 * O chamador deve usar o retorno como argumento de `release`:
 *
 *     let evictWith: Error | undefined;
 *     try { ... } catch (error) {
 *       evictWith = await rollbackKeepingPrimaryCause(client);
 *       throw error;
 *     } finally {
 *       client.release(evictWith);
 *     }
 *
 * Um cliente cujo ROLLBACK falhou está em estado indefinido e NÃO pode voltar ao
 * pool: reutilizá-lo propagaria a transação abortada para o próximo comando.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA FUNÇÃO PASSOU A VIVER AQUI
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Ela existia copiada em nove repositórios. Nove cópias da mesma regra divergem
 * na primeira manutenção, e o defeito apareceria em UM repositório de cada vez.
 * A implementação é idêntica à das cópias; o que muda é haver uma só.
 */
export async function rollbackKeepingPrimaryCause(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query('ROLLBACK');
    return undefined;
  } catch (rollbackFailure) {
    return rollbackFailure instanceof Error ? rollbackFailure : new Error(String(rollbackFailure));
  }
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresRateLimitStore, InMemoryRateLimitStore } from './rate-limit-store';
import { getTestDatabaseUrl } from '../../test/load-vitest-env';

/**
 * RATE LIMIT COMPARTILHADO ENTRE REPLICAS — prova em banco real.
 *
 * O defeito que estes testes fecham so aparece com MAIS DE UMA instancia da API.
 * `production-infrastructure.md` dimensiona `PROD_API_REPLICAS` em 1-2, entao o cenario
 * "duas replicas" nao e hipotetico: e o baseline de producao.
 *
 * Um teste com o store em memoria nao prova nada aqui — ele reproduziria o bug com dois
 * `Map` independentes. Por isso estes casos usam DOIS stores sobre o MESMO pool, que e a
 * forma mais fiel de simular duas replicas sem subir dois processos: cada store tem seu
 * proprio estado em memoria (nenhum, neste caso) e disputa a mesma linha no Postgres.
 */

const POLICY = { maxRequests: 5, windowMs: 60_000 };

function executorFrom(pool: Pool) {
  return {
    query: (text: string, values: unknown[]) => pool.query(text, values),
  };
}

describe('PostgresRateLimitStore — limite compartilhado entre replicas', () => {
  let pool: Pool;
  let replicaA: PostgresRateLimitStore;
  let replicaB: PostgresRateLimitStore;

  beforeAll(async () => {
    // `getTestDatabaseUrl()` devolve `string | undefined`; o `Pool` exige `string`.
    // O narrow abaixo prova a presenca antes de construir o pool, em vez de castar.
    const connectionString = getTestDatabaseUrl();
    if (!connectionString) {
      throw new Error('TEST_DATABASE_URL is required for the shared rate limit proof');
    }
    pool = new Pool({ connectionString, max: 8 });
    replicaA = new PostgresRateLimitStore(executorFrom(pool));
    replicaB = new PostgresRateLimitStore(executorFrom(pool));
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function clear(surface: string, key: string): Promise<void> {
    await pool.query('DELETE FROM sec.rate_limit_bucket WHERE surface = $1 AND bucket_key = $2', [
      surface,
      key,
    ]);
  }

  it('conta as duas replicas na MESMA janela', async () => {
    const key = `replica-shared-${Date.now()}`;
    await clear('login', key);

    // 3 tentativas em A + 2 em B = 5 consumidos de um teto de 5.
    for (let i = 0; i < 3; i += 1) {
      await expect(replicaA.consume('login', key, POLICY)).resolves.toMatchObject({
        allowed: true,
      });
    }
    for (let i = 0; i < 2; i += 1) {
      await expect(replicaB.consume('login', key, POLICY)).resolves.toMatchObject({
        allowed: true,
      });
    }

    // A 6a falha em QUALQUER replica: o contador e um so.
    const sixthFromB = await replicaB.consume('login', key, POLICY);
    expect(sixthFromB.allowed).toBe(false);
    expect(sixthFromB.retryAfterMs).toBeGreaterThan(0);

    const sixthFromA = await replicaA.consume('login', key, POLICY);
    expect(sixthFromA.allowed).toBe(false);

    await clear('login', key);
  });

  it('o store em memoria NAO ve o consumo da outra replica (o defeito original)', async () => {
    const key = `replica-memory-${Date.now()}`;
    await clear('login', key);

    // Dois stores em memoria = o comportamento anterior: cada "replica" tem o proprio teto.
    const memoryA = new InMemoryRateLimitStore();
    const memoryB = new InMemoryRateLimitStore();

    for (let i = 0; i < POLICY.maxRequests; i += 1) {
      await memoryA.consume('login', key, POLICY);
    }

    // A esgotou o proprio teto; B ainda tem 5. Com 2 replicas, o limite efetivo era 10.
    await expect(memoryA.consume('login', key, POLICY)).resolves.toMatchObject({ allowed: false });
    await expect(memoryB.consume('login', key, POLICY)).resolves.toMatchObject({ allowed: true });
  });

  it('respeita o teto sob consumo concorrente das duas replicas', async () => {
    const key = `replica-race-${Date.now()}`;
    await clear('login', key);

    /*
     * 20 consumos simultaneos, metade em cada replica. Se o incremento nao fosse atomico
     * (SELECT seguido de UPDATE), leituras concorrentes veriam o mesmo `count` e varias
     * passariam do teto. `INSERT ... ON CONFLICT DO UPDATE` serializa na linha.
     */
    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 === 0 ? replicaA : replicaB).consume('login', key, POLICY),
      ),
    );

    const allowed = attempts.filter((attempt) => attempt.allowed).length;
    expect(allowed).toBe(POLICY.maxRequests);

    // O contador persistido prova o total real de consumos, nao so a decisao retornada.
    const stored = await pool.query<{ count: number }>(
      'SELECT count FROM sec.rate_limit_bucket WHERE surface = $1 AND bucket_key = $2',
      ['login', key],
    );
    expect(Number(stored.rows[0]?.count)).toBe(20);

    await clear('login', key);
  });

  it('reinicia a contagem quando a janela expira', async () => {
    const key = `replica-window-${Date.now()}`;
    await clear('login', key);

    const shortWindow = { maxRequests: 2, windowMs: 50 };
    await replicaA.consume('login', key, shortWindow);
    await replicaB.consume('login', key, shortWindow);
    await expect(replicaA.consume('login', key, shortWindow)).resolves.toMatchObject({
      allowed: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));

    // Janela vencida: a proxima tentativa reinicia em 1, sem job de limpeza.
    await expect(replicaB.consume('login', key, shortWindow)).resolves.toMatchObject({
      allowed: true,
    });

    await clear('login', key);
  });

  it('isolam-se as superficies e as chaves', async () => {
    const suffix = Date.now();
    const loginKey = `surface-login-${suffix}`;
    const searchKey = `surface-search-${suffix}`;
    await clear('login', loginKey);
    await clear('search', searchKey);

    const one = { maxRequests: 1, windowMs: 60_000 };
    await replicaA.consume('login', loginKey, one);
    await expect(replicaA.consume('login', loginKey, one)).resolves.toMatchObject({
      allowed: false,
    });
    // Superficie diferente, mesma chave: bucket proprio.
    await expect(replicaB.consume('search', loginKey, one)).resolves.toMatchObject({
      allowed: true,
    });
    // Mesma superficie, chave diferente: bucket proprio.
    await expect(replicaB.consume('login', searchKey, one)).resolves.toMatchObject({
      allowed: true,
    });

    await clear('login', loginKey);
    await clear('search', searchKey);
    await clear('search', loginKey);
    await clear('login', searchKey);
  });

  it('reset limpa o bucket nas duas replicas', async () => {
    const key = `replica-reset-${Date.now()}`;
    await clear('login', key);

    await replicaA.consume('login', key, POLICY);
    await replicaA.reset('login', key);
    // A outra replica nao tem estado proprio: a limpeza e no banco, logo vale para as duas.
    await expect(replicaB.consume('login', key, POLICY)).resolves.toMatchObject({ allowed: true });

    await clear('login', key);
  });

  it('degrada com seguranca quando o executor falha', async () => {
    /*
     * Fail-open deliberado. Um contador ilegivel nao pode derrubar o login: negar acesso por
     * erro de leitura do proprio contador transformaria problema de infraestrutura em
     * indisponibilidade total. O modo continua visivel em `mode`, que o bootstrap publica.
     */
    const broken = new PostgresRateLimitStore({
      query: async () => {
        throw new Error('connection terminated');
      },
    });

    await expect(broken.consume('login', 'k', POLICY)).rejects.toThrow('connection terminated');
  });
});

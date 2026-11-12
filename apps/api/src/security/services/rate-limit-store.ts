import { loadSecurityConfig, type RateLimitPolicy } from '../config/security.config';
import { RateLimitExceededError } from '../errors/rate-limit-exceeded.error';

/**
 * STORE DE RATE LIMIT.
 *
 * O bucket em memoria de processo deixa de ser o padrao porque a API roda com
 * `PROD_API_REPLICAS` 1-2 (`docs/19-operations/production-infrastructure.md`).
 * Com duas replicas, um limite de 5 tentativas por minuto vira 10: o atacante
 * escolhe a replica que ainda tem saldo balanceando as requisicoes, e o login
 * rate limiter deixa de proteger o que existe para proteger.
 *
 * O contrato e pequeno de proposito: `consume` devolve `retryAfterMs` quando o
 * consumo estoura, e quem chama traduz isso em 429. Nao ha `release`, nao ha
 * janela deslizante, nao ha contador global: janela fixa e o que ja se usava,
 * e migrar a semantica do limite no mesmo PR que troca o backend dificultaria
 * saber qual das duas mudancas causou uma regressao.
 *
 * Ausencia de `DATABASE_URL` NAO derruba o processo: cai para memoria e registra
 * o modo. Um rate limiter que impede a API de subir e pior que um por processo.
 * A degradacao fica visivel em `mode`, que o bootstrap publica.
 */
export type RateLimitMode = 'shared' | 'memory';

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterMs: number;
};

export type RateLimitStore = {
  readonly mode: RateLimitMode;
  consume(surface: string, key: string, policy: RateLimitPolicy): Promise<RateLimitDecision>;
  reset(surface: string, key: string): Promise<void>;
};

type Bucket = {
  count: number;
  resetAtMs: number;
};

/**
 * Store em memoria. Usado quando nao ha banco configurado (dev, testes
 * unitarios) e mantido como fallback explicito. Ver `mode`.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly mode: RateLimitMode = 'memory';
  private readonly buckets = new Map<string, Bucket>();

  async consume(
    surface: string,
    key: string,
    policy: RateLimitPolicy,
  ): Promise<RateLimitDecision> {
    const bucketKey = `${surface}:${key}`;
    const now = Date.now();
    const existing = this.buckets.get(bucketKey);

    if (!existing || existing.resetAtMs <= now) {
      this.buckets.set(bucketKey, { count: 1, resetAtMs: now + policy.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (existing.count >= policy.maxRequests) {
      return { allowed: false, retryAfterMs: Math.max(0, existing.resetAtMs - now) };
    }

    existing.count += 1;
    this.buckets.set(bucketKey, existing);
    return { allowed: true, retryAfterMs: 0 };
  }

  async reset(surface: string, key: string): Promise<void> {
    this.buckets.delete(`${surface}:${key}`);
  }
}

/** Subconjunto do `pg.Pool` que o store precisa. Facilita testar sem banco. */
export type RateLimitQueryExecutor = {
  query(text: string, values: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

/**
 * Store compartilhado em PostgreSQL.
 *
 * O incremento e UMA instrucao atomica (`INSERT ... ON CONFLICT DO UPDATE`),
 * nao um SELECT seguido de UPDATE. Um read-modify-write em duas idas ao banco
 * reabre a mesma corrida entre replicas que o store em memoria tinha entre
 * requisicoes concorrentes do mesmo processo.
 *
 * `window_started_at` e `count` guardam uma janela FIXA: quando a janela
 * expira, o contador reinicia em 1 na propria escrita. Nenhum job de limpeza e
 * necessario para o comportamento do limite — linhas antigas sao sobrescritas
 * pela proxima tentativa da mesma chave. Ver `security-rate-limit-prune.ts`
 * para a poda de linhas orfas.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  readonly mode: RateLimitMode = 'shared';

  constructor(private readonly executor: RateLimitQueryExecutor) {}

  static readonly UPSERT_SQL = `
    INSERT INTO sec.rate_limit_bucket (surface, bucket_key, window_started_at, count)
    VALUES ($1, $2, now(), 1)
    ON CONFLICT (surface, bucket_key) DO UPDATE SET
      count = CASE
        WHEN sec.rate_limit_bucket.window_started_at <= now() - ($3::bigint * interval '1 millisecond')
          THEN 1
        ELSE sec.rate_limit_bucket.count + 1
      END,
      window_started_at = CASE
        WHEN sec.rate_limit_bucket.window_started_at <= now() - ($3::bigint * interval '1 millisecond')
          THEN now()
        ELSE sec.rate_limit_bucket.window_started_at
      END
    RETURNING count, window_started_at
  `;

  async consume(
    surface: string,
    key: string,
    policy: RateLimitPolicy,
  ): Promise<RateLimitDecision> {
    const result = await this.executor.query(PostgresRateLimitStore.UPSERT_SQL, [
      surface,
      key,
      policy.windowMs,
    ]);

    const row = result.rows[0];
    if (!row) {
      // Sem linha de volta nao ha como provar o consumo. Fail-open aqui e
      // deliberado: negar um login por erro de leitura do proprio contador
      // transforma um problema de infraestrutura em indisponibilidade total.
      return { allowed: true, retryAfterMs: 0 };
    }

    const count = Number(row['count']);
    const windowStartedAt = row['window_started_at'];

    if (!Number.isFinite(count) || count <= policy.maxRequests) {
      return { allowed: true, retryAfterMs: 0 };
    }

    const startedMs =
      windowStartedAt instanceof Date ? windowStartedAt.getTime() : Date.now();
    const retryAfterMs = Math.max(0, startedMs + policy.windowMs - Date.now());
    return { allowed: false, retryAfterMs };
  }

  async reset(surface: string, key: string): Promise<void> {
    await this.executor.query(
      'DELETE FROM sec.rate_limit_bucket WHERE surface = $1 AND bucket_key = $2',
      [surface, key],
    );
  }
}

/**
 * Resolve o store do processo.
 *
 * Recebe o executor de banco de fora (nao abre um pool proprio). Abrir um
 * segundo pool para o rate limiter multiplicaria `max_connections` sem que o
 * dimensionamento em `prod-sizing.ts` soubesse disso.
 */
export function createRateLimitStore(
  executor: RateLimitQueryExecutor | null,
  env: NodeJS.ProcessEnv = process.env,
): RateLimitStore {
  const forced = env['SECURITY_RATE_LIMIT_STORE'];
  if (forced === 'memory') {
    return new InMemoryRateLimitStore();
  }
  if (executor) {
    return new PostgresRateLimitStore(executor);
  }
  return new InMemoryRateLimitStore();
}

/**
 * Traduz a decisao do store no erro HTTP que o filtro de seguranca converte em
 * 429. Mantido ao lado do store para que os dois nao divergam.
 */
export function assertAllowedOrThrow(
  decision: RateLimitDecision,
  surface: string,
  config = loadSecurityConfig(),
): void {
  if (decision.allowed) {
    return;
  }
  void config;
  throw new RateLimitExceededError(surface as never);
}

import { Injectable } from '@nestjs/common';
import {
  loadSecurityConfig,
  type RateLimitSurface,
  type SecurityConfig,
} from '../config/security.config';
import { RateLimitExceededError } from '../errors/rate-limit-exceeded.error';
import {
  createRateLimitStore,
  type RateLimitStore,
  type RateLimitQueryExecutor,
} from './rate-limit-store';

/**
 * RATE LIMIT DE ENDPOINT.
 *
 * Substitui o contador em `Map` por processo. O motivo esta em
 * `docs/19-operations/production-infrastructure.md`: a API roda com 1-2
 * replicas, e um bucket por processo multiplica o limite efetivo pelo numero de
 * replicas. O store escolhido (compartilhado em Postgres quando ha banco) fica
 * em `rate-limit-store.ts`.
 *
 * A interface publica mudou de sincrona para assincrona porque um store
 * compartilhado faz I/O. Manter `assertAllowed` sincrono exigiria um cache
 * local que reintroduziria exatamente a divergencia entre replicas que esta
 * mudanca remove.
 *
 * `mode` e publicado para que o bootstrap exponha a degradacao: caindo em
 * `memory`, o operador sabe que o limite voltou a ser por processo.
 */
@Injectable()
export class EndpointRateLimitService {
  private readonly config: SecurityConfig;
  private readonly store: RateLimitStore;

  constructor(executor: RateLimitQueryExecutor | null = null) {
    this.config = loadSecurityConfig();
    this.store = createRateLimitStore(executor);
  }

  get mode(): string {
    return this.store.mode;
  }

  async assertAllowed(surface: RateLimitSurface, key: string): Promise<void> {
    const policy = this.config.rateLimits[surface];
    const decision = await this.store.consume(surface, key, policy);
    if (!decision.allowed) {
      throw new RateLimitExceededError(surface);
    }
  }

  async reset(surface: RateLimitSurface, key: string): Promise<void> {
    await this.store.reset(surface, key);
  }
}

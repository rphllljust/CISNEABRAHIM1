import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from '../infrastructure/http/api-exception.filter';
import { DatabaseService } from '../infrastructure/database/database.service';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { SecurityClientErrorFilter, SecurityExceptionFilter } from './filters/security-exception.filter';
import { EndpointRateLimitService } from './services/endpoint-rate-limit.service';
import type { RateLimitQueryExecutor } from './services/rate-limit-store';

export const RATE_LIMIT_EXECUTOR = Symbol('RATE_LIMIT_EXECUTOR');

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    /*
     * O executor do rate limit e derivado do MESMO pool da aplicacao
     * (`DatabaseService.getConnection().pool`), nao de um pool novo. Abrir um
     * segundo pool para o contador multiplicaria `max_connections` sem que o
     * dimensionamento em `prod-sizing.ts` soubesse — e rate limit global nao
     * justifica exceder o limite de conexoes do Postgres.
     *
     * Sem banco configurado o token resolve para `null` e o store cai em
     * memoria, com o modo publicado em `EndpointRateLimitService.mode`.
     */
    {
      provide: RATE_LIMIT_EXECUTOR,
      useFactory: (database: DatabaseService): RateLimitQueryExecutor | null => {
        const connection = database.getConnection();
        if (!connection) {
          return null;
        }
        return {
          query: (text: string, values: unknown[]) => connection.pool.query(text, values),
        };
      },
      inject: [DatabaseService],
    },
    {
      provide: EndpointRateLimitService,
      useFactory: (executor: RateLimitQueryExecutor | null) =>
        new EndpointRateLimitService(executor),
      inject: [RATE_LIMIT_EXECUTOR],
    },
    SecurityClientErrorFilter,
    ApiExceptionFilter,
    SecurityExceptionFilter,
    {
      provide: APP_FILTER,
      useExisting: SecurityExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useExisting: ApiExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useExisting: SecurityClientErrorFilter,
    },
  ],
  exports: [
    EndpointRateLimitService,
    SecurityClientErrorFilter,
    ApiExceptionFilter,
    SecurityExceptionFilter,
  ],
})
export class SecurityModule {}

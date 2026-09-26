import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { DatabaseService } from '../infrastructure/database/database.service';

export type DatabaseHealthPayload =
  | { status: 'up'; latencyMs: number }
  | { status: 'down'; latencyMs: number; error?: string }
  | { status: 'not_configured' };

export type LivenessResponse = {
  status: 'ok';
  service: 'api';
  timestamp: string;
};

export type ReadinessResponse = {
  status: 'ready' | 'not_ready';
  service: 'api';
  timestamp: string;
  checks: {
    database: DatabaseHealthPayload;
  };
};

/** @deprecated Use /health/live and /health/ready for probe semantics. */
export type HealthResponse = {
  status: 'ok' | 'degraded';
  service: 'api';
  timestamp: string;
  database: DatabaseHealthPayload;
};

function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV'] === 'production' || env['CISNE_ENV'] === 'production';
}

function isDatabaseReadyForTraffic(
  database: DatabaseHealthPayload,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (database.status === 'up') {
    return true;
  }
  if (database.status === 'not_configured') {
    return !isProductionRuntime(env);
  }
  return false;
}

@Controller('health')
export class HealthController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get('live')
  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness de trafego. O orquestrador/balanceador decide pelo CODIGO HTTP, portanto
   * `not_ready` responde 503 (mesmo payload) e nao 200 com corpo informativo.
   * Liveness permanece 200: o processo esta vivo, apenas nao pronto para receber trafego.
   */
  @Get('ready')
  async getReadiness(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReadinessResponse> {
    const database = await this.databaseService.getHealth();
    const ready = isDatabaseReadyForTraffic(database);
    if (!ready) {
      reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      status: ready ? 'ready' : 'not_ready',
      service: 'api',
      timestamp: new Date().toISOString(),
      checks: { database },
    };
  }

  @Get()
  async getHealth(): Promise<HealthResponse> {
    const database = await this.databaseService.getHealth();
    const isDatabaseHealthy = isDatabaseReadyForTraffic(database);

    return {
      status: isDatabaseHealthy ? 'ok' : 'degraded',
      service: 'api',
      timestamp: new Date().toISOString(),
      database,
    };
  }
}

import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../infrastructure/database/database.service';
import { HealthController } from './health.controller';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** Reply do adaptador (Fastify) observada: o probe depende do codigo HTTP. */
function makeReply() {
  return { status: vi.fn() };
}

describe('HealthController', () => {
  it('returns liveness without dependency checks', async () => {
    const databaseService = {
      getHealth: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: databaseService }],
    }).compile();

    const controller = module.get(HealthController);
    const result = controller.getLiveness();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('api');
    expect(databaseService.getHealth).not.toHaveBeenCalled();
  });

  it('returns readiness ready when database is up', async () => {
    const databaseService = {
      getHealth: vi.fn().mockResolvedValue({ status: 'up', latencyMs: 2 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: databaseService }],
    }).compile();

    const controller = module.get(HealthController);
    const reply = makeReply();
    const result = await controller.getReadiness(reply as never);

    expect(result.status).toBe('ready');
    expect(result.checks.database).toEqual({ status: 'up', latencyMs: 2 });
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('returns readiness not_ready when database is down', async () => {
    const databaseService = {
      getHealth: vi.fn().mockResolvedValue({
        status: 'down',
        latencyMs: 5,
        error: 'connection refused',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: databaseService }],
    }).compile();

    const controller = module.get(HealthController);
    const reply = makeReply();
    const result = await controller.getReadiness(reply as never);

    expect(result.status).toBe('not_ready');
    expect(result.checks.database.status).toBe('down');
    // Banco indisponivel: o probe de readiness DEVE responder 503, nao 200.
    expect(reply.status).toHaveBeenCalledWith(503);
  });

  it('returns readiness ready when database is not configured in development', async () => {
    process.env['NODE_ENV'] = 'development';
    const databaseService = {
      getHealth: vi.fn().mockResolvedValue({ status: 'not_configured' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: databaseService }],
    }).compile();

    const controller = module.get(HealthController);
    const reply = makeReply();
    const result = await controller.getReadiness(reply as never);

    expect(result.status).toBe('ready');
    expect(result.checks.database.status).toBe('not_configured');
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('returns readiness not_ready when database is not configured in production', async () => {
    process.env['NODE_ENV'] = 'production';
    const databaseService = {
      getHealth: vi.fn().mockResolvedValue({ status: 'not_configured' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: databaseService }],
    }).compile();

    const controller = module.get(HealthController);
    const reply = makeReply();
    const result = await controller.getReadiness(reply as never);

    expect(result.status).toBe('not_ready');
    expect(result.checks.database.status).toBe('not_configured');
    expect(reply.status).toHaveBeenCalledWith(503);
  });

  it('returns technical health payload with database status', async () => {
    const databaseService = {
      getHealth: vi.fn().mockResolvedValue({ status: 'up', latencyMs: 2 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: databaseService }],
    }).compile();

    const controller = module.get(HealthController);
    const result = await controller.getHealth();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('api');
    expect(result.database).toEqual({ status: 'up', latencyMs: 2 });
    expect(() => new Date(result.timestamp)).not.toThrow();
  });

  it('returns degraded when database is down', async () => {
    const databaseService = {
      getHealth: vi.fn().mockResolvedValue({
        status: 'down',
        latencyMs: 5,
        error: 'connection refused',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: databaseService }],
    }).compile();

    const controller = module.get(HealthController);
    const result = await controller.getHealth();

    expect(result.status).toBe('degraded');
    expect(result.database.status).toBe('down');
  });

  it('returns degraded when database is not configured in production', async () => {
    process.env['CISNE_ENV'] = 'production';
    const databaseService = {
      getHealth: vi.fn().mockResolvedValue({ status: 'not_configured' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: databaseService }],
    }).compile();

    const controller = module.get(HealthController);
    const result = await controller.getHealth();

    expect(result.status).toBe('degraded');
    expect(result.database.status).toBe('not_configured');
  });
});

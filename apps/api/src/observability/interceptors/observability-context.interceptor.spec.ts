import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { firstValueFrom, throwError, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ObservabilityContextInterceptor } from './observability-context.interceptor';
import type { StructuredLogInput } from '../logging/structured-log';
import type { MetricsRegistryService } from '../metrics/metrics-registry.service';

/**
 * Contrato do status HTTP registrado em log e metrica.
 *
 * Defeito comprovado em produção (log real do suite adversarial, `POST /api/v1/clients`):
 *
 *   {"level":"error","message":"http_request_completed","result":"failure",
 *    "errorCode":"CLIENT_VALIDATION_FAILED","metadata":{"statusCode":201,...}}
 *
 * O log dizia fracasso e reportava 201 — uma falha de validação aparecia como criação.
 *
 * Causa raiz: o interceptor lia `response.statusCode` no proprio teardown, e o filtro de
 * excecao (`ApiExceptionFilter`) escreve o status real DEPOIS desse teardown. O valor lido
 * era o status padrao da rota (201 num POST), nao o status final. O fallback
 * `response.statusCode ?? (failed ? 500 : 200)` era inalcancavel, porque `FastifyReply`
 * .statusCode e sempre um numero — a intencao do autor estava silenciosamente desarmada.
 *
 * O teste reproduz a ORDEM REAL: o status final e escrito depois do teardown, dentro de um
 * `setImmediate` agendado pelo proprio consumidor do erro (papel do filtro de excecao).
 */

type Recorded = { durationMs: number; isError: boolean };

function harness(options: { emit: 'value' | 'error'; initialStatusCode?: number } = { emit: 'error' }) {
  const initialStatusCode = options.initialStatusCode ?? 201;
  const logs: StructuredLogInput[] = [];
  const metrics: Recorded[] = [];

  const reply = {
    statusCode: initialStatusCode,
    header: () => reply,
  } as unknown as FastifyReply;

  const request = {
    method: 'POST',
    url: '/api/v1/clients',
    routeOptions: { url: '/api/v1/clients' },
    headers: {},
  } as unknown as FastifyRequest;

  const executionContext = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ExecutionContext;

  const failure = Object.assign(new Error('validation failed'), {
    code: 'CLIENT_VALIDATION_FAILED',
  });

  const next = {
    handle: () => (options.emit === 'error' ? throwError(() => failure) : of({ ok: true })),
  } as unknown as CallHandler;

  const logger = {
    operation: (input: StructuredLogInput) => {
      logs.push(input);
    },
  };

  const metricsRegistry = {
    recordHttpRequest: (durationMs: number, isError: boolean) => {
      metrics.push({ durationMs, isError });
    },
  };

  const interceptor = new ObservabilityContextInterceptor(
    logger as never,
    metricsRegistry as unknown as MetricsRegistryService,
  );

  return { interceptor, executionContext, next, reply, logs, metrics, failure };
}

/** Runs one request to completion and flushes pending macrotasks (the deferred status read). */
async function runToCompletion(h: ReturnType<typeof harness>): Promise<void> {
  const observable = h.interceptor.intercept(h.executionContext, h.next);
  await firstValueFrom(observable).then(
    () => undefined,
    () => undefined,
  );
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('ObservabilityContextInterceptor HTTP status contract', () => {
  it('logs the FINAL status written after the interceptor teardown, not the route default', async () => {
    const h = harness({ emit: 'error', initialStatusCode: 201 });

    // Reproduz o filtro de excecao: escreve o status real DEPOIS do teardown.
    setImmediate(() => {
      h.reply.statusCode = 400;
    });

    await runToCompletion(h);

    expect(h.logs).toHaveLength(1);
    const logged = h.logs[0]!.metadata?.['statusCode'];
    expect(logged).toBe(400);
    expect(logged).not.toBe(201);
    expect(h.logs[0]!.result).toBe('failure');
    expect(h.logs[0]!.errorCode).toBe('CLIENT_VALIDATION_FAILED');
    expect(h.logs[0]!.level).toBe('error');
  });

  it('logs a 500 written by the catch-all filter as 500', async () => {
    const h = harness({ emit: 'error', initialStatusCode: 201 });

    setImmediate(() => {
      h.reply.statusCode = 500;
    });

    await runToCompletion(h);

    expect(h.logs[0]!.metadata?.['statusCode']).toBe(500);
    expect(h.logs[0]!.result).toBe('failure');
  });

  it('records the failed request in metrics exactly once, synchronously', async () => {
    const h = harness({ emit: 'error', initialStatusCode: 201 });

    const observable = h.interceptor.intercept(h.executionContext, h.next);
    await firstValueFrom(observable).then(
      () => undefined,
      () => undefined,
    );

    // Sem esperar setImmediate: a contagem nao pode depender do status final, senao
    // o alerta de erro HTTP passaria a depender do timing do filtro.
    expect(h.metrics).toHaveLength(1);
    expect(h.metrics[0]!.isError).toBe(true);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.metrics).toHaveLength(1);
  });

  it('logs the real status on the success path without deferring', async () => {
    const h = harness({ emit: 'value', initialStatusCode: 201 });

    await runToCompletion(h);

    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]!.metadata?.['statusCode']).toBe(201);
    expect(h.logs[0]!.result).toBe('success');
    expect(h.logs[0]!.level).toBe('info');
    expect(h.metrics).toHaveLength(1);
    expect(typeof h.metrics[0]!.durationMs).toBe('number');
    expect(h.metrics[0]!.isError).toBe(false);
  });

  it('treats a 5xx returned without throwing as a failure', async () => {
    const h = harness({ emit: 'value', initialStatusCode: 503 });

    await runToCompletion(h);

    expect(h.logs[0]!.result).toBe('failure');
    expect(h.logs[0]!.level).toBe('error');
    expect(h.metrics[0]!.isError).toBe(true);
  });
});

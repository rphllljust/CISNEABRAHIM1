import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, type Subscription } from 'rxjs';
import { CORRELATION_ID_HEADER, resolveCorrelationId } from '../../infrastructure/http/correlation-id';
import {
  createRequestId,
  runWithObservabilityContext,
  type ObservabilityContextState,
} from '../context/observability-context';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import { MetricsRegistryService } from '../metrics/metrics-registry.service';
import { PrometheusMetricsService } from '../metrics/prometheus-metrics.service';

@Injectable()
export class ObservabilityContextInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: StructuredLoggerService,
    private readonly metrics: MetricsRegistryService,
    private readonly prometheus: PrometheusMetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();
    const correlationId = resolveCorrelationId(request);
    const requestId = createRequestId();
    const startedAt = Date.now();
    const operation = `${request.method} ${request.routeOptions?.url ?? request.url}`;
    const contextState: ObservabilityContextState = { requestId, correlationId, operation };

    // Cabeçalhos precisam existir antes do envio da resposta, em todos os caminhos.
    void response.header(CORRELATION_ID_HEADER, correlationId);
    void response.header('x-request-id', requestId);

    return new Observable((observer) => {
      let failed = false;
      let errorCode: string | undefined;
      let subscription: Subscription | undefined;

      const writeLog = (statusCode: number, durationMs: number): void => {
        const isError = failed || statusCode >= 500;
        // B3: projecao Prometheus. A rota e a NORMALIZADA do Fastify
        // (`request.routeOptions.url`), nunca a URL concreta — caso contrario
        // cada id de recurso viraria uma serie temporal distinta.
        this.prometheus.recordHttpRequest(
          request.method,
          request.routeOptions?.url ?? request.url,
          statusCode,
          durationMs,
        );
        this.logger.operation({
          level: isError ? 'error' : 'info',
          message: 'http_request_completed',
          operation,
          durationMs,
          result: isError ? 'failure' : 'success',
          errorCode,
          metadata: {
            statusCode,
            method: request.method,
            path: request.routeOptions?.url ?? request.url,
          },
        });
      };

      runWithObservabilityContext(contextState, () => {
        subscription = next.handle().subscribe({
          next: (value) => observer.next(value),
          error: (error: unknown) => {
            failed = true;
            if (typeof error === 'object' && error !== null && 'code' in error) {
              const code = (error as { code?: unknown }).code;
              errorCode = typeof code === 'string' ? code : undefined;
            }
            observer.error(error);
          },
          complete: () => observer.complete(),
        });
      });

      return () => {
        subscription?.unsubscribe();
        const durationMs = Date.now() - startedAt;

        // A metrica fica SINCRONA de proposito: a classificacao de erro nao depende do
        // status final (`failed` ja a determina no caminho de erro, e no caminho de
        // sucesso a resposta foi enviada e o status e final). Adiar a contagem faria o
        // alerta de erro HTTP depender do timing do filtro de excecao.
        this.metrics.recordHttpRequest(durationMs, failed || response.statusCode >= 500);

        // Defeito comprovado: `response.statusCode` no teardown NAO e o status final.
        // O filtro de excecao (`ApiExceptionFilter`) escreve o status real DEPOIS deste
        // teardown, entao ler aqui reportava o status padrao da rota — num POST, 201 —
        // para uma resposta que saiu 4xx. O log ficava autocontraditorio
        // (`result: "failure"` com `statusCode: 201`) e consultas por statusCode mentiam:
        // falha de validacao aparecia como criacao. O fallback anterior
        // (`response.statusCode ?? (failed ? 500 : 200)`) era inalcancavel, porque
        // `FastifyReply.statusCode` e sempre um numero.
        //
        // Adia-se portanto apenas a LEITURA do status, nunca a contagem.
        if (failed) {
          setImmediate(() => writeLog(response.statusCode, durationMs));
          return;
        }
        writeLog(response.statusCode, durationMs);
      };
    });
  }
}

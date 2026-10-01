import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Optional } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveCorrelationId } from './correlation-id';
import { mapHttpExceptionToApiErrorResponse } from './api-error.mapper';
import { PrometheusMetricsService } from '../../observability/metrics/prometheus-metrics.service';

@Catch(HttpException)
export class ApiExceptionFilter implements ExceptionFilter {
  /**
   * B3: `@Optional()` de proposito. O filtro tambem e construido a mao em
   * testes (`new ApiExceptionFilter()` em api-exception.filter.spec.ts) e a
   * contagem de erro de negocio e um efeito colateral observavel, nunca uma
   * pre-condicao para produzir a resposta de erro. Se o provider nao existir,
   * o filtro continua respondendo exatamente como antes.
   */
  constructor(@Optional() private readonly metrics?: PrometheusMetricsService) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status = exception.getStatus();
    const correlationId = resolveCorrelationId(request);
    const apiError = mapHttpExceptionToApiErrorResponse(exception.getResponse(), status, correlationId);

    // B3: o codigo contado e o MESMO que sai no envelope de resposta, ja
    // normalizado por `mapHttpExceptionToApiErrorResponse`. Contar antes do
    // mapeamento produziria um label distinto do que o cliente observa.
    this.metrics?.recordBusinessError(apiError.error.code);

    void response.status(status).send(apiError);
  }
}

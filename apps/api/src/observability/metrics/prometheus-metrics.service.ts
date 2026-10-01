import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { MetricsRegistryService } from './metrics-registry.service';

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

const LABEL_STATUS = 'status';
const LABEL_METHOD = 'method';
const LABEL_ROUTE = 'route';
const LABEL_ERROR_CODE = 'error_code';

/**
 * Projecao Prometheus sobre o `MetricsRegistryService` existente.
 *
 * DECISAO DE DESIGN (B3): este servico NAO cria um segundo registry de negocio.
 * O `MetricsRegistryService` e a fonte de verdade dos contadores HTTP/DB/worker
 * e ja alimenta `/observability/metrics` (JSON), o `TechnicalAlertService` e o
 * `DatabaseInstrumentationService`. Duplicar a contagem aqui produziria dois
 * numeros divergentes para o mesmo fato — pior que nao ter metrica nenhuma.
 *
 * O que este servico acrescenta e apenas o que ainda NAO existia:
 *   1) formato de exposicao Prometheus (scrape);
 *   2) cardinalidade por label (`method`/`route`/`status`), que o registry
 *      in-memory nao guarda — ele agrega tudo em um unico par total/errors;
 *   3) `business_errors_total` por `error_code`, que nao era contado em lugar
 *      nenhum (0 ocorrencias no repositorio antes desta sessao).
 *
 * Ou seja: os snapshots in-memory entram como gauges derivados, e os labels
 * por requisicao entram como counters/histograms alimentados pelo interceptor.
 */
@Injectable()
export class PrometheusMetricsService {
  private readonly registry = new Registry();
  private readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total de requisicoes HTTP finalizadas, por metodo, rota e status.',
    labelNames: [LABEL_METHOD, LABEL_ROUTE, LABEL_STATUS] as const,
    registers: [],
  });
  private readonly httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duracao das requisicoes HTTP em segundos, por metodo e rota.',
    labelNames: [LABEL_METHOD, LABEL_ROUTE] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [],
  });
  private readonly businessErrorsTotal = new Counter({
    name: 'business_errors_total',
    help: 'Total de erros de dominio/negocio, por codigo de erro.',
    labelNames: [LABEL_ERROR_CODE] as const,
    registers: [],
  });

  constructor(private readonly metrics: MetricsRegistryService) {
    this.registry.registerMetric(this.httpRequestsTotal);
    this.registry.registerMetric(this.httpRequestDurationSeconds);
    this.registry.registerMetric(this.businessErrorsTotal);
    this.registry.setDefaultLabels({ service: 'api' });
    collectDefaultMetrics({ register: this.registry });
  }

  /**
   * Rota normalizada. O parametro de rota resolvido pelo Fastify
   * (`/api/v1/service-orders/:id`) e usado como label, e nunca a URL concreta:
   * usar `request.url` faria cada id virar uma serie temporal distinta e
   * explodiria a cardinalidade do Prometheus.
   */
  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const labels = { [LABEL_METHOD]: method, [LABEL_ROUTE]: route };
    this.httpRequestsTotal.inc({ ...labels, [LABEL_STATUS]: String(statusCode) });
    this.httpRequestDurationSeconds.observe(labels, durationMs / 1000);
  }

  recordBusinessError(errorCode: string): void {
    this.businessErrorsTotal.inc({ [LABEL_ERROR_CODE]: errorCode });
  }

  async render(): Promise<string> {
    await this.syncRuntimeGauges();
    return this.registry.metrics();
  }

  reset(): void {
    this.httpRequestsTotal.reset();
    this.httpRequestDurationSeconds.reset();
    this.businessErrorsTotal.reset();
  }

  /**
   * Espelha os snapshots in-memory preexistentes como gauges. Sao derivados,
   * nao uma segunda contagem: o valor vem sempre do `MetricsRegistryService`.
   */
  private async syncRuntimeGauges(): Promise<void> {
    const http = this.metrics.getHttpSnapshot();
    const db = this.metrics.getDbSnapshot();
    const worker = this.metrics.getWorkerSnapshot();
    const failures = this.metrics.getFailureCounters();

    this.setGauge('observability_http_requests_recorded_total', 'Requisicoes HTTP registradas no registry in-memory.', http.total);
    this.setGauge('observability_http_errors_recorded_total', 'Requisicoes HTTP com erro no registry in-memory.', http.errors);
    this.setGauge('observability_db_queries_total', 'Consultas de banco registradas no registry in-memory.', db.total);
    this.setGauge('observability_db_errors_total', 'Consultas de banco com erro no registry in-memory.', db.errors);
    this.setGauge('observability_storage_failures_total', 'Falhas de storage.', failures.storageFailures);
    this.setGauge('observability_notification_failures_total', 'Falhas de notificacao.', failures.notificationFailures);
    this.setGauge('observability_integration_failures_total', 'Falhas de integracao.', failures.integrationFailures);
    this.setGauge('observability_worker_in_flight', 'Jobs de worker em execucao.', worker.inFlight);
    this.setGauge('observability_worker_dead_lettered_total', 'Jobs de worker em dead letter.', worker.deadLettered);

    const lastActivity = this.metrics.getWorkerLastActivityAt();
    if (lastActivity) {
      const parsed = Date.parse(lastActivity);
      if (!Number.isNaN(parsed)) {
        this.setGauge(
          'observability_worker_last_activity_timestamp_seconds',
          'Timestamp Unix da ultima atividade do worker.',
          Math.floor(parsed / 1000),
        );
      }
    }
  }

  private setGauge(name: string, help: string, value: number): void {
    let gauge = this.registry.getSingleMetric(name);
    if (!gauge) {
      gauge = new Gauge({ name, help, registers: [this.registry] });
    }
    (gauge as Gauge<string>).set(value);
  }

  getRegistry(): Registry {
    return this.registry;
  }
}

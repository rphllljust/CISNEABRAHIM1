import { describe, expect, it } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import type { DatabaseService } from '../../infrastructure/database/database.service';
import { evaluateTechnicalAlertConditions } from '../alerts/technical-alert.engine';
import { loadTechnicalAlertPolicy } from '../alerts/technical-alert-policy';
import {
  TECHNICAL_ALERT_TYPES,
  type TechnicalAlertConditionInput,
} from '../alerts/technical-alert.types';
import type { MetricsRegistryService } from '../metrics/metrics-registry.service';
import {
  PlatformMetricsCollectionError,
  PlatformMetricsCollectorService,
} from './platform-metrics-collector.service';

type Counted = {
  workerPending: string;
  outboxPending: string;
  outboxFailed: string;
  notificationFailures: string;
  integrationFailures: string;
  erpFailures: string;
  trackingFailures: string;
};

const COUNTS: Counted = {
  workerPending: '4',
  outboxPending: '7',
  outboxFailed: '1',
  notificationFailures: '2',
  integrationFailures: '3',
  erpFailures: '5',
  trackingFailures: '6',
};

function fakeDatabase(pool: { query: Pool['query'] }): DatabaseService {
  return { getConnection: () => ({ pool: pool as Pool }) } as unknown as DatabaseService;
}

function fakeMetrics(): MetricsRegistryService {
  return {
    getFailureCounters: () => ({
      storageFailures: 0,
      notificationFailures: 0,
      integrationFailures: 0,
    }),
  } as unknown as MetricsRegistryService;
}

function resolveCount(sql: string, params: unknown[], counts: Counted = COUNTS): string {
  if (sql.includes('plt.background_jobs')) return counts.workerPending;
  if (sql.includes('ntf.delivery_attempts')) return counts.notificationFailures;
  if (sql.includes('int.integration_inbox')) {
    if (sql.includes('provider ILIKE')) {
      return params.includes('%erp%') ? counts.erpFailures : counts.trackingFailures;
    }
    return counts.integrationFailures;
  }
  if (sql.includes('evt.outbox_events')) {
    return params[0] === 'FAILED' ? counts.outboxFailed : counts.outboxPending;
  }
  return '0';
}

function countResult(
  sql: string,
  params: unknown[],
  counts?: Counted,
): QueryResult<{ count: string }> {
  return { rows: [{ count: resolveCount(sql, params, counts) }] } as QueryResult<{
    count: string;
  }>;
}

function countingPool(counts: Counted = COUNTS): { query: Pool['query'] } {
  return {
    query: ((sql: string, params: unknown[] = []) =>
      Promise.resolve(countResult(sql, params, counts))) as unknown as Pool['query'],
  };
}

describe('PlatformMetricsCollectorService.collectBacklogs', () => {
  it('coleta as contagens reais de backlog (produtor sinalizado por métrica)', async () => {
    const collector = new PlatformMetricsCollectorService(fakeDatabase(countingPool()), fakeMetrics());

    const snapshot = await collector.collectBacklogs();

    expect(snapshot).toEqual({
      workerPending: 4,
      outboxPending: 7,
      outboxFailed: 1,
      notificationFailures: 2,
      integrationFailures: 3,
      erpFailures: 5,
      trackingFailures: 6,
    });
    expect(collector.getLastCollectionError()).toBeNull();
  });

  it('zero real é zero medido (query OK, COUNT=0) e NÃO gera diagnóstico', async () => {
    const zeros: Counted = {
      workerPending: '0',
      outboxPending: '0',
      outboxFailed: '0',
      notificationFailures: '0',
      integrationFailures: '0',
      erpFailures: '0',
      trackingFailures: '0',
    };
    const collector = new PlatformMetricsCollectorService(
      fakeDatabase(countingPool(zeros)),
      fakeMetrics(),
    );

    const snapshot = await collector.collectBacklogs();

    expect(Object.values(snapshot).every((value) => value === 0)).toBe(true);
    expect(collector.getLastCollectionError()).toBeNull();
  });

  it('falha de query (ex.: schema drift / enum inválido) propaga erro e registra diagnóstico — nunca 0 silencioso', async () => {
    const failingPool = {
      query: () =>
        Promise.reject(
          Object.assign(new Error('invalid input value for enum bil.billing_record_status'), {
            code: '22P02',
          }),
        ),
    } as unknown as { query: Pool['query'] };
    const collector = new PlatformMetricsCollectorService(fakeDatabase(failingPool), fakeMetrics());

    await expect(collector.collectBacklogs()).rejects.toBeInstanceOf(
      PlatformMetricsCollectionError,
    );

    const diagnostic = collector.getLastCollectionError();
    expect(diagnostic).not.toBeNull();
    expect([
      'workerPending',
      'outboxPending',
      'outboxFailed',
      'notificationFailures',
      'integrationFailures',
      'erpFailures',
      'trackingFailures',
    ]).toContain(diagnostic?.metric);
    expect(diagnostic?.message).toContain('invalid input value for enum');
    expect(diagnostic?.collectedAt).toEqual(expect.any(String));
  });

  it('sem conexão configurada produz erro/diagnóstico (nunca backlog zerado fabricado)', async () => {
    const collector = new PlatformMetricsCollectorService(
      { getConnection: () => null } as unknown as DatabaseService,
      fakeMetrics(),
    );

    await expect(collector.collectBacklogs()).rejects.toBeInstanceOf(
      PlatformMetricsCollectionError,
    );
    expect(collector.getLastCollectionError()?.message).toBe('DATABASE_NOT_CONFIGURED');
  });

  it('recuperação: coleta bem-sucedida limpa o diagnóstico anterior na mesma instância', async () => {
    let failing = true;
    const pool = {
      query: ((sql: string, params: unknown[] = []) =>
        failing
          ? Promise.reject(new Error('connection terminated unexpectedly'))
          : Promise.resolve(countResult(sql, params))) as unknown as Pool['query'],
    };
    const collector = new PlatformMetricsCollectorService(fakeDatabase(pool), fakeMetrics());

    await expect(collector.collectBacklogs()).rejects.toBeInstanceOf(
      PlatformMetricsCollectionError,
    );
    expect(collector.getLastCollectionError()).not.toBeNull();

    failing = false;
    await collector.collectBacklogs();
    expect(collector.getLastCollectionError()).toBeNull();
  });
});

describe('Impacto do FALSE ZERO no alertamento técnico', () => {
  it('backlog zerado (fabricado) desarma OUTBOX/ERP/TRACKING/NOTIFICATION: é por isso que a falha não pode virar 0', () => {
    const policy = loadTechnicalAlertPolicy({});
    const base: TechnicalAlertConditionInput = {
      httpErrorRate: null,
      httpRequestCount: 0,
      httpLatencyP95Ms: null,
      httpLatencyP99Ms: null,
      dbPoolWaiting: 0,
      dbPoolTotal: 10,
      dbPoolIdle: 10,
      workerPending: 0,
      workerInFlight: 0,
      workerProcessed: 0,
      workerLastActivityAt: new Date().toISOString(),
      outboxPending: 0,
      outboxFailed: 0,
      storageFailures: 0,
      erpFailures: 0,
      trackingFailures: 0,
      erpIntegrationConfigured: true,
      trackingIntegrationConfigured: true,
      notificationFailures: 0,
      backupStatus: 'ok',
      diskUsagePercent: null,
    };

    const breachedTypes = (input: TechnicalAlertConditionInput) =>
      evaluateTechnicalAlertConditions(input, policy)
        .filter((condition) => condition.breached)
        .map((condition) => condition.alertType);

    // Com o FALSE ZERO (falha de medição devolvendo 0) NENHUM destes alertas dispara,
    // mesmo com ERP/rastreio configurados e falhas reais acumuladas na inbox.
    const fabricatedZero = breachedTypes(base);
    expect(fabricatedZero).not.toContain(TECHNICAL_ALERT_TYPES.OutboxBacklog);
    expect(fabricatedZero).not.toContain(TECHNICAL_ALERT_TYPES.ErpFailures);
    expect(fabricatedZero).not.toContain(TECHNICAL_ALERT_TYPES.TrackingFailures);
    expect(fabricatedZero).not.toContain(TECHNICAL_ALERT_TYPES.NotificationFailures);

    // Com a medição real (1 falha já excede o limiar de ERP/rastreio) os alertas disparam.
    const measured = breachedTypes({
      ...base,
      outboxPending: policy.outboxPendingThreshold,
      erpFailures: policy.erpFailureThreshold,
      trackingFailures: policy.trackingFailureThreshold,
      notificationFailures: policy.notificationFailureThreshold,
    });
    expect(measured).toContain(TECHNICAL_ALERT_TYPES.OutboxBacklog);
    expect(measured).toContain(TECHNICAL_ALERT_TYPES.ErpFailures);
    expect(measured).toContain(TECHNICAL_ALERT_TYPES.TrackingFailures);
    expect(measured).toContain(TECHNICAL_ALERT_TYPES.NotificationFailures);
  });
});

import { describe, expect, it } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import type { DatabaseService } from '../../infrastructure/database/database.service';
import {
  BusinessMetricsCollectionError,
  BusinessMetricsCollectorService,
} from './business-metrics-collector.service';

function fakeDatabase(pool: { query: Pool['query'] }): DatabaseService {
  return { getConnection: () => ({ pool: pool as Pool }) } as unknown as DatabaseService;
}

function rows(query: string): Promise<QueryResult<{ count: string }>> {
  const count = query.includes('deadline_for') ? '3' : '2';
  return Promise.resolve({ rows: [{ count }] } as QueryResult<{ count: string }>);
}

describe('BusinessMetricsCollectorService (serviceOrdersOverdue)', () => {
  it('coleta valor real e zero real (sem FALSE ZERO)', async () => {
    const collector = new BusinessMetricsCollectorService(
      fakeDatabase({ query: ((sql: string) => rows(sql)) as unknown as Pool['query'] }),
    );
    const snap = await collector.collect();
    expect(snap.serviceOrdersOverdue).toBe(3);
    expect(snap.measurementsAging).toBe(2);
    expect(snap.billingAging).toBe(2);
    expect(collector.getLastCollectionError()).toBeNull();
  });

  it('zero real é contado (query OK, zero linhas) e não gera erro', async () => {
    const collector = new BusinessMetricsCollectorService(
      fakeDatabase({
        query: () => Promise.resolve({ rows: [{ count: '0' }] } as QueryResult<{ count: string }>),
      }),
    );
    const snap = await collector.collect();
    expect(snap.serviceOrdersOverdue).toBe(0);
    expect(snap.measurementsAging).toBe(0);
    expect(snap.billingAging).toBe(0);
    expect(collector.getLastCollectionError()).toBeNull();
  });

  it('falha de query (ex.: schema drift) propaga erro e registra diagnóstico — nunca 0 silencioso', async () => {
    const failingPool = { query: () => Promise.reject(Object.assign(new Error('column does not exist'), { code: '42703' })) } as unknown as { query: Pool['query'] };
    const collector = new BusinessMetricsCollectorService(fakeDatabase(failingPool));
    await expect(collector.collect()).rejects.toBeInstanceOf(BusinessMetricsCollectionError);
    expect(collector.getLastCollectionError()).not.toBeNull();
    expect(['serviceOrdersOverdue', 'measurementsAging', 'billingAging']).toContain(
      collector.getLastCollectionError()?.metric,
    );
  });

  it('sem conexão configurada produz erro/diagnóstico (não zero)', async () => {
    const collector = new BusinessMetricsCollectorService({
      getConnection: () => null,
    } as unknown as DatabaseService);
    await expect(collector.collect()).rejects.toBeInstanceOf(BusinessMetricsCollectionError);
    expect(collector.getLastCollectionError()?.message).toBe('DATABASE_NOT_CONFIGURED');
  });
});

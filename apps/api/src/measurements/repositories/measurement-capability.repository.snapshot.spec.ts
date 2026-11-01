import { describe, expect, it, vi } from 'vitest';
import { MeasurementCapabilityRepository } from './measurement-capability.repository';
import type { LeakageOrderFactsRow } from './measurement-capability.repository.types';

/**
 * Testa o protocolo do cursor do módulo dono. A integração PostgreSQL existente
 * testa a SQL real; aqui provamos que páginas e rollback não viram projeção
 * parcial, mesmo quando a origem muda durante uma leitura.
 */
function harness(initialCount: number, mutateAfterFirstPage = false) {
  const source = Array.from({ length: initialCount }, (_, index) => ({
    service_order_id: `order-${index}`,
  } as LeakageOrderFactsRow));
  let frozen: LeakageOrderFactsRow[] = [];
  let offset = 0;
  const statements: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    statements.push(sql);
    if (sql.startsWith('DECLARE measurement_leakage_scan')) {
      expect(params).toEqual(['unit-a']);
      frozen = [...source];
    }
    if (sql.startsWith('FETCH FORWARD')) {
      const page = frozen.slice(offset, offset + 250);
      offset += page.length;
      if (mutateAfterFirstPage && offset === 250) {
        source.unshift({ service_order_id: 'new-before-cursor' } as LeakageOrderFactsRow);
        source.push({ service_order_id: 'new-after-cursor' } as LeakageOrderFactsRow);
      }
      return { rows: page };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  const repository = new MeasurementCapabilityRepository({
    getConnection: () => ({ pool }),
  } as never);
  return { repository, statements, release, source };
}

describe('MASTER 001-02 / issue #157 — snapshot cursor PostgreSQL', () => {
  it.each([0, 499, 500, 501, 1500])('lê %i registros sem omitir ou repetir páginas', async (count) => {
    const { repository, statements, release } = harness(count);
    const rows = await repository.listCompletedOrdersForLeakage('unit-a');
    expect(rows).toHaveLength(count);
    expect(new Set(rows.map((row) => row.service_order_id)).size).toBe(count);
    expect(statements).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(statements.some((sql) => sql.startsWith('DECLARE measurement_leakage_scan'))).toBe(true);
    expect(statements.find((sql) => sql.startsWith('DECLARE'))).toContain('so.id ASC');
    expect(statements).toContain('COMMIT');
    expect(statements).not.toContain('ROLLBACK');
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it('mantém snapshot consistente quando há inserções entre FETCHs', async () => {
    const { repository, source } = harness(501, true);
    const rows = await repository.listCompletedOrdersForLeakage('unit-a');
    expect(source).toHaveLength(503);
    expect(rows).toHaveLength(501);
    expect(rows[0]?.service_order_id).toBe('order-0');
    expect(rows[500]?.service_order_id).toBe('order-500');
    expect(rows.some((row) => row.service_order_id.startsWith('new-'))).toBe(false);
  });

  it('aborta com rollback antes de publicar dados incompletos quando ultrapassa o teto', async () => {
    const { repository, statements, release } = harness(50_001);
    await expect(repository.listCompletedOrdersForLeakage('unit-a'))
      .rejects.toThrow('MEASUREMENT_LEAKAGE_SNAPSHOT_CAP_REACHED');
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(release).toHaveBeenCalledWith(undefined);
  });
});

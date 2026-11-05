import { describe, expect, it, vi } from 'vitest';
import { REPORT_TYPES } from '../domain/report-type';
import { ReportDataService } from './report-data.service';

const actor = { identityId: 'identity-a', sessionId: 'session-a' };

function buildHarness() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const service = new ReportDataService(
    { getConnection: () => ({ pool: { query } }) } as never,
    { findActiveGrants: vi.fn().mockResolvedValue([{ id: 'grant-a' }]) } as never,
    {
      buildServiceOrderListFilter: vi.fn().mockReturnValue({
        clause: 'unit_id = $1',
        params: ['unit-a'],
      }),
      buildPhysicalAssetListFilter: vi.fn().mockReturnValue({
        clause: 'a.unit_id = $1',
        params: ['unit-a'],
      }),
    } as never,
    {} as never,
    {} as never,
  );
  return { service, query };
}

describe('ReportDataService SQL authorization and filter aliases', () => {
  it.each([
    [REPORT_TYPES.Measurements, 'so', 'm', 'APPROVED'],
    [REPORT_TYPES.Billing, 'br', 'br', 'PREPARED'],
  ] as const)('keeps scope and status/date filters qualified for %s', async (kind, grantAlias, rowAlias, status) => {
    const { service, query } = buildHarness();
    await service.loadRows(actor, kind, {
      unitId: 'unit-a',
      status,
      from: '2026-01-01',
      to: '2026-02-01',
    }, 20, 0);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain(`${grantAlias}.unit_id = $1`);
    expect(sql).toContain(`${rowAlias}.unit_id = $4`);
    expect(sql).toContain(`${rowAlias}.created_at >= $2`);
    expect(sql).toContain(`${rowAlias}.created_at < $3`);
    expect(sql).toContain(`${rowAlias}.status = $5`);
    expect(sql).not.toMatch(/\\b(?:so|br|bd|m)\\.(?:so|br|bd|m)\\./);
  });

  it('keeps document and asset scope in their respective read-model alias', async () => {
    const receipts = buildHarness();
    await receipts.service.loadRows(
      actor, REPORT_TYPES.Receipts, { unitId: 'unit-a' }, 20, 0,
    );
    const receiptSql = receipts.query.mock.calls[0]?.[0] as string;
    expect(receiptSql).toContain('bd.unit_id = $1');
    expect(receiptSql).toContain('bd.unit_id = $2');
    expect(receiptSql).not.toContain('bd.bd.');

    const assets = buildHarness();
    await assets.service.loadRows(
      actor, REPORT_TYPES.AssetUtilization, { unitId: 'unit-a' }, 20, 0,
    );
    const assetSql = assets.query.mock.calls[0]?.[0] as string;
    expect(assetSql).toContain('a.unit_id = $1');
    expect(assetSql).toContain('a.unit_id = $2');
    expect(assetSql).not.toContain('a.a.');
  });
  it('binds every report filter and pagination value without SQL interpolation', async () => {
    const { service, query } = buildHarness();
    const clientId = '00000000-0000-4000-8000-000000000011';
    const serviceDefinitionId = '00000000-0000-4000-8000-000000000012';
    await service.loadRows(actor, REPORT_TYPES.ServiceOrdersByPeriod, {
      from: '2026-01-01',
      to: '2026-02-01',
      unitId: 'unit-a',
      clientId,
      serviceDefinitionId,
      status: 'COMPLETED',
    }, 20, 10);

    const sql = query.mock.calls[0]?.[0] as string;
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(sql).toContain('so.unit_id = $1');
    expect(sql).toContain('so.created_at >= $2');
    expect(sql).toContain('so.created_at < $3');
    expect(sql).toContain('so.unit_id = $4');
    expect(sql).toContain('so.client_id = $5::uuid');
    expect(sql).toContain('so.service_definition_id = $6::uuid');
    expect(sql).toContain('so.status = $7');
    expect(sql).toContain('LIMIT $8 OFFSET $9');
    expect(params).toEqual([
      'unit-a',
      new Date('2026-01-01'),
      new Date('2026-02-01'),
      'unit-a',
      clientId,
      serviceDefinitionId,
      'COMPLETED',
      20,
      10,
    ]);
  });

});

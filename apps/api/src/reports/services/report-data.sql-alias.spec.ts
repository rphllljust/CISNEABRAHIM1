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
});

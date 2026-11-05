import { describe, expect, it, vi } from 'vitest';
import { REPORT_POLICY, REPORT_TYPES } from '../domain/report-type';
import { ReportDataService } from './report-data.service';

const actor = { identityId: 'actor', sessionId: 'session' };
const row = { orderNumber: 'SO-ONE' };
const fullBatch = Array.from({ length: REPORT_POLICY.batchSize }, () => row);

function serviceWithRows(overflow: boolean) {
  const service = new ReportDataService(
    {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  const load = vi.spyOn(service, 'loadRows').mockImplementation(async (
    _actor,
    _reportType,
    _filters,
    limit,
    offset,
  ) => {
    if (limit === 1 && offset === REPORT_POLICY.maxRows) {
      return overflow ? [row] : [];
    }
    return fullBatch;
  });
  return { service, load };
}

describe('ReportDataService export boundaries', () => {
  it('fails rather than silently truncating authorized exports above the configured limit', async () => {
    const { service, load } = serviceWithRows(true);
    let emitted = 0;
    await expect(
      service.streamAllRows(actor, REPORT_TYPES.ServiceOrdersByPeriod, {}, async (rows) => {
        emitted += rows.length;
      }),
    ).rejects.toThrow('REPORT_EXPORT_ROW_LIMIT_EXCEEDED');

    expect(emitted).toBe(REPORT_POLICY.maxRows);
    expect(load).toHaveBeenLastCalledWith(
      actor,
      REPORT_TYPES.ServiceOrdersByPeriod,
      {},
      1,
      REPORT_POLICY.maxRows,
    );
  });

  it('accepts exactly the configured limit without inventing an extra record', async () => {
    const { service } = serviceWithRows(false);
    const count = await service.streamAllRows(
      actor, REPORT_TYPES.ServiceOrdersByPeriod, {}, async () => undefined,
    );
    expect(count).toBe(REPORT_POLICY.maxRows);
  });
});

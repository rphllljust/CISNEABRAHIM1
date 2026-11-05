import { describe, expect, it, vi } from 'vitest';
import { REPORT_ERROR_CODES } from '../errors/report-error-codes';
import { REPORT_TYPES } from '../domain/report-type';
import { ReportExportAccessService } from './report-export-access.service';

const actor = { identityId: 'user-1', sessionId: 'session-1' };

function setup() {
  const exports = {
    findByIdForActor: vi.fn().mockResolvedValue({
      id: 'exp-1',
      report_type: REPORT_TYPES.ServiceOrdersByPeriod,
      status: 'COMPLETED',
      storage_key: 'private/export.csv',
    }),
    listForActor: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    markCancelled: vi.fn(),
  };
  const authz = { findActiveGrants: vi.fn().mockResolvedValue([]) };
  const storage = { getObject: vi.fn() };
  const service = new ReportExportAccessService(
    exports as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    storage as never,
    {} as never,
    authz as never,
  );
  return { service, exports, authz, storage };
}

describe('Report-to-Record export authorization after grant revocation', () => {
  it('does not return metadata or export bytes to the original requester after their report grant is revoked', async () => {
    const { service, exports, storage } = setup();
    await expect(service.getExport(actor, 'exp-1'))
      .rejects.toMatchObject({ code: REPORT_ERROR_CODES.ACCESS_DENIED });
    await expect(service.downloadExport(actor, 'exp-1'))
      .rejects.toMatchObject({ code: REPORT_ERROR_CODES.ACCESS_DENIED });
    await expect(service.cancelExport(actor, 'exp-1'))
      .rejects.toMatchObject({ code: REPORT_ERROR_CODES.ACCESS_DENIED });
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(exports.markCancelled).not.toHaveBeenCalled();
  });

  it('does not publish a list of historical reports when the actor has no current report grant', async () => {
    const { service, exports } = setup();
    await expect(service.listExports(actor, {}))
      .rejects.toMatchObject({ code: REPORT_ERROR_CODES.ACCESS_DENIED });
    expect(exports.listForActor).not.toHaveBeenCalled();
  });

  it('keeps pagination and total authoritative for the currently accessible report types', async () => {
    const { service, exports, authz } = setup();
    authz.findActiveGrants.mockResolvedValue([{
      identity_id: actor.identityId,
    }]);
    const list = await service.listExports(actor, { page: 1, pageSize: 10 });
    expect(list).toEqual({ items: [], total: 0, page: 1, pageSize: 10 });
    expect(exports.listForActor).toHaveBeenCalledWith({
      identityId: actor.identityId,
      page: 1,
      pageSize: 10,
      status: undefined,
      reportType: undefined,
      allowedReportTypes: Object.values(REPORT_TYPES),
    });
  });
});

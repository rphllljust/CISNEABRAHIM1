import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AssetHttpException } from '../errors/asset-http.exception';
import { PhysicalAssetDocumentsService } from './physical-asset-documents.service';

const actor = {
  identityId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
};
const assetId = '33333333-3333-4333-8333-333333333333';
const documentId = '44444444-4444-4444-8444-444444444444';

function fixture() {
  const assets = { getById: vi.fn().mockResolvedValue({ id: assetId, unitId: 'unit-a' }) };
  const links = {
    listAuthorized: vi.fn().mockResolvedValue({ items: [], scope: 'RECENT_WINDOW' }),
    attachAuthorized: vi.fn().mockResolvedValue({ attached: true }),
  };
  const repository = {
    findActiveGrants: vi.fn().mockResolvedValue([{
      scope_type: 'GLOBAL',
      resource_id: null,
      resource_type: 'resources:asset',
    }]),
    findRoleDerivedActionRows: vi.fn().mockResolvedValue([]),
  };
  const pdp = { decide: vi.fn().mockResolvedValue({ result: 'ALLOW' }) };
  const service = new PhysicalAssetDocumentsService(
    assets as never, links as never, repository as never, pdp as never,
  );
  return { assets, links, repository, pdp, service };
}

describe('physical asset document relations: dual business authority', () => {
  it('never reads GED when asset READ denies the actor', async () => {
    const f = fixture();
    f.assets.getById.mockRejectedValue(
      new AssetHttpException(HttpStatus.FORBIDDEN, 'ASSET_DENIED', 'Access denied.'),
    );
    await expect(f.service.list(actor, assetId)).rejects.toMatchObject({ status: 403 });
    expect(f.links.listAuthorized).not.toHaveBeenCalled();
  });

  it('does not create a GED link unless the actor also has asset UPDATE', async () => {
    const f = fixture();
    f.pdp.decide.mockResolvedValue({ result: 'DENY' });
    await expect(f.service.attach(actor, assetId, documentId)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.links.attachAuthorized).not.toHaveBeenCalled();
  });

  it('requires direct or role-derived resource-scoped grant even when PDP allows', async () => {
    const f = fixture();
    f.repository.findActiveGrants.mockResolvedValue([]);
    await expect(f.service.attach(actor, assetId, documentId)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.links.attachAuthorized).not.toHaveBeenCalled();
  });

  it('delegates to GED only after resolving authorized asset identity and unit', async () => {
    const f = fixture();
    await f.service.attach(actor, assetId, documentId);
    expect(f.links.attachAuthorized).toHaveBeenCalledWith(actor, assetId, 'unit-a', documentId);
  });
});

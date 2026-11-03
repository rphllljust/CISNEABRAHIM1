import { describe, expect, it, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { DocumentHttpException } from '../errors/document-http.exception';
import { DocumentAssetLinksService } from './document-asset-links.service';

const actor = {
  identityId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
};
const assetId = '33333333-3333-4333-8333-333333333333';
const documentId = '44444444-4444-4444-8444-444444444444';

function row(unit = 'unit-a', id = documentId) {
  return {
    id,
    title: 'Documento autorizado',
    unit_id: unit,
    category_code: 'GENERAL',
    classification_code: 'INTERNAL',
    status: 'ACTIVE',
    current_version_number: 2,
    created_at: '2026-11-03T00:00:00Z',
    updated_at: '2026-11-03T00:00:00Z',
    created_by_identity_id: actor.identityId,
    updated_by_identity_id: actor.identityId,
  };
}

function fixture() {
  const links = {
    listLinkedDocuments: vi.fn().mockResolvedValue([row()]),
    attach: vi.fn().mockImplementation(async (
      _assetId: unknown,
      _documentId: unknown,
      _identityId: unknown,
      auditOnCreate: (transaction: unknown) => Promise<void>,
    ) => {
      await auditOnCreate({});
      return true;
    }),
  };
  const documents = { findDocumentById: vi.fn().mockResolvedValue(row()) };
  const authz = {
    assertListAction: vi.fn().mockResolvedValue(undefined),
    assertRecordAction: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { recordCritical: vi.fn().mockResolvedValue('audit-id') };
  const service = new DocumentAssetLinksService(
    links as never, documents as never, authz as never, audit as never,
  );
  return { service, links, documents, authz, audit };
}

describe('E05/E06 document asset links, authorization before serialization', () => {
  it('denies a list before querying linked records when GED list is unavailable', async () => {
    const f = fixture();
    f.authz.assertListAction.mockRejectedValue(new DocumentHttpException(
      HttpStatus.FORBIDDEN, 'DOCUMENT_ACCESS_DENIED', 'Denied.',
    ));
    await expect(f.service.listAuthorized(actor, assetId, 'unit-a')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(f.links.listLinkedDocuments).not.toHaveBeenCalled();
  });

  it('does not expose metadata for a document with denied READ', async () => {
    const f = fixture();
    f.authz.assertRecordAction.mockRejectedValue(new DocumentHttpException(
      HttpStatus.FORBIDDEN, 'DOCUMENT_ACCESS_DENIED', 'Denied.',
    ));
    const response = await f.service.listAuthorized(actor, assetId, 'unit-a');
    expect(f.links.listLinkedDocuments).toHaveBeenCalledTimes(1);
    expect(f.links.listLinkedDocuments).toHaveBeenCalledWith(assetId, 'unit-a', 200);
    expect(response.items).toEqual([]);
    expect(JSON.stringify(response)).not.toContain('Documento autorizado');
    expect(JSON.stringify(response)).not.toContain(documentId);
  });

  it('never exposes a linked document belonging to another unit', async () => {
    const f = fixture();
    f.links.listLinkedDocuments.mockResolvedValue([row('unit-b')]);
    const response = await f.service.listAuthorized(actor, assetId, 'unit-a');
    expect(response.items).toEqual([]);
    expect(f.authz.assertRecordAction).not.toHaveBeenCalled();
  });

  it('checks document READ and UPLOAD_VERSION before writing a link', async () => {
    const f = fixture();
    const response = await f.service.attachAuthorized(actor, assetId, 'unit-a', documentId);
    expect(response.attached).toBe(true);
    expect(f.authz.assertRecordAction).toHaveBeenCalledTimes(2);
    expect(f.links.attach).toHaveBeenCalledWith(assetId, documentId, actor.identityId);
    expect(f.audit.recordCritical).toHaveBeenCalledTimes(1);
  });

  it('requires a critical audit for a successful link and propagates audit failures', async () => {
    const f = fixture();
    f.audit.recordCritical.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.service.attachAuthorized(actor, assetId, 'unit-a', documentId))
      .rejects.toThrow('audit unavailable');
    expect(f.audit.recordCritical).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-unit links without persisting them', async () => {
    const f = fixture();
    f.documents.findDocumentById.mockResolvedValue(row('unit-b'));
    await expect(f.service.attachAuthorized(actor, assetId, 'unit-a', documentId)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(f.links.attach).not.toHaveBeenCalled();
  });

  it('does not persist when document manage capability is denied', async () => {
    const f = fixture();
    f.authz.assertRecordAction.mockRejectedValue(new DocumentHttpException(
      HttpStatus.FORBIDDEN, 'DOCUMENT_ACCESS_DENIED', 'Denied.',
    ));
    await expect(f.service.attachAuthorized(actor, assetId, 'unit-a', documentId)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(f.links.attach).not.toHaveBeenCalled();
  });
});

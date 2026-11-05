import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DOCUMENT_ERROR_CODES } from '../../documents/errors/document-error-codes';
import { DocumentHttpException } from '../../documents/errors/document-http.exception';
import { REQUESTS_ERROR_CODES } from '../errors/requests-error-codes';
import { ServiceRequestsDocumentEvidenceService } from './service-requests-document-evidence.service';

const actor = { identityId: 'actor-1', sessionId: 'session-1' };

describe('Requests to GED evidence owner contract', () => {
  it('allows only documents readable by this actor in the request unit', async () => {
    const getById = vi.fn().mockResolvedValue({ id: 'doc-1', unitId: 'unit-1' });
    const owner = new ServiceRequestsDocumentEvidenceService({ getById } as never);
    await expect(owner.canRead(actor, 'doc-1', 'unit-1')).resolves.toBe(true);
    await expect(owner.canRead(actor, 'doc-1', 'unit-2')).resolves.toBe(false);
    expect(getById).toHaveBeenCalledWith(actor, 'doc-1');
  });

  it('never exposes denied or missing document links through a service request', async () => {
    for (const [status, code] of [
      [HttpStatus.FORBIDDEN, DOCUMENT_ERROR_CODES.DENIED],
      [HttpStatus.NOT_FOUND, DOCUMENT_ERROR_CODES.NOT_FOUND],
    ] as const) {
      const error = new DocumentHttpException(status, code, 'Document not available');
      const owner = new ServiceRequestsDocumentEvidenceService({
        getById: vi.fn().mockRejectedValue(error),
      } as never);
      await expect(owner.canRead(actor, 'protected-doc', 'unit-1')).resolves.toBe(false);
      await expect(owner.requireReadable(actor, 'protected-doc', 'unit-1'))
        .rejects.toMatchObject({ code: REQUESTS_ERROR_CODES.DOCUMENT_NOT_FOUND });
    }
  });

  it('propagates owner infrastructure failure instead of treating the document list as empty', async () => {
    const unavailable = new DocumentHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      DOCUMENT_ERROR_CODES.STORAGE_FAILURE,
      'Storage unavailable',
    );
    const owner = new ServiceRequestsDocumentEvidenceService({
      getById: vi.fn().mockRejectedValue(unavailable),
    } as never);
    await expect(owner.canRead(actor, 'doc-1', 'unit-1')).rejects.toBe(unavailable);
  });
});

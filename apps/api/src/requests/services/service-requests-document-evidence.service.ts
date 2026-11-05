import { HttpStatus, Injectable } from '@nestjs/common';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { DocumentHttpException } from '../../documents/errors/document-http.exception';
import { DocumentsAccessService } from '../../documents/services/documents-access.service';
import { serviceRequestsDocumentNotFound } from './service-requests-access.errors';

/**
 * Requests never decides document access from a shared unit alone. The GED
 * owner is authoritative for classification, scope and per-record read rights.
 * A denied or absent document has the same non-enumerable outcome.
 */
@Injectable()
export class ServiceRequestsDocumentEvidenceService {
  constructor(private readonly documents: DocumentsAccessService) {}

  async canRead(actor: IdentityAuthzContext, documentId: string, requestUnitId: string): Promise<boolean> {
    try {
      const document = await this.documents.getById(actor, documentId);
      return document.unitId === requestUnitId;
    } catch (error) {
      if (error instanceof DocumentHttpException &&
          (error.getStatus() === HttpStatus.FORBIDDEN || error.getStatus() === HttpStatus.NOT_FOUND)) {
        return false;
      }
      // Infrastructure errors are not empty evidence: preserve error state.
      throw error;
    }
  }

  async requireReadable(actor: IdentityAuthzContext, documentId: string, requestUnitId: string): Promise<void> {
    if (!(await this.canRead(actor, documentId, requestUnitId))) {
      throw serviceRequestsDocumentNotFound();
    }
  }
}

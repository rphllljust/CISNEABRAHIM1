import { HttpStatus, Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { DocumentHttpException } from '../errors/document-http.exception';
import { DocumentAssetLinksRepository } from '../repositories/document-asset-links.repository';
import { DocumentsRepository } from '../repositories/documents.repository';
import {
  assertNoStorageKeyLeak,
  toDocumentResponse,
  type DocumentResponse,
} from '../serializers/documents-response.serializer';
import { DocumentsAccessAuthz } from './documents-access.authz';
import { documentsAccessDenied, documentsAccessNotFound } from './documents-access.errors';
import { assertValidDocumentId } from './documents-input-resolution';

/** Public GED contract for E05/E06. No direct doc-table access by Resources. */
@Injectable()
export class DocumentAssetLinksService {
  constructor(
    private readonly links: DocumentAssetLinksRepository,
    private readonly documents: DocumentsRepository,
    private readonly authz: DocumentsAccessAuthz,
    private readonly audit: SecurityAuditService,
  ) {}

  async listAuthorized(
    actor: IdentityAuthzContext,
    assetId: string,
    assetUnitId: string,
  ): Promise<{ items: DocumentResponse[]; scope: 'RECENT_WINDOW' }> {
    await this.authz.assertListAction(actor);
    // Bound PDP work; never reveal raw counts or IDs of denied documents.
    const candidates = await this.links.listLinkedDocuments(assetId, assetUnitId, 200);
    const items: DocumentResponse[] = [];
    for (const document of candidates) {
      // Defense in depth: no candidate from another unit can become visible,
      // even if a future repository change weakens its unit predicate.
      if (document.unit_id !== assetUnitId) continue;
      try {
        await this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.DocumentsDocumentRead, document);
      } catch (error) {
        if (error instanceof DocumentHttpException && error.getStatus() === Number(HttpStatus.FORBIDDEN)) {
          continue;
        }
        throw error;
      }
      items.push(toDocumentResponse(document));
      if (items.length === 20) break;
    }
    // Constant scope disclosure: never reveal whether extra DENIED links exist.
    const response = { items, scope: 'RECENT_WINDOW' as const };
    assertNoStorageKeyLeak(response);
    return response;
  }

  async attachAuthorized(
    actor: IdentityAuthzContext,
    assetId: string,
    assetUnitId: string,
    documentId: string,
  ): Promise<{ document: DocumentResponse; attached: boolean }> {
    assertValidDocumentId(documentId);
    const document = await this.documents.findDocumentById(documentId);
    if (!document) throw documentsAccessNotFound();
    // Both resource ownership scopes MUST match, even for GLOBAL grants.
    if (document.unit_id !== assetUnitId) throw documentsAccessDenied();
    await this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.DocumentsDocumentRead, document);
    await this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.DocumentsDocumentUploadVersion, document);
    const attached = await this.links.attach(
      assetId, documentId, actor.identityId,
      async (transaction) => {
        await this.audit.recordCritical({
          actorIdentityId: actor.identityId,
          actorSessionId: actor.sessionId,
          action: SECURITY_AUDIT_ACTIONS.DocumentsDocumentLinkAsset,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.DocumentsDocument,
          resourceId: documentId,
          outcome: SECURITY_AUDIT_OUTCOMES.Success,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
          metadata: { physicalAssetId: assetId, unitId: assetUnitId },
        }, transaction);
      },
    );
    const response = { document: toDocumentResponse(document), attached };
    assertNoStorageKeyLeak(response);
    return response;
  }
}

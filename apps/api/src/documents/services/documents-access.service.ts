import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { escapeLikeWildcards } from '../../search/domain/search-query-normalizer';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  DOCUMENT_CLASSIFICATIONS,
  DOCUMENT_CATEGORIES,
  isDocumentCategory,
  MAX_FILE_SIZE_BYTES,
  MAX_VERSIONS_PER_DOCUMENT,
} from '../domain/document-categories';
import { validateUploadedFile } from '../domain/file-validation';
import type { CreateDocumentUploadInput, ListDocumentsQuery, UploadedFileInput } from '../dto/documents.dto';
import { DocumentsRepository } from '../repositories/documents.repository';
import {
  assertNoStorageKeyLeak,
  toDocumentResponse,
  toDocumentVersionResponse,
  type DocumentResponse,
  type DocumentVersionResponse,
} from '../serializers/documents-response.serializer';
import { createPersistWithCompensation } from './document-upload-coordinator';
import { DownloadTokenService } from '../storage/download-token.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { EndpointRateLimitService } from '../../security/services/endpoint-rate-limit.service';
import { DocumentsAccessAuthz } from './documents-access.authz';
import {
  documentsAccessDenied,
  documentsAccessNotFound,
  documentsDownloadTokenExpired,
  documentsDownloadTokenInvalid,
  documentsFileValidationError,
  documentsInvalidInput,
  documentsMaxVersionsReached,
  documentsStorageFailure,
  documentsUnitNotRegistered,
  documentsVersionNotFound,
} from './documents-access.errors';
import { assertValidDocumentId } from './documents-input-resolution';

@Injectable()
export class DocumentsAccessService {
  constructor(
    private readonly documentsRepository: DocumentsRepository,
    private readonly authz: DocumentsAccessAuthz,
    private readonly scopeEnforcement: ScopeEnforcementService,
    private readonly securityAudit: SecurityAuditService,
    private readonly objectStorage: ObjectStorageService,
    private readonly downloadTokens: DownloadTokenService,
    private readonly endpointRateLimit: EndpointRateLimitService,
  ) {}

  async createWithUpload(
    actor: IdentityAuthzContext,
    metadata: CreateDocumentUploadInput,
    file: UploadedFileInput,
  ): Promise<{ document: DocumentResponse; version: DocumentVersionResponse }> {
    this.endpointRateLimit.assertAllowed('upload', actor.identityId);
    await this.authz.assertCreateAction(actor, metadata.unitId);
    await this.assertUnitRegistered(metadata.unitId);
    this.assertSingleFile(file);

    const validation = await validateUploadedFile({
      buffer: file.buffer,
      filename: file.filename,
      declaredMime: file.mimetype,
      category: metadata.categoryCode,
      maxSizeBytes: MAX_FILE_SIZE_BYTES,
    });
    if (!validation.ok) {
      throw documentsFileValidationError(validation.reason);
    }

    try {
      const persisted = await createPersistWithCompensation(
        this.objectStorage,
        this.downloadTokens,
        this.documentsRepository,
        {
          title: metadata.title,
          categoryCode: metadata.categoryCode,
          classificationCode: metadata.classificationCode,
          unitId: metadata.unitId,
          actorIdentityId: actor.identityId,
          sha256: validation.sha256,
          mimeType: validation.mime,
          originalFilename: file.filename,
          buffer: file.buffer,
        },
      );

      const document = await this.documentsRepository.findDocumentById(persisted.documentId);
      const version = await this.documentsRepository.findVersion(
        persisted.documentId,
        persisted.versionNumber,
      );
      if (!document || !version) {
        throw documentsAccessNotFound();
      }

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.DocumentsDocumentCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.DocumentsDocument,
        resourceId: document.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification:
          metadata.classificationCode === DOCUMENT_CLASSIFICATIONS.Restricted
            ? SECURITY_AUDIT_CLASSIFICATIONS.Critical
            : SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: {
          versionNumber: version.version_number,
          sha256: version.sha256_hash,
        },
      });

      const response = {
        document: toDocumentResponse(document),
        version: toDocumentVersionResponse(version, document.current_version_number),
      };
      assertNoStorageKeyLeak(response);
      return response;
    } catch (error) {
      if (error instanceof Error && error.message === 'STORAGE_PUT_FAILED') {
        throw documentsStorageFailure();
      }
      throw error;
    }
  }

  async uploadVersion(
    actor: IdentityAuthzContext,
    documentId: string,
    file: UploadedFileInput,
  ): Promise<DocumentVersionResponse> {
    this.endpointRateLimit.assertAllowed('upload', actor.identityId);
    assertValidDocumentId(documentId);
    const document = await this.documentsRepository.findDocumentById(documentId);
    if (!document) {
      throw documentsAccessNotFound();
    }

    await this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.DocumentsDocumentUploadVersion, document);
    this.assertSingleFile(file);

    const versionCount = await this.documentsRepository.countVersions(documentId);
    if (versionCount >= MAX_VERSIONS_PER_DOCUMENT) {
      throw documentsMaxVersionsReached();
    }

    const validation = await validateUploadedFile({
      buffer: file.buffer,
      filename: file.filename,
      declaredMime: file.mimetype,
      category: isDocumentCategory(document.category_code)
        ? document.category_code
        : DOCUMENT_CATEGORIES.General,
      maxSizeBytes: MAX_FILE_SIZE_BYTES,
    });
    if (!validation.ok) {
      throw documentsFileValidationError(validation.reason);
    }

    const persisted = await createPersistWithCompensation(
      this.objectStorage,
      this.downloadTokens,
      this.documentsRepository,
      {
        documentId,
        categoryCode: document.category_code,
        classificationCode: document.classification_code,
        unitId: document.unit_id,
        actorIdentityId: actor.identityId,
        sha256: validation.sha256,
        mimeType: validation.mime,
        originalFilename: file.filename,
        buffer: file.buffer,
      },
    );

    const version = await this.documentsRepository.findVersion(
      persisted.documentId,
      persisted.versionNumber,
    );
    const refreshed = await this.documentsRepository.findDocumentById(documentId);
    if (!version || !refreshed) {
      throw documentsAccessNotFound();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.DocumentsDocumentUploadVersion,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.DocumentsDocument,
      resourceId: documentId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { versionNumber: version.version_number },
    });

    const response = toDocumentVersionResponse(version, refreshed.current_version_number);
    assertNoStorageKeyLeak(response);
    return response;
  }

  async getById(actor: IdentityAuthzContext, documentId: string): Promise<DocumentResponse> {
    assertValidDocumentId(documentId);
    const document = await this.documentsRepository.findDocumentById(documentId);
    if (!document) {
      throw documentsAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.DocumentsDocumentRead, document);
    const response = toDocumentResponse(document);
    assertNoStorageKeyLeak(response);
    return response;
  }

  async list(
    actor: IdentityAuthzContext,
    query: ListDocumentsQuery,
  ): Promise<{ items: DocumentResponse[]; limit: number; offset: number }> {
    const grants = await this.authz.findListGrants(actor);
    const scopeFilter = this.scopeEnforcement.buildDocumentListFilter(grants);
    if (scopeFilter.clause === 'FALSE') {
      throw documentsAccessDenied();
    }

    const clauses = [scopeFilter.clause === 'TRUE' ? 'TRUE' : scopeFilter.clause];
    const params = [...scopeFilter.params];

    if (query.unitId) {
      params.push(query.unitId);
      clauses.push(`unit_id = $${params.length}`);
    }
    if (query.categoryCode) {
      params.push(query.categoryCode);
      clauses.push(`category_code = $${params.length}`);
    }
    if (query.q) {
      // Busca por titulo em qualquer posicao, com os curingas do operador neutralizados: o termo
      // viaja como parametro e `%`/`_` digitados sao texto literal.
      params.push(`%${escapeLikeWildcards(query.q)}%`);
      clauses.push(`title ILIKE $${params.length} ESCAPE '\\'`);
    }

    const items = await this.documentsRepository.listDocuments(
      clauses.join(' AND '),
      params,
      query.limit,
      query.offset,
    );

    const response = {
      items: items.map(toDocumentResponse),
      limit: query.limit,
      offset: query.offset,
    };
    assertNoStorageKeyLeak(response);
    return response;
  }

  async listVersions(
    actor: IdentityAuthzContext,
    documentId: string,
  ): Promise<DocumentVersionResponse[]> {
    assertValidDocumentId(documentId);
    const document = await this.documentsRepository.findDocumentById(documentId);
    if (!document) {
      throw documentsAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.DocumentsDocumentRead, document);

    const versions = await this.documentsRepository.listVersions(documentId);
    const response = versions.map((version) =>
      toDocumentVersionResponse(version, document.current_version_number),
    );
    assertNoStorageKeyLeak(response);
    return response;
  }

  async getVersion(
    actor: IdentityAuthzContext,
    documentId: string,
    versionNumber: number,
  ): Promise<DocumentVersionResponse> {
    assertValidDocumentId(documentId);
    const document = await this.documentsRepository.findDocumentById(documentId);
    if (!document) {
      throw documentsAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.DocumentsDocumentRead, document);

    const version = await this.documentsRepository.findVersion(documentId, versionNumber);
    if (!version) {
      throw documentsVersionNotFound();
    }

    const response = toDocumentVersionResponse(version, document.current_version_number);
    assertNoStorageKeyLeak(response);
    return response;
  }

  async streamContent(
    actor: IdentityAuthzContext,
    documentId: string,
    versionNumber: number,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string; sha256: string }> {
    assertValidDocumentId(documentId);
    const document = await this.documentsRepository.findDocumentById(documentId);
    if (!document) {
      throw documentsAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.DocumentsDocumentDownload, document);

    const version = await this.documentsRepository.findVersionWithStorage(documentId, versionNumber);
    if (!version) {
      throw documentsVersionNotFound();
    }

    const stored = await this.objectStorage.getObject(version.storage_key);
    if (!stored) {
      throw documentsAccessNotFound();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.DocumentsDocumentDownload,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.DocumentsDocument,
      resourceId: documentId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification:
        document.classification_code === DOCUMENT_CLASSIFICATIONS.Restricted
          ? SECURITY_AUDIT_CLASSIFICATIONS.Critical
          : SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { versionNumber },
    });

    return {
      buffer: stored.buffer,
      mimeType: version.mime_type,
      filename: version.original_filename,
      sha256: version.sha256_hash,
    };
  }

  async issueDownloadUrl(
    actor: IdentityAuthzContext,
    documentId: string,
    versionNumber: number,
  ): Promise<{ downloadUrl: string; expiresAt: string }> {
    assertValidDocumentId(documentId);
    const document = await this.documentsRepository.findDocumentById(documentId);
    if (!document) {
      throw documentsAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.DocumentsDocumentDownload, document);

    const version = await this.documentsRepository.findVersion(documentId, versionNumber);
    if (!version) {
      throw documentsVersionNotFound();
    }

    const issued = this.downloadTokens.issue(documentId, versionNumber);
    return {
      downloadUrl: `/api/v1/documents/download?token=${encodeURIComponent(issued.token)}`,
      expiresAt: issued.expiresAt,
    };
  }

  async streamByToken(
    token: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const verified = this.downloadTokens.verify(token);
    if (verified === 'INVALID') {
      throw documentsDownloadTokenInvalid();
    }
    if (verified === 'EXPIRED') {
      throw documentsDownloadTokenExpired();
    }

    const version = await this.documentsRepository.findVersionWithStorage(
      verified.documentId,
      verified.versionNumber,
    );
    if (!version) {
      throw documentsAccessNotFound();
    }

    const stored = await this.objectStorage.getObject(version.storage_key);
    if (!stored) {
      throw documentsAccessNotFound();
    }

    return {
      buffer: stored.buffer,
      mimeType: version.mime_type,
      filename: version.original_filename,
    };
  }

  private assertSingleFile(file: UploadedFileInput | null | undefined): void {
    if (!file || !file.buffer || file.buffer.byteLength === 0) {
      throw documentsInvalidInput();
    }
  }

  private async assertUnitRegistered(unitId: string): Promise<void> {
    const registered = await this.documentsRepository.isUnitRegistered(unitId);
    if (!registered) {
      throw documentsUnitNotRegistered();
    }
  }
}

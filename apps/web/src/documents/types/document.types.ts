export const DOCUMENT_CATEGORIES = {
  General: 'GENERAL',
  Evidence: 'EVIDENCE',
  BillingDocument: 'BILLING_DOCUMENT',
} as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[keyof typeof DOCUMENT_CATEGORIES];

export const DOCUMENT_CLASSIFICATIONS = {
  Internal: 'INTERNAL',
  Restricted: 'RESTRICTED',
} as const;

export type DocumentClassification =
  (typeof DOCUMENT_CLASSIFICATIONS)[keyof typeof DOCUMENT_CLASSIFICATIONS];

export const DOCUMENT_ERROR_CODES = {
  NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  VERSION_NOT_FOUND: 'DOCUMENT_VERSION_NOT_FOUND',
  DENIED: 'DOCUMENT_ACCESS_DENIED',
  INVALID_MIME: 'DOCUMENT_INVALID_MIME',
  FILE_TOO_LARGE: 'DOCUMENT_FILE_TOO_LARGE',
  TOO_MANY_FILES: 'DOCUMENT_TOO_MANY_FILES',
  MAX_VERSIONS_REACHED: 'DOCUMENT_MAX_VERSIONS_REACHED',
  INVALID_INPUT: 'DOCUMENT_INVALID_INPUT',
} as const;

export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[keyof typeof DOCUMENT_ERROR_CODES];

export type DocumentDetail = {
  id: string;
  title: string;
  categoryCode: string;
  classificationCode: string;
  status: string;
  unitId: string;
  currentVersionNumber: number | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Pagina da listagem.
 *
 * `total` e o tamanho do CONJUNTO escopado e filtrado — nao o tamanho da pagina — e e o que decide
 * se existe proxima pagina. Sem ele a UI so poderia adivinhar por "a pagina veio cheia", o que
 * oferece uma pagina fantasma quando o total e multiplo exato do tamanho da pagina.
 */
export type DocumentListResponse = {
  items: DocumentDetail[];
  limit: number;
  offset: number;
  total: number;
};

export type DocumentVersion = {
  id: string;
  documentId: string;
  versionNumber: number;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sha256Hash: string;
  uploadedByIdentityId: string;
  publishedAt: string;
  supersededAt: string | null;
  isCurrent: boolean;
};

export type DocumentLinkRef = {
  id?: string;
  documentId: string;
  linkPurpose?: string;
  createdAt?: string;
};

export type DocumentScopeKind =
  | 'CLIENT'
  | 'SERVICE_REQUEST'
  | 'PROPOSAL'
  | 'PURCHASE_ORDER'
  | 'SERVICE_ORDER'
  | 'EXECUTION'
  | 'MEASUREMENT'
  | 'BILLING';

export type DocumentScopeContext = {
  kind: DocumentScopeKind;
  unitId: string;
  entityId: string;
  entityLabel?: string;
  proposalVersionNumber?: number;
  defaultLinkPurpose?: string;
  categoryCode?: DocumentCategory;
  classificationCode?: DocumentClassification;
};

export type DocumentCapabilities = {
  canCreate: boolean;
  canRead: boolean;
  canList: boolean;
  canUploadVersion: boolean;
  canDownload: boolean;
};

export type CreateDocumentPayload = {
  title: string;
  categoryCode: DocumentCategory;
  classificationCode: DocumentClassification;
  unitId: string;
};

export type DocumentUploadResult = {
  document: DocumentDetail;
  version: DocumentVersion;
};

export const DOCUMENT_UPLOAD_LIMITS = {
  maxFileSizeBytes: 25 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] as const,
  allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png'] as const,
};

export type DocumentUploadQueueItem = {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  state: 'queued' | 'uploading' | 'linking' | 'success' | 'error';
  progress: number;
  errorMessage: string | null;
};

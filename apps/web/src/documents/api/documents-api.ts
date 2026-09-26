import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import type { ServiceRequestDetail } from '../../requests/types/service-request.types';
import {
  DOCUMENT_ERROR_CODES,
  type CreateDocumentPayload,
  type DocumentCapabilities,
  type DocumentDetail,
  type DocumentUploadResult,
  type DocumentVersion,
} from '../types/document.types';
import { uploadMultipart } from '../utils/document-upload';

function shouldUseXHRUpload(): boolean {
  return typeof XMLHttpRequest !== 'undefined' && import.meta.env.MODE !== 'test';
}

async function uploadViaFetch<T>(path: string, formData: FormData, onProgress: (progress: number) => void): Promise<T> {
  onProgress(0);
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new DocumentsApiError(401, undefined, 'denied');
  }
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  onProgress(100);
  return (await response.json()) as T;
}

async function uploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress: (progress: number) => void,
): Promise<T> {
  if (shouldUseXHRUpload()) {
    return uploadMultipart<T>(path, formData, onProgress);
  }
  return uploadViaFetch<T>(path, formData, onProgress);
}

export type DocumentsApiErrorKind =
  | 'denied'
  | 'not_found'
  | 'validation'
  | 'network'
  | 'unknown';

export class DocumentsApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly kind: DocumentsApiErrorKind;

  constructor(status: number, code: string | undefined, kind: DocumentsApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

const PROBE_DOCUMENT_ID = '00000000-0000-4000-8000-000000000050';

function classifyError(status: number, code: string | undefined): DocumentsApiErrorKind {
  if (code === DOCUMENT_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (
    code === DOCUMENT_ERROR_CODES.NOT_FOUND ||
    code === DOCUMENT_ERROR_CODES.VERSION_NOT_FOUND ||
    status === 404
  ) {
    return 'not_found';
  }
  if (
    code === DOCUMENT_ERROR_CODES.INVALID_MIME ||
    code === DOCUMENT_ERROR_CODES.FILE_TOO_LARGE ||
    code === DOCUMENT_ERROR_CODES.TOO_MANY_FILES ||
    code === DOCUMENT_ERROR_CODES.INVALID_INPUT ||
    code === DOCUMENT_ERROR_CODES.MAX_VERSIONS_REACHED ||
    status === 400
  ) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<DocumentsApiError> {
  let code: string | undefined;
  try {
    const body = (await response.json()) as { error?: { code?: string } };
    code = body.error?.code;
  } catch {
    // ignore
  }
  return new DocumentsApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new DocumentsApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, init);
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DocumentsApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new DocumentsApiError(0, undefined, 'network');
    }
    throw new DocumentsApiError(0, undefined, 'unknown');
  }
}

/**
 * Tetos da primeira pagina da listagem.
 *
 * Mesmo valor usado antes desta frente (`limit=100&offset=0`), agora explicito e reaproveitado pela
 * tela para dizer com honestidade quando a pagina veio cheia — o backend nao devolve `total`, entao
 * "veio cheio" e a unica evidencia disponivel de que existem mais documentos.
 */
export const DOCUMENT_LIST_PAGE_SIZE = 100;

export type ListDocumentsParams = {
  q?: string;
  categoryCode?: string;
  limit?: number;
  offset?: number;
};

/**
 * Lista documentos. Parametros sao aditivos: sem eles a requisicao e exatamente a anterior
 * (`limit=100&offset=0`), de modo que os consumidores existentes nao mudam de comportamento.
 */
export async function listDocuments(
  signal?: AbortSignal,
  params: ListDocumentsParams = {},
): Promise<DocumentDetail[]> {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit ?? DOCUMENT_LIST_PAGE_SIZE));
  search.set('offset', String(params.offset ?? 0));
  if (params.q?.trim()) {
    search.set('q', params.q.trim());
  }
  if (params.categoryCode) {
    search.set('categoryCode', params.categoryCode);
  }
  const body = await requestJson<{ items: DocumentDetail[] }>(`/api/v1/documents?${search}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
  return body.items;
}

export async function getDocument(documentId: string, signal?: AbortSignal): Promise<DocumentDetail> {
  return requestJson<DocumentDetail>(`/api/v1/documents/${documentId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listDocumentVersions(
  documentId: string,
  signal?: AbortSignal,
): Promise<DocumentVersion[]> {
  return requestJson<DocumentVersion[]>(`/api/v1/documents/${documentId}/versions`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createDocument(
  metadata: CreateDocumentPayload,
  file: File,
  onProgress: (progress: number) => void,
): Promise<DocumentUploadResult> {
  const formData = new FormData();
  formData.append('title', metadata.title);
  formData.append('categoryCode', metadata.categoryCode);
  formData.append('classificationCode', metadata.classificationCode);
  formData.append('unitId', metadata.unitId);
  formData.append('file', file, file.name);
  return uploadWithProgress<DocumentUploadResult>('/api/v1/documents', formData, onProgress);
}

export async function uploadDocumentVersion(
  documentId: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<DocumentVersion> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  return uploadWithProgress<DocumentVersion>(`/api/v1/documents/${documentId}/versions`, formData, onProgress);
}

export async function downloadDocumentContent(
  documentId: string,
  versionNumber: number,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string; sha256: string | null }> {
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/documents/${documentId}/versions/${versionNumber}/content`,
      {
        method: 'GET',
        headers: authHeaders(),
        signal,
      },
    );
    if (!response.ok) {
      throw await parseError(response);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    return {
      blob,
      filename: filenameMatch?.[1] ?? `document-${documentId}-v${versionNumber}`,
      sha256: response.headers.get('X-Content-SHA256'),
    };
  } catch (error) {
    if (error instanceof DocumentsApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new DocumentsApiError(0, undefined, 'network');
    }
    throw new DocumentsApiError(0, undefined, 'unknown');
  }
}

export async function issueDocumentDownloadUrl(
  documentId: string,
  versionNumber: number,
  signal?: AbortSignal,
): Promise<{ downloadUrl: string; expiresAt: string }> {
  return requestJson<{ downloadUrl: string; expiresAt: string }>(
    `/api/v1/documents/${documentId}/versions/${versionNumber}/download-url`,
    {
      method: 'POST',
      headers: authHeaders(),
      signal,
    },
  );
}

export async function triggerAuthorizedDownload(
  documentId: string,
  versionNumber: number,
): Promise<void> {
  const issued = await issueDocumentDownloadUrl(documentId, versionNumber);
  const absoluteUrl = issued.downloadUrl.startsWith('http')
    ? issued.downloadUrl
    : `${getApiBaseUrl()}${issued.downloadUrl}`;
  const response = await fetch(absoluteUrl);
  if (!response.ok) {
    throw await parseError(response);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch?.[1] ?? `document-${documentId}`;
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function probeMutation(path: string, method: string, body?: unknown): Promise<boolean> {
  try {
    await requestJson(path, {
      method,
      headers: {
        ...authHeaders(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return true;
  } catch (error) {
    if (error instanceof DocumentsApiError && error.kind === 'denied') {
      return false;
    }
    return true;
  }
}

export async function probeDocumentCapabilities(signal?: AbortSignal): Promise<DocumentCapabilities> {
  const [canCreate, canUploadVersion, canDownload] = await Promise.all([
    probeMutation('/api/v1/documents', 'POST'),
    probeMutation(`/api/v1/documents/${PROBE_DOCUMENT_ID}/versions`, 'POST'),
    probeMutation(`/api/v1/documents/${PROBE_DOCUMENT_ID}/versions/1/download-url`, 'POST'),
  ]);

  let canRead = true;
  let canList = true;
  try {
    await requestJson(`/api/v1/documents/${PROBE_DOCUMENT_ID}`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
  } catch (error) {
    if (error instanceof DocumentsApiError && error.kind === 'denied') {
      canRead = false;
    }
  }

  try {
    await requestJson('/api/v1/documents?limit=1', {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
  } catch (error) {
    if (error instanceof DocumentsApiError && error.kind === 'denied') {
      canList = false;
    }
  }

  return { canCreate, canRead, canList, canUploadVersion, canDownload };
}

export async function linkServiceRequestDocument(
  serviceRequestId: string,
  documentId: string,
  linkPurpose: string,
): Promise<ServiceRequestDetail> {
  return requestJson<ServiceRequestDetail>(`/api/v1/requests/service-requests/${serviceRequestId}/documents`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ documentId, linkPurpose }),
  });
}

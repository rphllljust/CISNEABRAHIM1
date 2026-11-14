import { fetchWithSession } from '../../auth/api/session-recovery';
import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import type { DocumentDetail } from '../../documents/types/document.types';

export type AssetDocumentsResponse = { items: DocumentDetail[]; scope: 'RECENT_WINDOW' };
export type AssetDocumentsAttachResponse = { document: DocumentDetail; attached: boolean };

export class AssetDocumentsApiError extends Error {
  constructor(readonly kind: 'denied' | 'not_found' | 'network' | 'error') {
    super(kind);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.getAccessToken();
  if (!token) throw new AssetDocumentsApiError('denied');
  try {
    const response = await fetchWithSession(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new AssetDocumentsApiError(
        response.status === 401 || response.status === 403
          ? 'denied' : response.status === 404 ? 'not_found' : 'error',
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof AssetDocumentsApiError) throw error;
    if (init.signal?.aborted) throw error;
    throw new AssetDocumentsApiError(isNetworkError(error) ? 'network' : 'error');
  }
}

export function listAssetDocuments(assetId: string, signal?: AbortSignal) {
  return request<AssetDocumentsResponse>(
    `/api/v1/resources/physical-assets/${encodeURIComponent(assetId)}/documents`,
    { signal },
  );
}

export function attachAssetDocument(assetId: string, documentId: string) {
  return request<AssetDocumentsAttachResponse>(
    `/api/v1/resources/physical-assets/${encodeURIComponent(assetId)}/documents`,
    { method: 'POST', body: JSON.stringify({ documentId }) },
  );
}

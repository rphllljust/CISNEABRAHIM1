import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { mapDocumentErrorToMessage } from './document-error-messages';
import { getDocument, listDocuments } from './documents-api';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GED API error envelope and authorization invariants', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTokenStoreForTests();
    tokenStore.setTokens('ged-test-access', 'ged-test-refresh');
  });

  it('returns an explicit denial for expired session (401)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(401, { error: { code: 'UNAUTHORIZED' } })));
    await expect(listDocuments()).rejects.toMatchObject({ status: 401, kind: 'denied' });
  });

  it('preserves a nested 403 access denial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(403, { error: { code: 'DOCUMENT_DENIED' } })));
    await expect(listDocuments()).rejects.toMatchObject({ status: 403, kind: 'denied' });
  });

  it('does not rewrite a missing document into a successful or empty response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(404, { code: 'DOCUMENT_NOT_FOUND' })));
    await expect(getDocument('doc-missing')).rejects.toMatchObject({
      status: 404, code: 'DOCUMENT_NOT_FOUND', kind: 'not_found',
    });
  });

  it('keeps 503 outages distinct from permission denials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(503, { error: { code: 'SERVICE_UNAVAILABLE' } })));
    await expect(listDocuments()).rejects.toMatchObject({ status: 503, kind: 'unknown' });
    expect(mapDocumentErrorToMessage(undefined, 503)).toMatch(/indisponível/i);
  });

  it('does not mislabel 401 as a generic document failure', () => {
    expect(mapDocumentErrorToMessage(undefined, 401)).toMatch(/não tem permissão/i);
  });
});

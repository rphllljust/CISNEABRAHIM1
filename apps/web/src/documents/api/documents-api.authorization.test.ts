import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { probeDocumentCapabilities } from './documents-api';

const DOCUMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as Response;
}

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, 'http://127.0.0.1:3000').pathname;
}

/**
 * Sonda de capability contra um servidor que responde ao que importa e nega/documenta ausencia no
 * resto: `downloadUrl(status)` decide o desfecho do endpoint real de download-url.
 */
function createProbeFetch(downloadUrlStatus: number, listItems: unknown[] = []) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    const method = init?.method ?? 'GET';

    if (path === '/api/v1/documents' && method === 'GET') {
      return jsonResponse({ items: listItems, limit: 1, offset: 0, total: listItems.length });
    }
    if (path === '/api/v1/authz/probe') {
      return jsonResponse({ status: 'ok' });
    }
    if (/\/versions\/\d+\/download-url$/.test(path) && method === 'POST') {
      return jsonResponse({ error: { code: 'DOCUMENT_NOT_FOUND' } }, downloadUrlStatus);
    }
    if (path.startsWith('/api/v1/documents/')) {
      // Documento-sonda inexistente e demais sondas de mutacao: entrada ausente/404, nunca allow.
      return jsonResponse({ error: { code: 'DOCUMENT_NOT_FOUND' } }, 404);
    }
    return jsonResponse({});
  });
}

const DOCUMENT_ITEM = {
  id: DOCUMENT_ID,
  title: 'Contrato assinado',
  categoryCode: 'GENERAL',
  classificationCode: 'INTERNAL',
  status: 'ACTIVE',
  unitId: 'unit-1',
  currentVersionNumber: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
};

describe('documents-api capabilities', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('denies download when the probe finds no explicit positive result (404)', async () => {
    vi.stubGlobal('fetch', createProbeFetch(404, [DOCUMENT_ITEM]));

    const capabilities = await probeDocumentCapabilities();

    expect(capabilities.canDownload).toBe(false);
  });

  it('denies download when the backend refuses it (403)', async () => {
    vi.stubGlobal('fetch', createProbeFetch(403, [DOCUMENT_ITEM]));

    const capabilities = await probeDocumentCapabilities();

    expect(capabilities.canDownload).toBe(false);
  });

  it('grants download only on an explicit 200 from the real download endpoint', async () => {
    vi.stubGlobal('fetch', createProbeFetch(200, [DOCUMENT_ITEM]));

    const capabilities = await probeDocumentCapabilities();

    expect(capabilities.canDownload).toBe(true);
  });

  it('denies download when the scoped library is empty: nothing to download, no positive proof', async () => {
    vi.stubGlobal('fetch', createProbeFetch(200, []));

    const capabilities = await probeDocumentCapabilities();

    expect(capabilities.canDownload).toBe(false);
  });
});

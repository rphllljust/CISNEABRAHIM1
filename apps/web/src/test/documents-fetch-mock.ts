import { vi } from 'vitest';
import { parseRequestPath } from './request-url';

export const MOCK_DOCUMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const MOCK_DOCUMENT_VERSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

type MockDocument = {
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

type MockVersion = {
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
  buffer: Buffer;
};

export type DocumentsFetchMockOptions = {
  documentsAllowed?: boolean;
  documentsReadAllowed?: boolean;
  documentsDownloadAllowed?: boolean;
  invalidFile?: boolean;
  uploadFailsOnce?: boolean;
  crossScopeDenied?: boolean;
};

function documentError(code: string, status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message: 'error' } }),
  } as Response;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
    blob: async () => new Blob([JSON.stringify(body)]),
  } as Response;
}

export function createDocumentsFetchHandler(options: DocumentsFetchMockOptions = {}) {
  const documentsAllowed = options.documentsAllowed ?? true;
  const documentsReadAllowed = options.documentsReadAllowed ?? true;
  const documentsDownloadAllowed = options.documentsDownloadAllowed ?? true;

  const documents = new Map<string, MockDocument>();
  const versions = new Map<string, MockVersion[]>();
  let uploadAttempts = 0;

  function seedDocument(
    id: string,
    unitId: string,
    title: string,
    filename = 'demo.pdf',
    // Opcional e aditivo: os testes de listagem precisam semear categoria/classificacao diferentes
    // para exercitar filtro e linha secundaria; quem ja chamava sem isso nao muda.
    overrides: Partial<MockDocument> = {},
  ): MockDocument {
    const now = new Date().toISOString();
    const document: MockDocument = {
      id,
      title,
      categoryCode: 'GENERAL',
      classificationCode: 'INTERNAL',
      status: 'ACTIVE',
      unitId,
      currentVersionNumber: 1,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    const version: MockVersion = {
      id: MOCK_DOCUMENT_VERSION_ID,
      documentId: id,
      versionNumber: 1,
      originalFilename: filename,
      mimeType: 'application/pdf',
      byteSize: 1024,
      sha256Hash: 'a'.repeat(64),
      uploadedByIdentityId: 'actor-demo',
      publishedAt: now,
      supersededAt: null,
      isCurrent: true,
      buffer: Buffer.from('%PDF-1.4 demo'),
    };
    documents.set(id, document);
    versions.set(id, [version]);
    return document;
  }

  seedDocument(MOCK_DOCUMENT_ID, 'unit-demo', 'Anexo demo', 'evidencia.pdf');

  return {
    seedDocument,
    handle(
      pathname: string,
      method: string,
      _init?: RequestInit,
      // Opcional e aditivo: quem ja chamava sem os parametros continua com a listagem completa.
      searchParams?: URLSearchParams,
    ): Response | null {
      if (pathname === '/api/v1/documents/download' && method === 'GET') {
        if (!documentsDownloadAllowed) {
          return documentError('DOCUMENT_ACCESS_DENIED', 403);
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="demo.pdf"',
          }),
          blob: async () => new Blob(['%PDF-1.4 demo'], { type: 'application/pdf' }),
        } as Response;
      }

      if (pathname === '/api/v1/documents' && method === 'GET') {
        if (!documentsReadAllowed) {
          return documentError('DOCUMENT_ACCESS_DENIED', 403);
        }
        // Mesma semantica da listagem real: busca por titulo e filtro por categoria resolvidos no
        // SERVIDOR. Sem parametros a resposta e identica a de antes desta frente (todos os
        // documentos do escopo).
        const term = searchParams?.get('q')?.trim().toLowerCase() ?? '';
        const category = searchParams?.get('categoryCode')?.trim() ?? '';
        const listed = [...documents.values()].filter((document) => {
          if (category && document.categoryCode !== category) {
            return false;
          }
          if (term && !document.title.toLowerCase().includes(term)) {
            return false;
          }
          return true;
        });
        return jsonResponse({
          items: listed,
          limit: 20,
          offset: 0,
        });
      }

      if (pathname === '/api/v1/documents' && method === 'POST') {
        if (!documentsAllowed) {
          return documentError('DOCUMENT_ACCESS_DENIED', 403);
        }
        const body = _init?.body;
        const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData;
        if (!isMultipart) {
          return documentError('DOCUMENT_INVALID_INPUT', 400);
        }
        uploadAttempts += 1;
        if (options.uploadFailsOnce && uploadAttempts === 1) {
          return documentError('DOCUMENT_STORAGE_FAILURE', 500);
        }
        if (options.invalidFile) {
          return documentError('DOCUMENT_INVALID_MIME', 400);
        }
        const id = crypto.randomUUID();
        const created = seedDocument(id, 'unit-demo', `Upload ${uploadAttempts}`, 'novo.pdf');
        const version = versions.get(id)![0]!;
        return jsonResponse({ document: created, version }, 201);
      }

      const documentMatch = pathname.match(/^\/api\/v1\/documents\/([^/]+)(\/.*)?$/);
      if (!documentMatch) {
        return null;
      }

      const documentId = documentMatch[1]!;
      const suffix = documentMatch[2] ?? '';
      const document = documents.get(documentId);

      if (suffix === '' && method === 'GET') {
        if (!documentsReadAllowed || (options.crossScopeDenied && documentId === MOCK_DOCUMENT_ID)) {
          return documentError('DOCUMENT_ACCESS_DENIED', 403);
        }
        return document ? jsonResponse(document) : documentError('DOCUMENT_NOT_FOUND', 404);
      }

      if (suffix === '/versions' && method === 'GET') {
        if (!documentsReadAllowed) {
          return documentError('DOCUMENT_ACCESS_DENIED', 403);
        }
        return jsonResponse(versions.get(documentId) ?? []);
      }

      if (suffix === '/versions' && method === 'POST') {
        if (!documentsAllowed) {
          return documentError('DOCUMENT_ACCESS_DENIED', 403);
        }
        if (!document) {
          return documentError('DOCUMENT_NOT_FOUND', 404);
        }
        const currentVersions = versions.get(documentId) ?? [];
        const nextNumber = currentVersions.length + 1;
        const now = new Date().toISOString();
        for (const entry of currentVersions) {
          entry.isCurrent = false;
          entry.supersededAt = now;
        }
        const created: MockVersion = {
          id: crypto.randomUUID(),
          documentId,
          versionNumber: nextNumber,
          originalFilename: `v${nextNumber}.pdf`,
          mimeType: 'application/pdf',
          byteSize: 2048,
          sha256Hash: 'b'.repeat(64),
          uploadedByIdentityId: 'actor-demo',
          publishedAt: now,
          supersededAt: null,
          isCurrent: true,
          buffer: Buffer.from('%PDF-1.4 version'),
        };
        currentVersions.push(created);
        versions.set(documentId, currentVersions);
        document.currentVersionNumber = nextNumber;
        document.updatedAt = now;
        documents.set(documentId, document);
        return jsonResponse(created, 201);
      }

      const contentMatch = suffix.match(/^\/versions\/(\d+)\/content$/);
      if (contentMatch && method === 'GET') {
        if (!documentsDownloadAllowed) {
          return documentError('DOCUMENT_ACCESS_DENIED', 403);
        }
        const versionNumber = Number(contentMatch[1]);
        const version = (versions.get(documentId) ?? []).find((entry) => entry.versionNumber === versionNumber);
        if (!version) {
          return documentError('DOCUMENT_VERSION_NOT_FOUND', 404);
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            'Content-Type': version.mimeType,
            'Content-Disposition': `attachment; filename="${version.originalFilename}"`,
            'X-Content-SHA256': version.sha256Hash,
          }),
          blob: async () => new Blob([new Uint8Array(version.buffer)], { type: version.mimeType }),
        } as Response;
      }

      const downloadUrlMatch = suffix.match(/^\/versions\/(\d+)\/download-url$/);
      if (downloadUrlMatch && method === 'POST') {
        if (!documentsDownloadAllowed) {
          return documentError('DOCUMENT_ACCESS_DENIED', 403);
        }
        return jsonResponse({
          downloadUrl: '/api/v1/documents/download?token=mock-token',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      }

      return null;
    },
  };
}

export function wrapFetchWithDocumentsMock(
  upstream: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  options: DocumentsFetchMockOptions = {},
) {
  const documents = createDocumentsFetchHandler(options);
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    const response = documents.handle(pathname, init?.method ?? 'GET', init, searchParams);
    if (response) {
      return response;
    }
    return upstream(input, init);
  });
}

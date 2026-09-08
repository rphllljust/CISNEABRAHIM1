import { vi } from 'vitest';
import { parseRequestPath } from '../test/request-url';
import { createShellFetchMock, MOCK_IDENTITY_ID, MOCK_SESSION_ID } from '../test/shell-fetch-mock';
import { CONTRACT_STATUSES, type Contract, type ContractDetail } from './types';

export const PROBE_CONTRACT_ID = '00000000-0000-4000-8000-000000000005';

export type ContractsFetchMockOptions = {
  probeAllowed?: boolean;
  listAllowed?: boolean;
  createAllowed?: boolean;
  /** Próxima mutação responde 409 COMMERCIAL_CONTRACT_VERSION_CONFLICT (uma vez). */
  versionConflictOnNext?: boolean;
};

const CONTRACT_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000a';
const CONTRACT_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-00000000000b';
const CLIENT_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function contractError(code: string, status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message: 'error' } }),
  } as Response;
}

function baseContract(partial: Partial<Contract>): Contract {
  return {
    id: partial.id ?? '',
    internalCode: partial.internalCode ?? 'CTR-2026-00000000',
    clientId: partial.clientId ?? CLIENT_A_ID,
    unitId: partial.unitId ?? 'UNIT-A',
    contractNumber: partial.contractNumber ?? 'CTR',
    title: partial.title ?? 'Contrato',
    scopeDescription: partial.scopeDescription ?? null,
    validFrom: partial.validFrom ?? '2026-01-01',
    validTo: partial.validTo ?? '2027-12-31',
    currencyCode: partial.currencyCode ?? 'BRL',
    paymentTerms: partial.paymentTerms ?? null,
    paymentMethod: partial.paymentMethod ?? null,
    commercialTerms: {},
    clientSnapshot: partial.clientSnapshot ?? {
      clientId: CLIENT_A_ID,
      legalName: 'Cliente Demo LTDA',
      tradeName: 'Demo',
      status: 'ACTIVE',
      snapshottedAt: '2026-01-01T12:00:00.000Z',
    },
    status: partial.status ?? CONTRACT_STATUSES.Draft,
    activatedAt: partial.activatedAt ?? null,
    closedAt: partial.closedAt ?? null,
    closureReason: partial.closureReason ?? null,
    rowVersion: partial.rowVersion ?? 1,
    createdAt: partial.createdAt ?? '2026-01-01T12:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-01-01T12:00:00.000Z',
  };
}

function toDetail(contract: Contract): ContractDetail {
  return { contract, items: [], documentLinks: [] };
}

/**
 * Mock de contrato com semântica do backend:
 * - create: exige campos obrigatórios do DTO (400) e rejeita número duplicado (409);
 * - patch: só DRAFT, exige rowVersion (409 VERSION_CONFLICT) e valida estado (409);
 * - activate: só DRAFT com rowVersion atual;
 * - close: só ACTIVE com rowVersion atual (motivo opcional, como no backend);
 * - expire: sem corpo; só ACTIVE (idempotente quando já EXPIRED).
 */
export function createContractsFetchMock(options: ContractsFetchMockOptions = {}) {
  const shellMock = createShellFetchMock({ probeAllowed: options.probeAllowed });
  const listAllowed = options.listAllowed ?? true;
  const createAllowed = options.createAllowed ?? true;
  let versionConflictPending = options.versionConflictOnNext ?? false;
  const state = {
    versionConflictOnNext: () => {
      versionConflictPending = true;
    },
  };

  const store: Contract[] = [
    baseContract({
      id: CONTRACT_A_ID,
      internalCode: 'CTR-2026-A00001',
      contractNumber: 'CTR-ACT-001',
      title: 'Contrato ativo A',
      unitId: 'UNIT-A',
      status: CONTRACT_STATUSES.Active,
      activatedAt: '2026-02-01T12:00:00.000Z',
      rowVersion: 2,
    }),
    baseContract({
      id: CONTRACT_B_ID,
      internalCode: 'CTR-2026-A00002',
      contractNumber: 'CTR-ACT-002',
      title: 'Contrato ativo B',
      unitId: 'UNIT-B',
      status: CONTRACT_STATUSES.Active,
      activatedAt: '2026-02-02T12:00:00.000Z',
      rowVersion: 3,
    }),
    baseContract({
      id: 'cccccccc-cccc-4ccc-8ccc-00000000000c',
      internalCode: 'CTR-2026-A00003',
      contractNumber: 'CTR-DRAFT-001',
      title: 'Rascunho de contrato',
      unitId: 'UNIT-A',
      status: CONTRACT_STATUSES.Draft,
      rowVersion: 1,
    }),
  ];

  return {
    state,
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname, searchParams } = parseRequestPath(input);
      const method = init?.method ?? 'GET';

      if (pathname === '/api/v1/clients' && method === 'GET') {
        return jsonResponse({
          items: [
            {
              id: CLIENT_A_ID,
              legalName: 'Cliente Demo LTDA',
              tradeName: 'Demo',
              status: 'ACTIVE',
            },
          ],
          limit: 100,
          offset: 0,
        });
      }

      if (!pathname.startsWith('/api/v1/commercial/contracts')) {
        return shellMock(input, init);
      }

      const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
      if (!auth?.startsWith('Bearer ')) {
        return contractError('AUTH_UNAUTHORIZED', 401);
      }

      if (pathname === '/api/v1/commercial/contracts' && method === 'GET') {
        if (!listAllowed) {
          return contractError('COMMERCIAL_DENIED', 403);
        }
        const limit = Number(searchParams.get('limit') ?? '20');
        const offset = Number(searchParams.get('offset') ?? '0');
        const clientId = searchParams.get('clientId');
        const unitId = searchParams.get('unitId');
        let items = [...store];
        if (clientId) {
          items = items.filter((contract) => contract.clientId === clientId);
        }
        if (unitId) {
          items = items.filter((contract) => contract.unitId === unitId);
        }
        return jsonResponse({
          items: items.slice(offset, offset + limit),
          limit,
          offset,
        });
      }

      if (pathname === '/api/v1/commercial/contracts' && method === 'POST') {
        if (!createAllowed) {
          return contractError('COMMERCIAL_DENIED', 403);
        }
        const rawBody = init?.body;
        const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
          clientId?: string;
          unitId?: string;
          contractNumber?: string;
          title?: string;
          validFrom?: string;
          scopeDescription?: string;
          validTo?: string;
          currencyCode?: string;
          paymentTerms?: string;
          paymentMethod?: string;
        };
        if (
          !body.clientId ||
          !body.unitId ||
          !body.contractNumber ||
          !body.title ||
          !body.validFrom
        ) {
          return contractError('COMMERCIAL_VALIDATION_FAILED', 400);
        }
        if (store.some((contract) => contract.contractNumber === body.contractNumber)) {
          return contractError('COMMERCIAL_CONTRACT_DUPLICATE', 409);
        }
        const created = baseContract({
          id: crypto.randomUUID(),
          contractNumber: body.contractNumber,
          title: body.title,
          clientId: body.clientId,
          unitId: body.unitId,
          scopeDescription: body.scopeDescription ?? null,
          validFrom: body.validFrom,
          validTo: body.validTo ?? null,
          currencyCode: body.currencyCode ?? 'BRL',
          paymentTerms: body.paymentTerms ?? null,
          paymentMethod: body.paymentMethod ?? null,
          status: CONTRACT_STATUSES.Draft,
          rowVersion: 1,
          internalCode: `CTR-2026-${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`,
        });
        store.push(created);
        return jsonResponse(toDetail(created), 201);
      }

      const actionMatch = pathname.match(
        /^\/api\/v1\/commercial\/contracts\/([^/]+)\/(activate|close|expire|documents)$/,
      );
      const detailMatch = pathname.match(/^\/api\/v1\/commercial\/contracts\/([^/]+)$/);
      const contractId = (actionMatch?.[1] ?? detailMatch?.[1] ?? '');

      if (!detailMatch && !actionMatch) {
        return contractError('COMMERCIAL_CONTRACT_NOT_FOUND', 404);
      }

      const existing = store.find((contract) => contract.id === contractId);

      if (method === 'GET' && detailMatch) {
        if (contractId === PROBE_CONTRACT_ID || !existing) {
          return contractError('COMMERCIAL_CONTRACT_NOT_FOUND', 404);
        }
        return jsonResponse(toDetail(existing));
      }

      if (!existing) {
        return contractError('COMMERCIAL_CONTRACT_NOT_FOUND', 404);
      }
      if (contractId === PROBE_CONTRACT_ID) {
        return contractError('COMMERCIAL_CONTRACT_NOT_FOUND', 404);
      }

      if (versionConflictPending) {
        versionConflictPending = false;
        return contractError('COMMERCIAL_CONTRACT_VERSION_CONFLICT', 409);
      }

      const readRowVersion = (): number | null => {
        const rawBody = init?.body;
        const parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
          rowVersion?: number;
        };
        return typeof parsed.rowVersion === 'number' ? parsed.rowVersion : null;
      };

      const patch = (next: Partial<Contract>): Contract => {
        const updated = { ...existing, ...next, updatedAt: new Date().toISOString() };
        store.splice(store.indexOf(existing), 1, updated);
        return updated;
      };

      if (method === 'PATCH' && detailMatch) {
        if (existing.status !== CONTRACT_STATUSES.Draft) {
          return contractError('COMMERCIAL_CONTRACT_INVALID_STATE', 409);
        }
        if (readRowVersion() !== existing.rowVersion) {
          return contractError('COMMERCIAL_CONTRACT_VERSION_CONFLICT', 409);
        }
        const rawBody = init?.body;
        const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as Record<
          string,
          unknown
        >;
        const updated = patch({
          contractNumber:
            typeof body['contractNumber'] === 'string' && body['contractNumber']
              ? (body['contractNumber'])
              : existing.contractNumber,
          title:
            typeof body['title'] === 'string' && body['title']
              ? (body['title'])
              : existing.title,
          scopeDescription:
            body['scopeDescription'] === null
              ? null
              : typeof body['scopeDescription'] === 'string' && body['scopeDescription']
                ? (body['scopeDescription'])
                : existing.scopeDescription,
          validFrom:
            typeof body['validFrom'] === 'string' && body['validFrom']
              ? (body['validFrom'])
              : existing.validFrom,
          validTo:
            body['validTo'] === null
              ? null
              : typeof body['validTo'] === 'string' && body['validTo']
                ? (body['validTo'])
                : existing.validTo,
          currencyCode:
            typeof body['currencyCode'] === 'string' && body['currencyCode']
              ? (body['currencyCode'])
              : existing.currencyCode,
          paymentTerms:
            body['paymentTerms'] === null
              ? null
              : typeof body['paymentTerms'] === 'string' && body['paymentTerms']
                ? (body['paymentTerms'])
                : existing.paymentTerms,
          paymentMethod:
            body['paymentMethod'] === null
              ? null
              : typeof body['paymentMethod'] === 'string' && body['paymentMethod']
                ? (body['paymentMethod'])
                : existing.paymentMethod,
          rowVersion: existing.rowVersion + 1,
        });
        return jsonResponse(toDetail(updated));
      }

      if (method === 'POST' && actionMatch) {
        const action = actionMatch[2];
        if (action === 'activate') {
          if (existing.status !== CONTRACT_STATUSES.Draft) {
            return contractError('COMMERCIAL_CONTRACT_INVALID_STATE', 409);
          }
          if (readRowVersion() !== existing.rowVersion) {
            return contractError('COMMERCIAL_CONTRACT_VERSION_CONFLICT', 409);
          }
          const updated = patch({
            status: CONTRACT_STATUSES.Active,
            activatedAt: new Date().toISOString(),
            rowVersion: existing.rowVersion + 1,
          });
          return jsonResponse(toDetail(updated));
        }
        if (action === 'close') {
          if (existing.status !== CONTRACT_STATUSES.Active) {
            return contractError('COMMERCIAL_CONTRACT_INVALID_STATE', 409);
          }
          if (readRowVersion() !== existing.rowVersion) {
            return contractError('COMMERCIAL_CONTRACT_VERSION_CONFLICT', 409);
          }
          const rawBody = init?.body;
          const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
            closureReason?: string;
          };
          const updated = patch({
            status: CONTRACT_STATUSES.Closed,
            closedAt: new Date().toISOString(),
            closureReason: body.closureReason ?? null,
            rowVersion: existing.rowVersion + 1,
          });
          return jsonResponse(toDetail(updated));
        }
        if (action === 'expire') {
          if (existing.status !== CONTRACT_STATUSES.Active) {
            return contractError('COMMERCIAL_CONTRACT_INVALID_STATE', 409);
          }
          const updated = patch({
            status: CONTRACT_STATUSES.Expired,
            rowVersion: existing.rowVersion + 1,
          });
          return jsonResponse(toDetail(updated));
        }
        if (action === 'documents') {
          const rawBody = init?.body;
          const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
            documentId?: string;
            linkPurpose?: string;
          };
          if (!body.documentId || !body.linkPurpose) {
            return contractError('COMMERCIAL_VALIDATION_FAILED', 400);
          }
          const detail = toDetail(existing);
          detail.documentLinks.push({
            id: crypto.randomUUID(),
            documentId: body.documentId,
            linkPurpose: body.linkPurpose,
            createdAt: new Date().toISOString(),
          });
          return jsonResponse(detail);
        }
      }

      return contractError('COMMERCIAL_CONTRACT_NOT_FOUND', 404);
    }),
  };
}

export { MOCK_IDENTITY_ID, MOCK_SESSION_ID };

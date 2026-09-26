import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { PERSON_STATUSES, type Person } from '../people/types/person.types';
import { createShellFetchMock } from './shell-fetch-mock';

export type PeopleFetchMockOptions = {
  probeAllowed?: boolean;
  personListAllowed?: boolean;
  personCreateAllowed?: boolean;
  personUpdateAllowed?: boolean;
  personDeactivateAllowed?: boolean;
  personActivateAllowed?: boolean;
  personCreateError?: { code: string; status: number };
  laborTypes?: Array<{ code: string; name: string }>;
};

function personError(code: string, status: number): Response {
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
  } as Response;
}

export function createPeopleFetchMock(options: PeopleFetchMockOptions = {}) {
  const shellMock = createShellFetchMock({ probeAllowed: options.probeAllowed });
  const listAllowed = options.personListAllowed ?? true;
  const createAllowed = options.personCreateAllowed ?? true;
  const updateAllowed = options.personUpdateAllowed ?? true;
  const deactivateAllowed = options.personDeactivateAllowed ?? true;
  const activateAllowed = options.personActivateAllowed ?? true;
  const laborTypes = options.laborTypes ?? [{ code: 'OPERATOR', name: 'Operador' }];

  const store: Person[] = [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      memberCode: 'PSN-000001',
      legalName: 'Pessoa Demo Sintética',
      preferredName: 'Demo',
      defaultLaborTypeCode: 'OPERATOR',
      defaultLaborTypeName: 'Operador',
      externalErpId: null,
      status: PERSON_STATUSES.Active,
      version: 1,
      createdAt: '2026-01-01T12:00:00.000Z',
      updatedAt: '2026-01-01T12:00:00.000Z',
      deactivatedAt: null,
      deactivationReason: null,
      serviceOrderAllocationSupported: false,
    },
  ];

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (!pathname.startsWith('/api/v1/people')) {
      if (pathname === '/api/v1/resources/labor-types' && method === 'GET') {
        return jsonResponse({ items: laborTypes });
      }
      return shellMock(input, init);
    }

    const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
    if (!auth?.startsWith('Bearer ')) {
      return personError('AUTH_UNAUTHORIZED', 401);
    }

    if (pathname === '/api/v1/people' && method === 'GET') {
      if (!listAllowed) {
        return personError('PERSON_DENIED', 403);
      }
      const status = searchParams.get('status');
      const items = status ? store.filter((person) => person.status === status) : store;
      return jsonResponse({ items, limit: 20, offset: 0 });
    }

    if (pathname === '/api/v1/people' && method === 'POST') {
      if (!createAllowed) {
        return personError('PERSON_DENIED', 403);
      }
      const rawBody = init?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
        legalName?: string;
        preferredName?: string;
        defaultLaborTypeCode?: string;
        externalErpId?: string;
      };
      if (!body.legalName || body.legalName.trim().length === 0) {
        return personError('PERSON_VALIDATION_FAILED', 400);
      }
      if (options.personCreateError) {
        return personError(options.personCreateError.code, options.personCreateError.status);
      }
      const created: Person = {
        id: crypto.randomUUID(),
        memberCode: 'PSN-000002',
        legalName: body.legalName,
        preferredName: body.preferredName ?? null,
        defaultLaborTypeCode: body.defaultLaborTypeCode ?? null,
        defaultLaborTypeName: null,
        externalErpId: body.externalErpId ?? null,
        status: PERSON_STATUSES.Active,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deactivatedAt: null,
        deactivationReason: null,
        serviceOrderAllocationSupported: false,
      };
      store.push(created);
      return jsonResponse(created, 201);
    }

    const detailMatch = pathname.match(/^\/api\/v1\/people\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const person = store.find((entry) => entry.id === detailMatch[1]);
      if (!person) {
        return personError('PERSON_NOT_FOUND', 404);
      }
      return jsonResponse(person);
    }

    if (detailMatch && method === 'PATCH') {
      if (!updateAllowed) {
        return personError('PERSON_DENIED', 403);
      }
      return personError('PERSON_NOT_FOUND', 404);
    }

    const deactivateMatch = pathname.match(/^\/api\/v1\/people\/([^/]+)\/deactivate$/);
    if (deactivateMatch && method === 'POST') {
      if (!deactivateAllowed) {
        return personError('PERSON_DENIED', 403);
      }
      return personError('PERSON_NOT_FOUND', 404);
    }

    const activateMatch = pathname.match(/^\/api\/v1\/people\/([^/]+)\/activate$/);
    if (activateMatch && method === 'POST') {
      if (!activateAllowed) {
        return personError('PERSON_DENIED', 403);
      }
      return personError('PERSON_NOT_FOUND', 404);
    }

    return personError('PERSON_NOT_FOUND', 404);
  });
}

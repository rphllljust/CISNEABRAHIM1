import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import {
  CLIENT_LIST_DIRECTIONS,
  CLIENT_LIST_SORTS,
  CLIENT_STATUSES,
  CONTACT_PURPOSES,
  PURCHASE_ORDER_REQUIREMENTS,
  type Client,
  type ClientListResponse,
  type ClientSummary,
} from '../clients/types/client.types';
import { createShellFetchMock, MOCK_IDENTITY_ID, MOCK_SESSION_ID } from './shell-fetch-mock';

export type ClientsFetchMockOptions = {
  probeAllowed?: boolean;
  clientListAllowed?: boolean;
  clientCreateAllowed?: boolean;
  clientUpdateAllowed?: boolean;
  clientDeactivateAllowed?: boolean;
  clientActivateAllowed?: boolean;
  /**
   * Catálogo usado pelo mock. Quando omitido, vale o Cliente de demonstração. Testes de busca,
   * filtro e ordenação fornecem o próprio catálogo — o mock NÃO inventa dados diferentes dos que o
   * teste declarou.
   */
  clients?: Client[];
};

function clientError(code: string, status: number): Response {
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

/** Projeção de listagem equivalente à do backend: sem contatos, sem endereços, sem localidade. */
function toSummary(client: Client): ClientSummary {
  return {
    id: client.id,
    legalName: client.legalName,
    tradeName: client.tradeName,
    taxId: client.taxId,
    status: client.status,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

/**
 * Replica a semântica de `GET /api/v1/clients` para que os testes de UI exercitem o mesmo contrato
 * que o backend publica: busca server-side por nome/CNPJ (inclusive prefixo de documento), filtros,
 * ordenação com desempate por `id` e paginação com `total`/`totalPages`.
 */
export function applyClientListQuery(
  store: Client[],
  searchParams: URLSearchParams,
): ClientListResponse {
  const limit = Number(searchParams.get('limit') ?? '20');
  const offset = Number(searchParams.get('offset') ?? '0');
  const status = searchParams.get('status');
  const requirement = searchParams.get('purchaseOrderRequirement');
  const q = searchParams.get('q')?.trim() ?? '';
  const sort = searchParams.get('sort') ?? CLIENT_LIST_SORTS.LegalName;
  const direction = searchParams.get('direction') ?? CLIENT_LIST_DIRECTIONS.Asc;

  let items = [...store];

  if (status === CLIENT_STATUSES.Active || status === CLIENT_STATUSES.Inactive) {
    items = items.filter((client) => client.status === status);
  }
  if (requirement && (Object.values(PURCHASE_ORDER_REQUIREMENTS) as string[]).includes(requirement)) {
    items = items.filter((client) => client.purchaseOrderRequirement === requirement);
  }
  if (q.length > 0) {
    const digits = q.replace(/\D/g, '');
    const isDocumentOnly = /^[\d.\-/\s]+$/.test(q);
    const lowered = q.toLowerCase();

    items = items.filter((client) => {
      if (isDocumentOnly && digits.length >= 2 && digits.length < 14) {
        return client.taxId.startsWith(digits);
      }
      if (digits.length === 14) {
        return client.taxId === digits;
      }
      if (client.id === lowered) {
        return true;
      }
      return (
        client.legalName.toLowerCase().includes(lowered) ||
        (client.tradeName ?? '').toLowerCase().includes(lowered)
      );
    });
  }

  const factor = direction === CLIENT_LIST_DIRECTIONS.Desc ? -1 : 1;
  items.sort((left, right) => {
    const column = sort === CLIENT_LIST_SORTS.UpdatedAt ? 'updatedAt' : 'legalName';
    const byColumn = left[column].localeCompare(right[column]) * factor;
    if (byColumn !== 0) {
      return byColumn;
    }
    return left.id.localeCompare(right.id) * factor;
  });

  const total = items.length;
  return {
    items: items.slice(offset, offset + limit).map(toSummary),
    limit,
    offset,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

export function createClientsFetchMock(options: ClientsFetchMockOptions = {}) {
  const shellMock = createShellFetchMock({ probeAllowed: options.probeAllowed });
  const listAllowed = options.clientListAllowed ?? true;
  const createAllowed = options.clientCreateAllowed ?? true;
  const updateAllowed = options.clientUpdateAllowed ?? true;
  const deactivateAllowed = options.clientDeactivateAllowed ?? true;
  const activateAllowed = options.clientActivateAllowed ?? true;

  const store: Client[] = options.clients ? [...options.clients] : [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      legalName: 'Cliente Demo LTDA',
      tradeName: 'Demo',
      taxId: '11222333000181',
      externalErpId: null,
      status: CLIENT_STATUSES.Active,
      version: 1,
      createdAt: '2026-01-01T12:00:00.000Z',
      updatedAt: '2026-01-01T12:00:00.000Z',
      deactivatedAt: null,
      deactivationReason: null,
      purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.NotRequired,
      contacts: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          name: 'Operações',
          purpose: CONTACT_PURPOSES.Operational,
          email: 'ops@demo.invalid',
          phone: null,
        },
      ],
      addresses: [],
    },
  ];

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (!pathname.startsWith('/api/v1/clients')) {
      return shellMock(input, init);
    }

    const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
    if (!auth?.startsWith('Bearer ')) {
      return clientError('AUTH_UNAUTHORIZED', 401);
    }

    if (pathname === '/api/v1/clients' && method === 'GET') {
      if (!listAllowed) {
        return clientError('CLIENT_DENIED', 403);
      }
      return jsonResponse(applyClientListQuery(store, searchParams));
    }

    if (pathname === '/api/v1/clients' && method === 'POST') {
      if (!createAllowed) {
        return clientError('CLIENT_DENIED', 403);
      }
      const rawBody = init?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
        legalName?: string;
        taxId?: string;
        contacts?: unknown[];
      };
      if (!body.legalName || !body.taxId || !Array.isArray(body.contacts)) {
        return clientError('CLIENT_VALIDATION_FAILED', 400);
      }
      const normalized = body.taxId.replace(/\D/g, '');
      if (store.some((client) => client.taxId === normalized)) {
        return clientError('CLIENT_TAX_ID_CONFLICT', 409);
      }
      const created: Client = {
        id: crypto.randomUUID(),
        legalName: body.legalName,
        tradeName: null,
        taxId: normalized,
        externalErpId: null,
        status: CLIENT_STATUSES.Active,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deactivatedAt: null,
        deactivationReason: null,
        purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.NotRequired,
        contacts: [
          {
            id: crypto.randomUUID(),
            name: 'Ops',
            purpose: CONTACT_PURPOSES.Operational,
            email: 'new@demo.invalid',
            phone: null,
          },
        ],
        addresses: [],
      };
      store.push(created);
      return jsonResponse(created, 201);
    }

    const clientIdMatch = pathname.match(/^\/api\/v1\/clients\/([^/]+)(?:\/(deactivate|activate))?$/);
    if (!clientIdMatch) {
      return jsonResponse({ error: { code: 'UNKNOWN' } }, 404);
    }

    const clientId = clientIdMatch[1] ?? '';
    const action = clientIdMatch[2];
    const existing = store.find((client) => client.id === clientId);

    if (method === 'GET' && !action) {
      if (clientId === '00000000-0000-4000-8000-000000000001') {
        return clientError('CLIENT_NOT_FOUND', 404);
      }
      if (!existing) {
        return clientError('CLIENT_NOT_FOUND', 404);
      }
      return jsonResponse(existing);
    }

    if (method === 'PATCH' && !action) {
      if (!updateAllowed) {
        return clientError('CLIENT_DENIED', 403);
      }
      if (clientId === '00000000-0000-4000-8000-000000000001' || !existing) {
        return clientError('CLIENT_NOT_FOUND', 404);
      }
      const rawBody = init?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
        version?: number;
        legalName?: string;
      };
      if (body.version !== existing.version) {
        return clientError('CLIENT_VERSION_CONFLICT', 409);
      }
      existing.legalName = body.legalName ?? existing.legalName;
      existing.version += 1;
      existing.updatedAt = new Date().toISOString();
      return jsonResponse(existing);
    }

    if (method === 'POST' && action === 'deactivate') {
      if (!deactivateAllowed) {
        return clientError('CLIENT_DENIED', 403);
      }
      if (clientId === '00000000-0000-4000-8000-000000000001' || !existing) {
        return clientError('CLIENT_NOT_FOUND', 404);
      }
      const rawBody = init?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
        version?: number;
        reason?: string;
      };
      if (!body.reason) {
        return clientError('CLIENT_VALIDATION_FAILED', 400);
      }
      if (body.version !== existing.version) {
        return clientError('CLIENT_VERSION_CONFLICT', 409);
      }
      existing.status = CLIENT_STATUSES.Inactive;
      existing.version += 1;
      existing.deactivatedAt = new Date().toISOString();
      existing.deactivationReason = body.reason;
      return jsonResponse(existing);
    }

    if (method === 'POST' && action === 'activate') {
      if (!activateAllowed) {
        return clientError('CLIENT_DENIED', 403);
      }
      if (clientId === '00000000-0000-4000-8000-000000000001' || !existing) {
        return clientError('CLIENT_NOT_FOUND', 404);
      }
      const rawBody = init?.body;
      const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as { version?: number };
      if (body.version !== existing.version) {
        return clientError('CLIENT_VERSION_CONFLICT', 409);
      }
      existing.status = CLIENT_STATUSES.Active;
      existing.version += 1;
      return jsonResponse(existing);
    }

    return jsonResponse({ error: { code: 'UNKNOWN' } }, 404);
  });
}

export { MOCK_IDENTITY_ID, MOCK_SESSION_ID };

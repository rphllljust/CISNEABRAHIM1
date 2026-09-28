import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { createClientsFetchMock } from './clients-fetch-mock';
import {
  CATALOG_LINEAGE_STATUSES,
  VERSION_STATUSES,
  type ServiceDefinition,
  type ServiceDefinitionVersion,
} from '../catalog/types/service-catalog.types';

export const MOCK_CATEGORY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export type CatalogFetchMockOptions = {
  catalogListAllowed?: boolean;
  catalogCreateAllowed?: boolean;
  catalogUpdateAllowed?: boolean;
  catalogPublishAllowed?: boolean;
  versionConflictOnPublish?: boolean;
};

function catalogError(code: string, status: number): Response {
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

function parseRequestBody(init?: RequestInit): Record<string, unknown> {
  const rawBody = init?.body;
  if (typeof rawBody !== 'string') {
    return {};
  }
  return JSON.parse(rawBody) as Record<string, unknown>;
}

function referenceLists() {
  return {
    units: {
      items: [{ id: 'u1', code: 'DAY', name: 'Dia', status: 'ACTIVE' }],
      limit: 100,
      offset: 0,
    },
    resourceTypes: {
      items: [{ id: 'r1', code: 'TRUCK', name: 'Caminhão', status: 'ACTIVE' }],
      limit: 100,
      offset: 0,
    },
    laborTypes: {
      items: [{ id: 'l1', code: 'DRIVER', name: 'Motorista', status: 'ACTIVE' }],
      limit: 100,
      offset: 0,
    },
    pricingModels: {
      items: [{ code: 'DAILY', persistedCode: 'PER_PERIOD', requiredUnitCode: 'DAY', impliedUnitCode: null, description: null }],
    },
    measurementModels: {
      items: [{ code: 'TIME', measurementMode: 'BY_PERIOD', measurementBasis: 'TIME', description: null }],
    },
  };
}

export function createCatalogFetchMock(options: CatalogFetchMockOptions = {}) {
  const clientsMock = createClientsFetchMock();
  const listAllowed = options.catalogListAllowed ?? true;
  const createAllowed = options.catalogCreateAllowed ?? true;
  const updateAllowed = options.catalogUpdateAllowed ?? true;
  const publishAllowed = options.catalogPublishAllowed ?? true;

  const definitionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  let lineageVersion = 1;

  const definition: ServiceDefinition = {
    id: definitionId,
    code: 'LOCACAO-DEMO',
    name: 'Locação de automóveis sem condutor',
    nameVersion: 1,
    nameVersionStatus: VERSION_STATUSES.Published,
    categoryId: MOCK_CATEGORY_ID,
    categoryCode: 'LOCACAO',
    categoryName: 'Locação',
    status: CATALOG_LINEAGE_STATUSES.Active,
    version: lineageVersion,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deactivatedAt: null,
    deactivationReason: null,
    latestPublishedVersion: 1,
    currentDraftVersion: null,
  };

  const versions: ServiceDefinitionVersion[] = [
    {
      id: 'vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv',
      serviceDefinitionId: definitionId,
      code: definition.code,
      version: 1,
      status: VERSION_STATUSES.Published,
      categoryId: MOCK_CATEGORY_ID,
      archetype: 'RENTAL',
      name: 'Locação demo',
      description: null,
      defaultUnitCode: 'DAY',
      measurementMode: 'BY_PERIOD',
      measurementBasis: 'TIME',
      billingEntitlementPolicy: 'MEASUREMENT_APPROVED',
      requiresPurchaseOrder: false,
      allowedUnits: [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }],
      resourceRequirements: [],
      laborRequirements: [],
      pricingModels: [
        {
          modelCode: 'DAILY',
          unitCode: 'DAY',
          salePrice: '100.00',
          internalCost: '80.00',
          currencyCode: 'BRL',
          sortOrder: 0,
        },
      ],
      executionRequirements: [],
      publishedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ];

  function syncDefinitionFromVersions(): void {
    definition.latestPublishedVersion =
      versions.find((version) => version.status === VERSION_STATUSES.Published)?.version ?? null;
    definition.currentDraftVersion =
      versions.find((version) => version.status === VERSION_STATUSES.Draft)?.version ?? null;
    definition.updatedAt = new Date().toISOString();
  }

  syncDefinitionFromVersions();

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (pathname.startsWith('/api/v1/catalog/service-definitions')) {
      const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
      if (!auth?.startsWith('Bearer ')) {
        return catalogError('AUTH_UNAUTHORIZED', 401);
      }

      if (pathname === '/api/v1/catalog/service-definitions' && method === 'GET') {
        if (!listAllowed) {
          return catalogError('CATALOG_DENIED', 403);
        }
        // O mock resolve a busca no SERVIDOR (nome ou code), como o backend real: filtrar so a
        // pagina atual faria o teste passar mesmo se o termo nunca fosse enviado.
        const term = (searchParams.get('q') ?? '').trim().toLowerCase();
        const matches =
          term.length === 0 ||
          definition.code.toLowerCase().includes(term) ||
          (definition.name ?? '').toLowerCase().includes(term);
        return jsonResponse({
          items: matches ? [definition] : [],
          limit: Number(searchParams.get('limit') ?? '20'),
          offset: Number(searchParams.get('offset') ?? '0'),
        });
      }

      if (pathname === '/api/v1/catalog/service-definitions' && method === 'POST') {
        if (!createAllowed) {
          return catalogError('CATALOG_DENIED', 403);
        }
        return catalogError('CATALOG_VALIDATION_FAILED', 400);
      }

      const definitionMatch = pathname.match(/^\/api\/v1\/catalog\/service-definitions\/([^/]+)(?:\/(deactivate|activate))?$/);
      if (definitionMatch) {
        return jsonResponse(definition);
      }

      const versionsListMatch = pathname.match(
        /^\/api\/v1\/catalog\/service-definitions\/([^/]+)\/versions$/,
      );
      if (versionsListMatch && method === 'GET') {
        return jsonResponse(versions);
      }
      if (versionsListMatch && method === 'POST') {
        if (!updateAllowed) {
          return catalogError('CATALOG_DENIED', 403);
        }
        if (definition.currentDraftVersion !== null) {
          return catalogError('CATALOG_INVALID_STATE', 409);
        }
        const created: ServiceDefinitionVersion = {
          ...versions[0]!,
          id: crypto.randomUUID(),
          serviceDefinitionId: definitionId,
          code: definition.code,
          version: versions.length + 1,
          status: VERSION_STATUSES.Draft,
          name: 'Locação demo v2',
          publishedAt: null,
        };
        versions.push(created);
        lineageVersion += 1;
        definition.version = lineageVersion;
        syncDefinitionFromVersions();
        return jsonResponse(created, 201);
      }

      const versionMatch = pathname.match(
        /^\/api\/v1\/catalog\/service-definitions\/([^/]+)\/versions\/(\d+)(?:\/(publish))?$/,
      );
      if (versionMatch) {
        const versionNumber = Number(versionMatch[2]);
        const action = versionMatch[3];
        const version = versions.find((entry) => entry.version === versionNumber);
        if (!version) {
          return catalogError('CATALOG_NOT_FOUND', 404);
        }

        if (action === 'publish' && method === 'POST') {
          if (!publishAllowed) {
            return catalogError('CATALOG_DENIED', 403);
          }
          const body = parseRequestBody(init);
          if (options.versionConflictOnPublish && body['lineageVersion'] !== definition.version) {
            return catalogError('CATALOG_VERSION_CONFLICT', 409);
          }
          version.status = VERSION_STATUSES.Published;
          version.publishedAt = new Date().toISOString();
          lineageVersion += 1;
          definition.version = lineageVersion;
          syncDefinitionFromVersions();
          return jsonResponse(version);
        }

        if (method === 'PATCH') {
          if (!updateAllowed) {
            return catalogError('CATALOG_DENIED', 403);
          }
          if (version.status !== VERSION_STATUSES.Draft) {
            return catalogError('CATALOG_INVALID_STATE', 409);
          }
          const body = parseRequestBody(init);
          if (body['lineageVersion'] !== definition.version) {
            return catalogError('CATALOG_VERSION_CONFLICT', 409);
          }
          version.name = typeof body['name'] === 'string' ? body['name'] : version.name;
          version.updatedAt = new Date().toISOString();
          lineageVersion += 1;
          definition.version = lineageVersion;
          return jsonResponse(version);
        }

        return jsonResponse(version);
      }
    }

    const refs = referenceLists();
    if (pathname === '/api/v1/catalog/units-of-measure') {
      return jsonResponse(refs.units);
    }
    if (pathname === '/api/v1/resources/physical-resource-types') {
      return jsonResponse(refs.resourceTypes);
    }
    if (pathname === '/api/v1/resources/labor-types') {
      return jsonResponse(refs.laborTypes);
    }
    if (pathname === '/api/v1/commercial/pricing-models') {
      return jsonResponse(refs.pricingModels);
    }
    if (pathname === '/api/v1/commercial/measurement-models') {
      return jsonResponse(refs.measurementModels);
    }

    return clientsMock(input, init);
  });
}

import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { createCatalogFetchMock } from './catalog-fetch-mock';
import {
  ASSET_ALLOCATION_STATUSES,
  ASSET_LIFECYCLE_STATUSES,
  ASSET_OPERATIONAL_AVAILABILITIES,
  VEHICLE_CLASSIFICATION,
  type PhysicalAsset,
} from '../assets/types/physical-asset.types';

const DEMO_SERVICE_ORDER_ID = '44444444-4444-4444-8444-444444444444';

export type AssetsFetchMockOptions = {
  assetListAllowed?: boolean;
  assetCreateAllowed?: boolean;
  assetUpdateAllowed?: boolean;
  assetDeactivateAllowed?: boolean;
  assetActivateAllowed?: boolean;
  versionConflictOnUpdate?: boolean;
  catalogListAllowed?: boolean;
  /** Simula o bloco de vida operacional ausente (elo negado ou sem dado). */
  omitOperationalLifecycle?: boolean;
  /** Simula ausencia de alocacao vigente no detalhe do ativo. */
  currentAllocation?: { serviceOrderId: string; orderNumber: string } | null;
};

function assetError(code: string, status: number): Response {
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

const TRUCK_TYPE_ID = '11111111-1111-4111-8111-111111111111';
const EXC_TYPE_ID = '22222222-2222-4222-8222-222222222222';

export function createAssetsFetchMock(options: AssetsFetchMockOptions = {}) {
  const catalogMock = createCatalogFetchMock({ catalogListAllowed: options.catalogListAllowed });
  const listAllowed = options.assetListAllowed ?? true;
  const createAllowed = options.assetCreateAllowed ?? true;
  const updateAllowed = options.assetUpdateAllowed ?? true;
  const deactivateAllowed = options.assetDeactivateAllowed ?? true;
  const activateAllowed = options.assetActivateAllowed ?? true;

  const store: PhysicalAsset[] = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      assetCode: 'TRK-DEMO',
      resourceTypeId: TRUCK_TYPE_ID,
      resourceTypeCode: 'TRUCK',
      resourceTypeClassification: VEHICLE_CLASSIFICATION,
      name: 'Caminhão demo',
      lifecycleStatus: ASSET_LIFECYCLE_STATUSES.Active,
      allocationStatus: ASSET_ALLOCATION_STATUSES.Available,
      unitId: 'unit-demo',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deactivatedAt: null,
      vehicle: { plate: 'DEM-0A12', chassis: 'CH-001', model: 'Volvo' },
      currentAllocation: {
        serviceOrderId: DEMO_SERVICE_ORDER_ID,
        orderNumber: 'OS-2026-DEMO01',
      },
      operationalLifecycle: {
        currentUse: {
          allocationId: 'alloc-1',
          serviceOrderId: DEMO_SERVICE_ORDER_ID,
          orderNumber: 'OS-2026-DEMO01',
          orderStatus: 'IN_EXECUTION',
          operationalStart: '2026-01-01T08:00:00.000Z',
          operationalEnd: '2026-01-01T18:00:00.000Z',
          allocationStatus: 'ACTIVE',
          timing: 'CURRENT',
        },
        nextUse: {
          allocationId: 'alloc-2',
          serviceOrderId: DEMO_SERVICE_ORDER_ID,
          orderNumber: 'OS-2026-DEMO02',
          orderStatus: 'RELEASED',
          operationalStart: '2026-02-10T08:00:00.000Z',
          operationalEnd: '2026-02-10T18:00:00.000Z',
          allocationStatus: 'ACTIVE',
          timing: 'FUTURE',
        },
        history: [
          {
            allocationId: 'alloc-0',
            serviceOrderId: DEMO_SERVICE_ORDER_ID,
            orderNumber: 'OS-2025-DEMO99',
            orderStatus: 'COMPLETED',
            operationalStart: '2025-12-01T08:00:00.000Z',
            operationalEnd: '2025-12-01T17:00:00.000Z',
            allocationStatus: 'ACTIVE',
            timing: 'PAST',
          },
        ],
        occurrences: [
          {
            id: 'occ-1',
            serviceOrderId: DEMO_SERVICE_ORDER_ID,
            orderNumber: 'OS-2025-DEMO99',
            occurrenceCode: 'TRAFFIC_DELAY',
            description: 'Atraso por trânsito na chegada ao local',
            recordedAt: '2025-12-01T09:30:00.000Z',
          },
        ],
      },
    },
  ];
  if (options.omitOperationalLifecycle) {
    store[0]!.operationalLifecycle = undefined;
  }
  if (options.currentAllocation !== undefined) {
    store[0]!.currentAllocation = options.currentAllocation;
  }

  function filterAssets(searchParams: URLSearchParams): PhysicalAsset[] {
    let items = [...store];
    const lifecycleStatus = searchParams.get('lifecycleStatus');
    const availability = searchParams.get('availability');
    const resourceTypeId = searchParams.get('resourceTypeId');
    const classification = searchParams.get('classification');
    const q = searchParams.get('q')?.trim().toLowerCase();

    if (classification) {
      items = items.filter((asset) => asset.resourceTypeClassification === classification);
    }
    if (lifecycleStatus) {
      items = items.filter((asset) => asset.lifecycleStatus === lifecycleStatus);
    }
    if (resourceTypeId) {
      items = items.filter((asset) => asset.resourceTypeId === resourceTypeId);
    }
    if (availability === ASSET_OPERATIONAL_AVAILABILITIES.Available) {
      items = items.filter(
        (asset) =>
          asset.lifecycleStatus === ASSET_LIFECYCLE_STATUSES.Active &&
          asset.allocationStatus === ASSET_ALLOCATION_STATUSES.Available,
      );
    } else if (availability === ASSET_OPERATIONAL_AVAILABILITIES.Allocated) {
      items = items.filter((asset) => asset.allocationStatus === ASSET_ALLOCATION_STATUSES.Allocated);
    } else if (availability === ASSET_OPERATIONAL_AVAILABILITIES.Unavailable) {
      items = items.filter((asset) => asset.lifecycleStatus === ASSET_LIFECYCLE_STATUSES.Inactive);
    }
    if (q) {
      items = items.filter((asset) => {
        if (asset.assetCode.toLowerCase().includes(q)) {
          return true;
        }
        if (asset.name.toLowerCase().includes(q)) {
          return true;
        }
        if (asset.vehicle?.plate.toLowerCase().includes(q)) {
          return true;
        }
        return false;
      });
    }
    return items;
  }

  function buildSummary(items: PhysicalAsset[]) {
    return {
      total: items.length,
      available: items.filter(
        (asset) =>
          asset.lifecycleStatus === ASSET_LIFECYCLE_STATUSES.Active &&
          asset.allocationStatus === ASSET_ALLOCATION_STATUSES.Available,
      ).length,
      allocated: items.filter((asset) => asset.allocationStatus === ASSET_ALLOCATION_STATUSES.Allocated)
        .length,
      unavailable: items.filter((asset) => asset.lifecycleStatus === ASSET_LIFECYCLE_STATUSES.Inactive)
        .length,
    };
  }

  const resourceTypes = {
    items: [
      {
        id: TRUCK_TYPE_ID,
        code: 'TRUCK',
        name: 'Caminhão',
        classification: VEHICLE_CLASSIFICATION,
        status: 'ACTIVE',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deactivatedAt: null,
      },
      {
        id: EXC_TYPE_ID,
        code: 'EXCAVATOR',
        name: 'Escavadeira',
        classification: 'MACHINE',
        status: 'ACTIVE',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deactivatedAt: null,
      },
    ],
    limit: 100,
    offset: 0,
  };

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (pathname === '/api/v1/resources/physical-resource-types') {
      const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
      if (!auth?.startsWith('Bearer ')) {
        return assetError('AUTH_UNAUTHORIZED', 401);
      }
      return jsonResponse(resourceTypes);
    }

    if (!pathname.startsWith('/api/v1/resources/physical-assets')) {
      return catalogMock(input, init);
    }

    const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
    if (!auth?.startsWith('Bearer ')) {
      return assetError('AUTH_UNAUTHORIZED', 401);
    }

    if (pathname === '/api/v1/resources/physical-assets/summary' && method === 'GET') {
      if (!listAllowed) {
        return assetError('ASSET_DENIED', 403);
      }
      const filtered = filterAssets(searchParams);
      return jsonResponse(buildSummary(filtered));
    }

    if (pathname === '/api/v1/resources/physical-assets' && method === 'GET') {
      if (!listAllowed) {
        return assetError('ASSET_DENIED', 403);
      }
      const limit = Number(searchParams.get('limit') ?? '20');
      const offset = Number(searchParams.get('offset') ?? '0');
      const filtered = filterAssets(searchParams);
      return jsonResponse({
        items: filtered.slice(offset, offset + limit),
        limit,
        offset,
        total: filtered.length,
      });
    }

    if (pathname === '/api/v1/resources/physical-assets' && method === 'POST') {
      if (!createAllowed) {
        return assetError('ASSET_DENIED', 403);
      }
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        assetCode?: string;
        resourceTypeId?: string;
        name?: string;
        unitId?: string;
        vehicle?: { plate?: string; chassis?: string; model?: string };
      };
      if (!body.assetCode || !body.resourceTypeId || !body.name || !body.unitId) {
        return assetError('ASSET_VALIDATION_FAILED', 400);
      }
      if (store.some((asset) => asset.assetCode === body.assetCode)) {
        return assetError('ASSET_CODE_CONFLICT', 409);
      }
      const isVehicle = body.resourceTypeId === TRUCK_TYPE_ID;
      if (isVehicle && !body.vehicle?.plate) {
        return assetError('ASSET_VEHICLE_PROFILE_REQUIRED', 400);
      }
      const created: PhysicalAsset = {
        id: crypto.randomUUID(),
        assetCode: body.assetCode,
        resourceTypeId: body.resourceTypeId,
        resourceTypeCode: isVehicle ? 'TRUCK' : 'EXCAVATOR',
        resourceTypeClassification: isVehicle ? VEHICLE_CLASSIFICATION : 'MACHINE',
        name: body.name,
        lifecycleStatus: ASSET_LIFECYCLE_STATUSES.Active,
        allocationStatus: ASSET_ALLOCATION_STATUSES.Available,
        unitId: body.unitId,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deactivatedAt: null,
        vehicle: isVehicle
          ? {
              plate: body.vehicle!.plate!,
              chassis: body.vehicle?.chassis ?? null,
              model: body.vehicle?.model ?? null,
            }
          : null,
        currentAllocation: null,
      };
      store.push(created);
      return jsonResponse(created, 201);
    }

    const assetMatch = pathname.match(/^\/api\/v1\/resources\/physical-assets\/([^/]+)(?:\/(deactivate|activate))?$/);
    if (assetMatch) {
      const assetId = assetMatch[1]!;
      const action = assetMatch[2];
      const asset = store.find((entry) => entry.id === assetId);
      if (!asset) {
        return assetError('ASSET_NOT_FOUND', 404);
      }

      if (action === 'deactivate' && method === 'POST') {
        if (!deactivateAllowed) {
          return assetError('ASSET_DENIED', 403);
        }
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { version?: number };
        if (body.version !== asset.version) {
          return assetError('ASSET_VERSION_CONFLICT', 409);
        }
        asset.lifecycleStatus = ASSET_LIFECYCLE_STATUSES.Inactive;
        asset.deactivatedAt = new Date().toISOString();
        asset.version += 1;
        return jsonResponse(asset);
      }

      if (action === 'activate' && method === 'POST') {
        if (!activateAllowed) {
          return assetError('ASSET_DENIED', 403);
        }
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { version?: number };
        if (body.version !== asset.version) {
          return assetError('ASSET_VERSION_CONFLICT', 409);
        }
        asset.lifecycleStatus = ASSET_LIFECYCLE_STATUSES.Active;
        asset.deactivatedAt = null;
        asset.version += 1;
        return jsonResponse(asset);
      }

      if (method === 'PATCH') {
        if (!updateAllowed) {
          return assetError('ASSET_DENIED', 403);
        }
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          version?: number;
          name?: string;
        };
        if (options.versionConflictOnUpdate || body.version !== asset.version) {
          return assetError('ASSET_VERSION_CONFLICT', 409);
        }
        if (body.name) {
          asset.name = body.name;
        }
        asset.version += 1;
        asset.updatedAt = new Date().toISOString();
        return jsonResponse(asset);
      }

      if (method === 'GET') {
        return jsonResponse(asset);
      }
    }

    if (method === 'POST' || method === 'PATCH') {
      return assetError('ASSET_VALIDATION_FAILED', 400);
    }

    return assetError('ASSET_NOT_FOUND', 404);
  });
}
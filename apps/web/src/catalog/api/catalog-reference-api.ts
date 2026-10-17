import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import type { RequirementLevel } from '../types/service-catalog.types';

export type UnitOfMeasureOption = {
  id: string;
  code: string;
  name: string;
  status: string;
};

export type ResourceTypeOption = {
  id: string;
  code: string;
  name: string;
  status: string;
};

export type LaborTypeOption = {
  id: string;
  code: string;
  name: string;
  status: string;
};

export type PolicyOption = {
  code: string;
  label?: string;
  persistedCode?: string;
  requiredUnitCode?: string | null;
  impliedUnitCode?: string | null;
  description?: string | null;
  basis?: string;
  defaultMeasurementMode?: string;
  compatibleMeasurementModes?: string[];
  suggestedUnitCodes?: string[];
};

export type CatalogVocabulary = {
  archetypes: string[];
  measurementModes: string[];
  billingEntitlementPolicies: string[];
  requirementLevels: RequirementLevel[];
  executionRequirementTypes: string[];
  executionConditionTypes: string[];
};

export type ServiceCategoryOption = {
  id: string;
  code: string;
  name: string;
};

export type CatalogReferenceApiErrorKind = 'denied' | 'network' | 'server';

export class CatalogReferenceApiError extends Error {
  constructor(
    readonly status: number,
    readonly kind: CatalogReferenceApiErrorKind,
  ) {
    super(kind);
  }
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new CatalogReferenceApiError(401, 'denied');
  }
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    });
    if (!response.ok) {
      throw new CatalogReferenceApiError(
        response.status,
        response.status === 401 || response.status === 403 ? 'denied' : 'server',
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof CatalogReferenceApiError) {
      throw error;
    }
    if (signal?.aborted) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new CatalogReferenceApiError(0, 'network');
    }
    throw new CatalogReferenceApiError(0, 'server');
  }
}

export async function listUnitsOfMeasure(signal?: AbortSignal): Promise<UnitOfMeasureOption[]> {
  const body = await requestJson<{ items: UnitOfMeasureOption[] }>(
    '/api/v1/catalog/units-of-measure?limit=100&offset=0&status=ACTIVE',
    signal,
  );
  return body.items;
}

export async function listPhysicalResourceTypes(signal?: AbortSignal): Promise<ResourceTypeOption[]> {
  const body = await requestJson<{ items: ResourceTypeOption[] }>(
    '/api/v1/resources/physical-resource-types?limit=100&offset=0&status=ACTIVE',
    signal,
  );
  return body.items;
}

export async function listLaborTypes(signal?: AbortSignal): Promise<LaborTypeOption[]> {
  const body = await requestJson<{ items: LaborTypeOption[] }>(
    '/api/v1/resources/labor-types?limit=100&offset=0&status=ACTIVE',
    signal,
  );
  return body.items;
}

export async function listPricingModelPolicies(signal?: AbortSignal): Promise<PolicyOption[]> {
  const body = await requestJson<{ items: PolicyOption[] }>(
    '/api/v1/commercial/pricing-models',
    signal,
  );
  return body.items;
}

export async function listServiceCategories(signal?: AbortSignal): Promise<ServiceCategoryOption[]> {
  const body = await requestJson<{ items: ServiceCategoryOption[] }>(
    '/api/v1/catalog/service-definitions/categories',
    signal,
  );
  return body.items;
}

export async function listMeasurementModelPolicies(signal?: AbortSignal): Promise<PolicyOption[]> {
  const body = await requestJson<{ items: PolicyOption[] }>(
    '/api/v1/commercial/measurement-models',
    signal,
  );
  return body.items;
}

export async function getCatalogVocabulary(signal?: AbortSignal): Promise<CatalogVocabulary> {
  return requestJson<CatalogVocabulary>(
    '/api/v1/catalog/service-definitions/reference-data',
    signal,
  );
}

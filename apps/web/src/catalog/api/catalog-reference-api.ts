import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';

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
  label: string;
};

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    return null;
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
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    if (isNetworkError(error)) {
      return null;
    }
    return null;
  }
}

export async function listUnitsOfMeasure(signal?: AbortSignal): Promise<UnitOfMeasureOption[]> {
  const body = await requestJson<{ items: UnitOfMeasureOption[] }>(
    '/api/v1/catalog/units-of-measure?limit=100&offset=0&status=ACTIVE',
    signal,
  );
  return body?.items ?? [];
}

export async function listPhysicalResourceTypes(signal?: AbortSignal): Promise<ResourceTypeOption[]> {
  const body = await requestJson<{ items: ResourceTypeOption[] }>(
    '/api/v1/resources/physical-resource-types?limit=100&offset=0&status=ACTIVE',
    signal,
  );
  return body?.items ?? [];
}

export async function listLaborTypes(signal?: AbortSignal): Promise<LaborTypeOption[]> {
  const body = await requestJson<{ items: LaborTypeOption[] }>(
    '/api/v1/resources/labor-types?limit=100&offset=0&status=ACTIVE',
    signal,
  );
  return body?.items ?? [];
}

export async function listPricingModelPolicies(signal?: AbortSignal): Promise<PolicyOption[]> {
  const body = await requestJson<{ items: PolicyOption[] }>(
    '/api/v1/commercial/pricing-models',
    signal,
  );
  return body?.items ?? [];
}

export type ServiceCategoryOption = {
  id: string;
  code: string;
  name: string;
};

export async function listServiceCategories(signal?: AbortSignal): Promise<ServiceCategoryOption[]> {
  const body = await requestJson<{ items: ServiceCategoryOption[] }>(
    '/api/v1/catalog/service-definitions/categories',
    signal,
  );
  return body?.items ?? [];
}

export async function listMeasurementModelPolicies(signal?: AbortSignal): Promise<PolicyOption[]> {
  const body = await requestJson<{ items: PolicyOption[] }>(
    '/api/v1/commercial/measurement-models',
    signal,
  );
  return body?.items ?? [];
}

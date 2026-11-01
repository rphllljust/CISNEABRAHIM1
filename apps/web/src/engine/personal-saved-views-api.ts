import { getApiBaseUrl } from '../auth/api/auth-api';
import { tokenStore } from '../auth/storage/token-store';
import type { SavedView } from './DynamicSavedViews';

/**
 * The backend is authoritative for personal WorkspaceQueue saved views.
 * A response that fails HTTP or schema validation is NOT an empty list.
 */
export class PersonalSavedViewsApiError extends Error {
  constructor(readonly status: number) {
    super(`SAVED_VIEWS_API_${status}`);
  }
}

function authorizationHeaders(): HeadersInit {
  const token = tokenStore.getAccessToken();
  if (!token) throw new PersonalSavedViewsApiError(401);
  return { Accept: 'application/json', Authorization: `Bearer ${token}` };
}

function endpoint(viewKey: string, id?: string): string {
  return `${getApiBaseUrl()}/api/v1/personalization/saved-views/${encodeURIComponent(viewKey)}${id ? `/${encodeURIComponent(id)}` : ''}`;
}

function asView(value: unknown): SavedView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersonalSavedViewsApiError(502);
  }
  const view = value as Record<string, unknown>;
  const filters = view['filters'];
  if (
    typeof view['id'] !== 'string' ||
    typeof view['name'] !== 'string' ||
    typeof view['createdAt'] !== 'string' ||
    view['viewType'] !== 'list' ||
    !filters || typeof filters !== 'object' || Array.isArray(filters) ||
    Object.entries(filters).some(([, val]) => typeof val !== 'string')
  ) {
    throw new PersonalSavedViewsApiError(502);
  }
  return {
    id: view['id'],
    name: view['name'],
    createdAt: view['createdAt'],
    viewType: 'list',
    filters: filters as Record<string, string>,
  };
}

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        ...authorizationHeaders(),
        ...(options.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof PersonalSavedViewsApiError) throw error;
    throw new PersonalSavedViewsApiError(0);
  }
  if (!response.ok) throw new PersonalSavedViewsApiError(response.status);
  try {
    return await response.json() as unknown;
  } catch {
    throw new PersonalSavedViewsApiError(502);
  }
}

export async function listPersonalSavedViews(
  viewKey: string,
  signal?: AbortSignal,
): Promise<SavedView[]> {
  const result = await request(endpoint(viewKey), { method: 'GET', signal });
  if (!Array.isArray(result) || result.length > 50) throw new PersonalSavedViewsApiError(502);
  return result.map(asView);
}

export async function savePersonalSavedView(
  viewKey: string,
  payload: { name: string; filters: Record<string, string>; viewType: string },
): Promise<SavedView> {
  return asView(await request(endpoint(viewKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

export async function deletePersonalSavedView(viewKey: string, id: string): Promise<void> {
  const response = await request(endpoint(viewKey, id), { method: 'DELETE' });
  if (!response || typeof response !== 'object' || (response as { deleted?: unknown }).deleted !== true) {
    throw new PersonalSavedViewsApiError(502);
  }
}

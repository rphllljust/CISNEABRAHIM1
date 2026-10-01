import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import type {
  SupplierAuditTimelineResponse,
  SupplierAvailableActionsResponse,
  SupplierCommandCatalogResponse,
} from '../types/supplier-meta.types';

/**
 * Client dos endpoints "meta" de Fornecedor.
 *
 * Espelha `service-order-meta-api.ts` — mesmas rotas, mesmo tratamento de erro, mesma
 * assinatura. A simetria é o que permite que o provider global (`SessionMetaProvider`,
 * de service-orders) hidrate o catálogo de fornecedor sem duplicar lógica.
 */

export type SupplierMetaApiErrorKind = 'denied' | 'not_found' | 'network' | 'unknown';

export class SupplierMetaApiError extends Error {
  readonly status: number;
  readonly kind: SupplierMetaApiErrorKind;

  constructor(status: number, kind: SupplierMetaApiErrorKind) {
    super(kind);
    this.status = status;
    this.kind = kind;
  }
}

function classifyError(status: number): SupplierMetaApiErrorKind {
  if (status === 403) {
    return 'denied';
  }
  if (status === 404) {
    return 'not_found';
  }
  return 'unknown';
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new SupplierMetaApiError(401, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw new SupplierMetaApiError(response.status, classifyError(response.status));
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof SupplierMetaApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new SupplierMetaApiError(0, 'network');
    }
    throw new SupplierMetaApiError(0, 'unknown');
  }
}

/** Catálogo global de comandos de fornecedor. Hidratado uma vez pelo provider. */
export function fetchSupplierCommandCatalog(
  signal?: AbortSignal,
): Promise<SupplierCommandCatalogResponse> {
  return requestJson<SupplierCommandCatalogResponse>('/api/v1/suppliers/command-catalog', signal);
}

/**
 * Comandos válidos para um fornecedor no estado atual.
 *
 * Esta é a fonte de verdade dos botões. O front NÃO replica o mapa de status: quem decide
 * quais comandos existem é o backend.
 */
export function fetchSupplierAvailableActions(
  supplierId: string,
  signal?: AbortSignal,
): Promise<SupplierAvailableActionsResponse> {
  return requestJson<SupplierAvailableActionsResponse>(
    `/api/v1/suppliers/${supplierId}/available-actions`,
    signal,
  );
}

/** Trilha de auditoria do fornecedor, em ordem cronológica. */
export function fetchSupplierAuditTimeline(
  supplierId: string,
  options: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<SupplierAuditTimelineResponse> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set('offset', String(options.offset));
  }
  const query = params.toString();
  const suffix = query.length > 0 ? `?${query}` : '';
  return requestJson<SupplierAuditTimelineResponse>(
    `/api/v1/suppliers/${supplierId}/audit-timeline${suffix}`,
    signal,
  );
}

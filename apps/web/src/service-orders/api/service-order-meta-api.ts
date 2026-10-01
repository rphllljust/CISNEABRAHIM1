import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import type {
  AuditTimelineResponse,
  AvailableActionsResponse,
  CommandCatalogResponse,
  MeResponse,
} from '../types/service-order-meta.types';

export type ServiceOrderMetaApiErrorKind = 'denied' | 'not_found' | 'network' | 'unknown';

export class ServiceOrderMetaApiError extends Error {
  readonly status: number;
  readonly kind: ServiceOrderMetaApiErrorKind;

  constructor(status: number, kind: ServiceOrderMetaApiErrorKind) {
    super(kind);
    this.status = status;
    this.kind = kind;
  }
}

function classifyError(status: number): ServiceOrderMetaApiErrorKind {
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
    throw new ServiceOrderMetaApiError(401, 'denied');
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
      throw new ServiceOrderMetaApiError(response.status, classifyError(response.status));
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ServiceOrderMetaApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ServiceOrderMetaApiError(0, 'network');
    }
    throw new ServiceOrderMetaApiError(0, 'unknown');
  }
}

/**
 * Identidade, permissões efetivas e escopos do usuário autenticado.
 *
 * Chamado UMA vez por sessão pelo provider (`SessionMetaProvider`), nunca por componente.
 */
export function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  return requestJson<MeResponse>('/api/v1/me', signal);
}

/**
 * Comandos válidos para uma OS no estado atual, com a permissão específica de cada um.
 *
 * Esta é a fonte de verdade dos botões de ação. O front NÃO replica a state machine:
 * `resolveServiceOrderNextAction` (mapa status→comando mantido no front) foi removido
 * justamente porque duplicava esta resposta.
 */
export function fetchAvailableActions(
  serviceOrderId: string,
  signal?: AbortSignal,
): Promise<AvailableActionsResponse> {
  return requestJson<AvailableActionsResponse>(
    `/api/v1/service-orders/${serviceOrderId}/available-actions`,
    signal,
  );
}

/** Trilha de auditoria da OS, em ordem cronológica ascendente. */
export function fetchAuditTimeline(
  serviceOrderId: string,
  options: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<AuditTimelineResponse> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set('offset', String(options.offset));
  }
  const query = params.toString();
  const suffix = query.length > 0 ? `?${query}` : '';
  return requestJson<AuditTimelineResponse>(
    `/api/v1/service-orders/${serviceOrderId}/audit-timeline${suffix}`,
    signal,
  );
}

/**
 * Catálogo global de comandos da state machine.
 *
 * Carregado UMA vez pelo provider e reutilizado para hidratar rótulos em qualquer lugar,
 * substituindo os textos hardcoded ("Preparar", "Liberar") que existiam no front.
 */
export function fetchCommandCatalog(signal?: AbortSignal): Promise<CommandCatalogResponse> {
  return requestJson<CommandCatalogResponse>('/api/v1/service-orders/command-catalog', signal);
}

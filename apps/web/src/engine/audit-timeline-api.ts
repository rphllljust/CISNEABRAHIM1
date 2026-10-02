import { getApiBaseUrl, isNetworkError } from '../auth/api/auth-api';
import { tokenStore } from '../auth/storage/token-store';

/**
 * Cliente das trilhas de auditoria.
 *
 * CONTRATO REAL, NÃO IDEAL: os endpoints de timeline que existem hoje são POR MÓDULO
 * (`/api/v1/service-orders/:id/audit-timeline` e `/api/v1/suppliers/:id/audit-timeline`), com
 * o mesmo payload. Não existe `/api/v1/:entity/:id/audit-timeline`.
 *
 * Por isso este cliente recebe o CAMINHO do recurso, não o nome da entidade: a engine monta a
 * URL a partir de um resolvedor que a tela fornece. Quando o backend publicar a rota genérica,
 * só o resolvedor muda — nenhum componente da engine.
 */

export type AuditTimelineEvent = {
  id: string;
  data: string;
  usuario_id: string | null;
  usuario_nome: string | null;
  acao: string;
  status_anterior: string | null;
  status_novo: string | null;
  comando: string | null;
  correlation_id: string;
};

export type AuditTimelineResponse = {
  eventos: AuditTimelineEvent[];
  total: number;
};

export type AuditTimelineStatus = 'loading' | 'ready' | 'denied' | 'not_found' | 'error';

export class AuditTimelineApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`AUDIT_TIMELINE_${status}`);
    this.status = status;
  }
}

/**
 * Resolve o caminho da timeline de um registro.
 *
 * Recebe o recurso (`service-orders`, `suppliers`) e o id. Devolver `null` significa "esta
 * entidade não publica timeline" — a engine então não desenha o bloco, em vez de tentar uma
 * rota que responderia 404.
 */
export type AuditTimelinePathResolver = (entity: string, recordId: string) => string | null;

/**
 * Resolvedor padrão: só os dois recursos que o backend realmente publica.
 *
 * Adicionar um terceiro exige backend. Enquanto isso, a lista aqui é a verdade do contrato —
 * mantê-la explícita é melhor que uma URL genérica que falharia silenciosamente.
 */
export const DEFAULT_AUDIT_TIMELINE_PATHS: Record<string, string> = {
  'service-orders': '/api/v1/service-orders',
  suppliers: '/api/v1/suppliers',
};

export const defaultAuditTimelinePath: AuditTimelinePathResolver = (entity, recordId) => {
  const base = DEFAULT_AUDIT_TIMELINE_PATHS[entity];
  return base ? `${base}/${recordId}/audit-timeline` : null;
};

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new AuditTimelineApiError(401);
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function fetchAuditTimeline(
  path: string,
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
  const url = `${getApiBaseUrl()}${path}${query.length > 0 ? `?${query}` : ''}`;

  try {
    const response = await fetch(url, { method: 'GET', headers: authHeaders(), signal });
    if (!response.ok) {
      throw new AuditTimelineApiError(response.status);
    }
    return (await response.json()) as AuditTimelineResponse;
  } catch (error) {
    if (error instanceof AuditTimelineApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new AuditTimelineApiError(0);
    }
    throw new AuditTimelineApiError(0);
  }
}

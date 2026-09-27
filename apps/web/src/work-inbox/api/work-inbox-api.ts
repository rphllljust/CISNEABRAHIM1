import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';

/**
 * UNIFIED WORK INBOX — cliente do read model unico.
 *
 * Uma requisicao monta a fila inteira (`GET /work-inbox`): o browser nao dispara uma
 * requisicao por dominio e nao faz merge de seis listas.
 *
 * `unavailableDomains` existe para que uma fonte indisponivel seja DITA ao operador: fila
 * incompleta apresentada como completa e pior que um erro visivel.
 */

export const WORK_DOMAINS = [
  'FINANCEIRO',
  'FISCAL',
  'CONTABILIDADE',
  'OPERACOES',
  'COMERCIAL',
  'SUPRIMENTOS',
] as const;

export type WorkDomain = (typeof WORK_DOMAINS)[number];

export const WORK_KINDS = ['BLOCKER', 'OVERDUE', 'APPROVAL', 'EXCEPTION', 'CONTINUITY'] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

export type WorkItem = {
  id: string;
  domain: WorkDomain;
  kind: WorkKind;
  businessReference: string;
  title: string;
  contextLabel: string;
  status: string;
  reason: string;
  occurredAt: string;
  dueAt: string | null;
  actionLabel: string;
  targetRoute: string;
  unitId: string | null;
};

export type WorkInboxPage = {
  items: WorkItem[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
  byDomain: Record<WorkDomain, number>;
  unavailableDomains: string[];
};

export type WorkInboxFilters = {
  domain?: WorkDomain | null;
  kind?: WorkKind | null;
  status?: string | null;
  unitId?: string | null;
  overdue?: boolean;
  limit?: number;
  offset?: number;
};

export class WorkInboxApiError extends Error {
  constructor(
    readonly status: number,
    readonly kind: 'denied' | 'network' | 'unknown',
  ) {
    super(`work-inbox request failed (${status})`);
    this.name = 'WorkInboxApiError';
  }
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new WorkInboxApiError(401, 'denied');
  }
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
}

export function buildWorkInboxQuery(filters: WorkInboxFilters): string {
  const params = new URLSearchParams();
  if (filters.domain) {
    params.set('domain', filters.domain);
  }
  if (filters.kind) {
    params.set('kind', filters.kind);
  }
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.unitId) {
    params.set('unitId', filters.unitId);
  }
  if (filters.overdue) {
    params.set('overdue', 'true');
  }
  if (typeof filters.limit === 'number') {
    params.set('limit', String(filters.limit));
  }
  if (typeof filters.offset === 'number') {
    params.set('offset', String(filters.offset));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function getWorkInbox(
  filters: WorkInboxFilters,
  signal?: AbortSignal,
): Promise<WorkInboxPage> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/work-inbox${buildWorkInboxQuery(filters)}`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw new WorkInboxApiError(response.status, response.status === 403 ? 'denied' : 'unknown');
    }
    return (await response.json()) as WorkInboxPage;
  } catch (error) {
    if (error instanceof WorkInboxApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new WorkInboxApiError(0, 'network');
    }
    throw error;
  }
}

/** Rotulo humano da natureza do trabalho. */
export const WORK_KIND_LABELS: Record<WorkKind, string> = {
  BLOCKER: 'Bloqueio',
  OVERDUE: 'Vencido',
  APPROVAL: 'Aprovação',
  EXCEPTION: 'Exceção',
  CONTINUITY: 'Continuidade',
};

/** Rotulo humano do dominio. */
export const WORK_DOMAIN_LABELS: Record<WorkDomain, string> = {
  FINANCEIRO: 'Financeiro',
  FISCAL: 'Fiscal',
  CONTABILIDADE: 'Contabilidade',
  OPERACOES: 'Operações',
  COMERCIAL: 'Comercial',
  SUPRIMENTOS: 'Suprimentos',
};

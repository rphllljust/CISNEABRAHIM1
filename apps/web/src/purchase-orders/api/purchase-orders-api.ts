import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  PURCHASE_ORDER_ERROR_CODES,
  type CancelPurchaseOrderPayload,
  type CreatePurchaseOrderPayload,
  type LinkPurchaseOrderDocumentPayload,
  type PurchaseOrderDetail,
  type PurchaseOrderErrorCode,
  type PurchaseOrderListResponse,
  type UpdatePurchaseOrderDraftPayload,
} from '../types/purchase-order.types';

export type PurchaseOrdersApiErrorKind =
  | 'denied'
  | 'not_found'
  | 'validation'
  | 'version_conflict'
  | 'invalid_state'
  | 'network'
  | 'unknown';

export class PurchaseOrdersApiError extends Error {
  readonly status: number;
  readonly code?: PurchaseOrderErrorCode;
  readonly kind: PurchaseOrdersApiErrorKind;

  constructor(
    status: number,
    code: PurchaseOrderErrorCode | undefined,
    kind: PurchaseOrdersApiErrorKind,
  ) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

type RequestErrorBody = {
  error?: { code?: PurchaseOrderErrorCode; message?: string };
  code?: PurchaseOrderErrorCode;
  message?: string;
};

const PROBE_PURCHASE_ORDER_ID = '00000000-0000-4000-8000-000000000004';

function classifyError(
  status: number,
  code: PurchaseOrderErrorCode | undefined,
): PurchaseOrdersApiErrorKind {
  if (code === PURCHASE_ORDER_ERROR_CODES.DENIED || status === 403) {
    return 'denied';
  }
  if (code === PURCHASE_ORDER_ERROR_CODES.NOT_FOUND || status === 404) {
    return 'not_found';
  }
  if (code === PURCHASE_ORDER_ERROR_CODES.VERSION_CONFLICT) {
    return 'version_conflict';
  }
  if (code === PURCHASE_ORDER_ERROR_CODES.INVALID_STATE) {
    return 'invalid_state';
  }
  if (code === PURCHASE_ORDER_ERROR_CODES.VALIDATION_FAILED || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<PurchaseOrdersApiError> {
  let code: PurchaseOrderErrorCode | undefined;
  try {
    const body = (await response.json()) as RequestErrorBody;
    code = body.error?.code ?? body.code;
  } catch {
    // ignore parse errors
  }
  return new PurchaseOrdersApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new PurchaseOrdersApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, init);
    if (!response.ok) {
      throw await parseError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof PurchaseOrdersApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new PurchaseOrdersApiError(0, undefined, 'network');
    }
    throw new PurchaseOrdersApiError(0, undefined, 'unknown');
  }
}

export type ListPurchaseOrdersParams = {
  limit: number;
  offset: number;
  clientId?: string;
  unitId?: string;
  /** Situação do pedido, pelo vocabulário do domínio (`com.purchase_order_status`). */
  status?: string;
  /** Busca textual: número do pedido, RC e código interno, conforme o contrato do servidor. */
  search?: string;
  /** Janela de emissão, em ISO. O servidor decide o que é inclusivo. */
  issueFrom?: string;
  issueTo?: string;
  /** Filtro avançado já convertido para o contrato do servidor. */
  advanced?: import('../../engine').AdvancedFilterPayload | null;
};

/**
 * Monta a query da listagem.
 *
 * REGRA: só entra na query o recorte que o SERVIDOR sabe aplicar. Cada parâmetro abaixo corresponde
 * a um predicado real de `buildPurchaseOrderListWhere`/`buildPurchaseOrderAdvancedClause`
 * (`apps/api/src/commercial/repositories/purchase-order-list-sql.ts`). Um parâmetro emitido sem
 * predicado faria o servidor ignorar o recorte em silêncio e devolver a lista inteira — o defeito
 * clássico em que a tela afirma um filtro que não existe.
 */
export function buildListPurchaseOrdersQuery(params: ListPurchaseOrdersParams): string {
  const search = new URLSearchParams();
  search.set('limit', String(params.limit));
  search.set('offset', String(params.offset));
  if (params.clientId) {
    search.set('clientId', params.clientId);
  }
  if (params.unitId) {
    search.set('unitId', params.unitId);
  }
  if (params.status) {
    search.set('status', params.status);
  }
  const term = params.search?.trim();
  if (term) {
    search.set('q', term);
  }
  if (params.issueFrom) {
    search.set('issueFrom', params.issueFrom);
  }
  if (params.issueTo) {
    search.set('issueTo', params.issueTo);
  }
  // O filtro composto entra na MESMA query: paginação, janela e recorte avançado compõem um único
  // predicado no servidor, e não três leituras reconciliadas no browser.
  if (params.advanced && params.advanced.groups.length > 0) {
    search.set('filters', JSON.stringify(params.advanced));
  }
  return search.toString();
}

export async function listPurchaseOrders(
  params: ListPurchaseOrdersParams,
  signal?: AbortSignal,
): Promise<PurchaseOrderListResponse> {
  const query = buildListPurchaseOrdersQuery(params);
  return requestJson<PurchaseOrderListResponse>(`/api/v1/commercial/purchase-orders?${query}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getPurchaseOrder(
  purchaseOrderId: string,
  signal?: AbortSignal,
): Promise<PurchaseOrderDetail> {
  return requestJson<PurchaseOrderDetail>(`/api/v1/commercial/purchase-orders/${purchaseOrderId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createPurchaseOrder(
  payload: CreatePurchaseOrderPayload,
  signal?: AbortSignal,
): Promise<PurchaseOrderDetail> {
  return requestJson<PurchaseOrderDetail>('/api/v1/commercial/purchase-orders', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function updatePurchaseOrderDraft(
  purchaseOrderId: string,
  payload: UpdatePurchaseOrderDraftPayload,
  signal?: AbortSignal,
): Promise<PurchaseOrderDetail> {
  return requestJson<PurchaseOrderDetail>(`/api/v1/commercial/purchase-orders/${purchaseOrderId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function registerPurchaseOrder(
  purchaseOrderId: string,
  rowVersion: number,
  signal?: AbortSignal,
): Promise<PurchaseOrderDetail> {
  return requestJson<PurchaseOrderDetail>(
    `/api/v1/commercial/purchase-orders/${purchaseOrderId}/register`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowVersion }),
      signal,
    },
  );
}

export async function cancelPurchaseOrder(
  purchaseOrderId: string,
  payload: CancelPurchaseOrderPayload,
  signal?: AbortSignal,
): Promise<PurchaseOrderDetail> {
  return requestJson<PurchaseOrderDetail>(
    `/api/v1/commercial/purchase-orders/${purchaseOrderId}/cancel`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export async function linkPurchaseOrderDocument(
  purchaseOrderId: string,
  payload: LinkPurchaseOrderDocumentPayload,
  signal?: AbortSignal,
): Promise<PurchaseOrderDetail> {
  return requestJson<PurchaseOrderDetail>(
    `/api/v1/commercial/purchase-orders/${purchaseOrderId}/documents`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

export type PurchaseOrderCapabilities = {
  canList: boolean;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canRegister: boolean;
  canCancel: boolean;
};

async function probeMutation(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<boolean> {
  try {
    await requestJson(path, {
      method,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return true;
  } catch (error) {
    if (error instanceof PurchaseOrdersApiError) {
      if (error.kind === 'denied') {
        return false;
      }
      if (
        error.kind === 'not_found' ||
        error.kind === 'validation' ||
        error.kind === 'invalid_state' ||
        error.kind === 'version_conflict'
      ) {
        return true;
      }
    }
    return false;
  }
}

export async function probePurchaseOrderCapabilities(
  signal?: AbortSignal,
): Promise<PurchaseOrderCapabilities> {
  let canList = false;
  try {
    await listPurchaseOrders({ limit: 1, offset: 0 }, signal);
    canList = true;
  } catch (error) {
    if (error instanceof PurchaseOrdersApiError && error.kind === 'denied') {
      canList = false;
    }
  }

  const probeId = PROBE_PURCHASE_ORDER_ID;
  const [canCreate, canRead, canUpdate, canRegister, canCancel] = await Promise.all([
    probeMutation('/api/v1/commercial/purchase-orders', 'POST', {}),
    (async () => {
      try {
        await getPurchaseOrder(probeId, signal);
        return true;
      } catch (error) {
        if (error instanceof PurchaseOrdersApiError) {
          return error.kind !== 'denied';
        }
        return false;
      }
    })(),
    probeMutation(`/api/v1/commercial/purchase-orders/${probeId}`, 'PATCH', { rowVersion: 1 }),
    probeMutation(`/api/v1/commercial/purchase-orders/${probeId}/register`, 'POST', {
      rowVersion: 1,
    }),
    probeMutation(`/api/v1/commercial/purchase-orders/${probeId}/cancel`, 'POST', {
      rowVersion: 1,
    }),
  ]);

  return { canList, canCreate, canRead, canUpdate, canRegister, canCancel };
}

export async function probePurchaseOrderListAccess(signal?: AbortSignal): Promise<boolean> {
  try {
    await listPurchaseOrders({ limit: 1, offset: 0 }, signal);
    return true;
  } catch (error) {
    if (error instanceof PurchaseOrdersApiError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.kind === 'denied') {
        return false;
      }
    }
    return false;
  }
}

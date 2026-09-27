import {
  authHeaders,
  BACKOFFICE_PROBE_ID,
  jsonHeaders,
  probeReadAccess,
  requestJson,
} from '../../financial-ui/enterprise-api';
import type {
  SupplierDetail,
  SupplierHistoryItem,
  SupplierListResponse,
} from '../types/supplier.types';

export type SupplierListParams = {
  limit: number;
  offset: number;
  status?: string;
  q?: string;
};

/**
 * Listagem de fornecedores por referência humana. A tela não deve exigir que o operador
 * conheça o identificador técnico do fornecedor.
 */
export async function listSuppliers(
  params: SupplierListParams,
  signal?: AbortSignal,
): Promise<SupplierListResponse> {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.q && params.q.trim().length > 0) {
    search.set('q', params.q.trim());
  }
  return requestJson<SupplierListResponse>(`/api/v1/suppliers?${search.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getSupplier(supplierId: string, signal?: AbortSignal): Promise<SupplierDetail> {
  return requestJson<SupplierDetail>(`/api/v1/suppliers/${supplierId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getSupplierHistory(
  supplierId: string,
  signal?: AbortSignal,
): Promise<SupplierHistoryItem[]> {
  return requestJson<SupplierHistoryItem[]>(`/api/v1/suppliers/${supplierId}/history`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createSupplier(payload: Record<string, unknown>): Promise<SupplierDetail> {
  return requestJson<SupplierDetail>('/api/v1/suppliers', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function activateSupplier(supplierId: string, payload: { version: number }): Promise<SupplierDetail> {
  return requestJson<SupplierDetail>(`/api/v1/suppliers/${supplierId}/activate`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function deactivateSupplier(
  supplierId: string,
  payload: { version: number; reason?: string },
): Promise<SupplierDetail> {
  return requestJson<SupplierDetail>(`/api/v1/suppliers/${supplierId}/deactivate`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function updateSupplier(
  supplierId: string,
  payload: Record<string, unknown>,
): Promise<SupplierDetail> {
  return requestJson<SupplierDetail>(`/api/v1/suppliers/${supplierId}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function probeSupplierReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(`/api/v1/suppliers/${BACKOFFICE_PROBE_ID}`, signal);
}

/**
 * Sonda a listagem real (`GET /suppliers`) em vez de um identificador sintético: se o ator não
 * tem concessão de lista, a rota de lista precisa negar a entrada em vez de mostrar uma tela
 * vazia.
 */
export async function probeSupplierListAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess('/api/v1/suppliers?limit=1&offset=0', signal);
}

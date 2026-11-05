import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import {
  REPORT_ERROR_CODES,
  type ReportCatalogItem,
  type ReportErrorCode,
  type ReportExportSummary,
  type ReportFilters,
  type ReportPreviewResponse,
} from '../types/reports.types';

export type ReportsApiErrorKind = 'denied' | 'invalid' | 'not_ready' | 'network' | 'unknown';

export class ReportsApiError extends Error {
  readonly status: number;
  readonly code?: ReportErrorCode;
  readonly kind: ReportsApiErrorKind;

  constructor(status: number, code: ReportErrorCode | undefined, kind: ReportsApiErrorKind) {
    super(kind);
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new ReportsApiError(401, undefined, 'denied');
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

function buildFilterQuery(filters: ReportFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.period) {
    params.set('period', filters.period);
  }
  if (filters.from) {
    params.set('from', filters.from);
  }
  if (filters.to) {
    params.set('to', filters.to);
  }
  if (filters.unitId) {
    params.set('unitId', filters.unitId);
  }
  if (filters.clientId) {
    params.set('clientId', filters.clientId);
  }
  if (filters.serviceDefinitionId) {
    params.set('serviceDefinitionId', filters.serviceDefinitionId);
  }
  if (filters.status) {
    params.set('status', filters.status);
  }
  return params;
}

async function parseError(response: Response): Promise<ReportsApiError> {
  let code: ReportErrorCode | undefined;
  try {
    const body = (await response.json()) as {
      code?: ReportErrorCode;
      error?: { code?: ReportErrorCode };
    };
    // A API pode serializar o erro no envelope { error: { code } }.
    code = body.error?.code ?? body.code;
  } catch {
    code = undefined;
  }

  if (code === REPORT_ERROR_CODES.ACCESS_DENIED || response.status === 401 || response.status === 403) {
    return new ReportsApiError(response.status, code, 'denied');
  }
  if (code === REPORT_ERROR_CODES.NOT_READY || response.status === 409) {
    return new ReportsApiError(response.status, code, 'not_ready');
  }
  if (code === REPORT_ERROR_CODES.INVALID_REQUEST || response.status === 400) {
    return new ReportsApiError(response.status, code, 'invalid');
  }
  return new ReportsApiError(response.status, code, 'unknown');
}

export async function getReportCatalog(signal?: AbortSignal): Promise<ReportCatalogItem[]> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/reports/catalog`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as ReportCatalogItem[];
  } catch (error) {
    if (error instanceof ReportsApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ReportsApiError(0, undefined, 'network');
    }
    throw new ReportsApiError(500, undefined, 'unknown');
  }
}

export async function previewReport(
  reportType: string,
  filters: ReportFilters,
  signal?: AbortSignal,
): Promise<ReportPreviewResponse> {
  const params = buildFilterQuery(filters);
  params.set('reportType', reportType);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/reports/exports/preview?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as ReportPreviewResponse;
  } catch (error) {
    if (error instanceof ReportsApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ReportsApiError(0, undefined, 'network');
    }
    throw new ReportsApiError(500, undefined, 'unknown');
  }
}

export async function createReportExport(
  reportType: string,
  filters: ReportFilters,
  format = 'CSV',
  signal?: AbortSignal,
): Promise<ReportExportSummary> {
  const params = buildFilterQuery(filters);
  params.set('reportType', reportType);
  params.set('format', format);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/reports/exports?${params.toString()}`, {
      method: 'POST',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as ReportExportSummary;
  } catch (error) {
    if (error instanceof ReportsApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ReportsApiError(0, undefined, 'network');
    }
    throw new ReportsApiError(500, undefined, 'unknown');
  }
}

export async function getReportExport(exportId: string, signal?: AbortSignal): Promise<ReportExportSummary> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/reports/exports/${exportId}`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as ReportExportSummary;
  } catch (error) {
    if (error instanceof ReportsApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ReportsApiError(0, undefined, 'network');
    }
    throw new ReportsApiError(500, undefined, 'unknown');
  }
}

export async function cancelReportExport(exportId: string, signal?: AbortSignal): Promise<void> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/reports/exports/${exportId}`, {
      method: 'DELETE',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw await parseError(response);
    }
  } catch (error) {
    if (error instanceof ReportsApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ReportsApiError(0, undefined, 'network');
    }
    throw new ReportsApiError(500, undefined, 'unknown');
  }
}

export async function downloadReportExport(exportId: string, signal?: AbortSignal): Promise<Blob> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/reports/exports/${exportId}/download`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      throw await parseError(response);
    }
    return await response.blob();
  } catch (error) {
    if (error instanceof ReportsApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new ReportsApiError(0, undefined, 'network');
    }
    throw new ReportsApiError(500, undefined, 'unknown');
  }
}

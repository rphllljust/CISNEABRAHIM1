import {
  authHeaders,
  BACKOFFICE_PROBE_ID,
  BackofficeApiError,
  jsonHeaders,
  probeReadAccess,
  requestJson,
} from '../../financial-ui/enterprise-api';
import type {
  FiscalDocument,
  FiscalDocumentPage,
  FiscalPeriodPage,
  TaxAssessment,
  TaxAssessmentPage,
  TaxCalculation,
  TaxReproduction,
  TaxRule,
  TaxRulePage,
  FiscalPeriod,
} from '../types/fiscal.types';

export { BackofficeApiError };

/** Linha de lista de apuração (cálculo tributário). */
export type TaxCalculationSummary = {
  id: string;
  unitId: string;
  ruleCode: string;
  ruleName: string;
  versionNumber: number;
  baseAmount: string;
  rate: string | null;
  resultAmount: string;
  calculatedAt: string;
  sourceKind: string | null;
};

export async function listTaxCalculations(
  params: { unitId: string; limit?: number; offset?: number; q?: string },
  signal?: AbortSignal,
): Promise<{ items: TaxCalculationSummary[]; limit: number; offset: number; total: number; totalPages: number }> {
  const search = new URLSearchParams({ unitId: params.unitId });
  if (params.limit !== undefined) {
    search.set('limit', String(params.limit));
  }
  if (params.offset !== undefined) {
    search.set('offset', String(params.offset));
  }
  if (params.q && params.q.trim().length > 0) {
    search.set('q', params.q.trim());
  }
  return requestJson(`/api/v1/fiscal/tax/calculations?${search.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export type FiscalDocumentListParams = {
  unitId: string;
  status?: string;
  sourceKind?: string;
  issuedFrom?: string;
  issuedTo?: string;
  page: number;
  pageSize: number;
};

/** Lista paginada de documentos fiscais da unidade (superficie de consulta). */
export async function listFiscalDocuments(
  params: FiscalDocumentListParams,
  signal?: AbortSignal,
): Promise<FiscalDocumentPage> {
  const search = new URLSearchParams({
    unitId: params.unitId,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.sourceKind) {
    search.set('sourceKind', params.sourceKind);
  }
  if (params.issuedFrom) {
    search.set('issuedFrom', params.issuedFrom);
  }
  if (params.issuedTo) {
    search.set('issuedTo', params.issuedTo);
  }
  return requestJson<FiscalDocumentPage>(`/api/v1/fiscal/documents?${search.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listFiscalPeriods(
  params: { unitId: string; status?: string; page: number; pageSize: number },
  signal?: AbortSignal,
): Promise<FiscalPeriodPage> {
  const search = new URLSearchParams({
    unitId: params.unitId,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.status) {
    search.set('status', params.status);
  }
  return requestJson<FiscalPeriodPage>(`/api/v1/fiscal/periods?${search.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listTaxAssessments(
  params: { unitId: string; status?: string; periodKey?: string; page: number; pageSize: number },
  signal?: AbortSignal,
): Promise<TaxAssessmentPage> {
  const search = new URLSearchParams({
    unitId: params.unitId,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.status) {
    search.set('status', params.status);
  }
  if (params.periodKey) {
    search.set('periodKey', params.periodKey);
  }
  return requestJson<TaxAssessmentPage>(`/api/v1/fiscal/tax/assessments?${search.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function listTaxRules(
  params: { unitId: string; status?: string; page: number; pageSize: number },
  signal?: AbortSignal,
): Promise<TaxRulePage> {
  const search = new URLSearchParams({
    unitId: params.unitId,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.status) {
    search.set('status', params.status);
  }
  return requestJson<TaxRulePage>(`/api/v1/fiscal/tax/rules?${search.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getFiscalDocument(fiscalDocumentId: string, signal?: AbortSignal): Promise<FiscalDocument> {
  return requestJson<FiscalDocument>(`/api/v1/fiscal/documents/${fiscalDocumentId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function markFiscalDocumentReady(
  fiscalDocumentId: string,
  payload: { rowVersion: number },
): Promise<FiscalDocument> {
  return requestJson<FiscalDocument>(`/api/v1/fiscal/documents/${fiscalDocumentId}/ready`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function submitFiscalDocument(
  fiscalDocumentId: string,
  payload: { rowVersion: number },
): Promise<FiscalDocument> {
  return requestJson<FiscalDocument>(`/api/v1/fiscal/documents/${fiscalDocumentId}/submit`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function cancelFiscalDocument(
  fiscalDocumentId: string,
  payload: { rowVersion: number; reason: string },
): Promise<FiscalDocument> {
  return requestJson<FiscalDocument>(`/api/v1/fiscal/documents/${fiscalDocumentId}/cancel`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function getTaxRule(taxRuleId: string, signal?: AbortSignal): Promise<TaxRule> {
  return requestJson<TaxRule>(`/api/v1/fiscal/tax/rules/${taxRuleId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getTaxCalculation(calculationId: string, signal?: AbortSignal): Promise<TaxCalculation> {
  return requestJson<TaxCalculation>(`/api/v1/fiscal/tax/calculations/${calculationId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function reproduceTaxCalculation(calculationId: string): Promise<TaxReproduction> {
  return requestJson<TaxReproduction>(`/api/v1/fiscal/tax/calculations/${calculationId}/reproduce`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({}),
  });
}

export async function probeFiscalDocumentReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(`/api/v1/fiscal/documents/${BACKOFFICE_PROBE_ID}`, signal);
}

export async function probeTaxReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(`/api/v1/fiscal/tax/calculations/${BACKOFFICE_PROBE_ID}`, signal);
}

export async function getFiscalPeriod(periodId: string, signal?: AbortSignal): Promise<FiscalPeriod> {
  return requestJson<FiscalPeriod>(`/api/v1/fiscal/periods/${periodId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function openFiscalPeriod(payload: { unitId: string; periodKey: string }): Promise<FiscalPeriod> {
  return requestJson<FiscalPeriod>('/api/v1/fiscal/periods', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function closeFiscalPeriod(periodId: string): Promise<FiscalPeriod> {
  return requestJson<FiscalPeriod>(`/api/v1/fiscal/periods/${periodId}/close`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({}),
  });
}

export async function reopenFiscalPeriod(periodId: string, payload: { reason: string }): Promise<FiscalPeriod> {
  return requestJson<FiscalPeriod>(`/api/v1/fiscal/periods/${periodId}/reopen`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function getTaxAssessment(assessmentId: string, signal?: AbortSignal): Promise<TaxAssessment> {
  return requestJson<TaxAssessment>(`/api/v1/fiscal/tax/assessments/${assessmentId}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function createTaxAssessment(payload: Record<string, unknown>): Promise<TaxAssessment> {
  return requestJson<TaxAssessment>('/api/v1/fiscal/tax/assessments', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function finalizeTaxAssessment(
  assessmentId: string,
  payload: Record<string, unknown>,
): Promise<TaxAssessment> {
  return requestJson<TaxAssessment>(`/api/v1/fiscal/tax/assessments/${assessmentId}/finalize`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function adjustTaxAssessment(
  assessmentId: string,
  payload: Record<string, unknown>,
): Promise<TaxAssessment> {
  return requestJson<TaxAssessment>(`/api/v1/fiscal/tax/assessments/${assessmentId}/adjust`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function cancelTaxAssessment(
  assessmentId: string,
  payload: { reason: string },
): Promise<TaxAssessment> {
  return requestJson<TaxAssessment>(`/api/v1/fiscal/tax/assessments/${assessmentId}/cancel`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function probeFiscalPeriodReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(`/api/v1/fiscal/periods/${BACKOFFICE_PROBE_ID}`, signal);
}

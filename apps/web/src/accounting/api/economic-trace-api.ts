import { getApiBaseUrl } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';

/**
 * F1.1 — CLIENTE DA TRILHA ECONÔMICA.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ESTE ARQUIVO NÃO DECIDE NADA
 *
 * Ele transporta o read model do backend. Nenhuma regra contábil é recalculada aqui:
 * `accountingState`, `situation`, `severity`, `nextAction` e `availableCommands` vêm
 * prontos do servidor. O React só escolhe como desenhar.
 *
 * Se algum dia surgir aqui um `if (postingState === 'FAILED' && role === ...)`, o
 * defeito voltou — a decisão pertence ao backend, que é o único que conhece regra,
 * concessão e escopo.
 */

export type EconomicFinancialState =
  | 'OPEN'
  | 'PARTIALLY_SETTLED'
  | 'SETTLED'
  | 'REVERSED'
  | 'CANCELLED';

export type EconomicAccountingState =
  | 'NOT_REACHED'
  | 'PENDING'
  | 'POSTED'
  | 'REVERSED'
  | 'FAILED';

export type EconomicSituation = 'CONSISTENT' | 'IN_PROGRESS' | 'ATTENTION' | 'NOT_APPLICABLE';
export type EconomicSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'NONE';

export type EconomicCommand =
  | 'RETRY_POSTING'
  | 'OPEN_JOURNAL'
  | 'OPEN_ECONOMIC_EVENT'
  | 'REVERSE_SETTLEMENT'
  | 'REVERSE_PAYMENT'
  | 'SETTLE_RECEIVABLE'
  | 'PAY_PAYABLE'
  | 'VIEW_RECEIVABLE'
  | 'VIEW_PAYABLE'
  | 'OPEN_ACCOUNTING_PERIOD';

export type EconomicTraceNode = {
  kind: 'RECEIVABLE' | 'PAYABLE' | 'SETTLEMENT' | 'PAYMENT' | 'ECONOMIC_EVENT' | 'POSTING' | 'JOURNAL';
  reference: string;
  status: string;
  occurredAt: string | null;
  route: string | null;
};

export type EconomicNextAction = {
  command: EconomicCommand | null;
  label: string;
  reason: string;
  owner: string | null;
};

export type EconomicEventSummary = {
  id: string;
  eventKind: string;
  sourceKind: string;
  sourceId: string;
  amount: string;
  currencyCode: string;
  occurredOn: string;
  outboxEventId: string | null;
  transportState: string | null;
  transportAttempts: number | null;
  transportLastError: string | null;
};

export type EconomicPostingFact = {
  state: EconomicAccountingState;
  postingRequestId: string | null;
  journalEntryId: string | null;
  journalNumber: number | null;
  journalKind: string | null;
  postedAt: string | null;
  failure: {
    code: string;
    message: string;
    attempts: number;
    maxAttempts: number;
    firstFailedAt: string | null;
    lastFailedAt: string | null;
  } | null;
  rule: {
    ruleId: string | null;
    ruleCode: string | null;
    versionId: string | null;
    versionNumber: number | null;
    debitAccountId: string | null;
    debitAccountLabel: string | null;
    creditAccountId: string | null;
    creditAccountLabel: string | null;
  } | null;
};

export type EconomicTraceView = {
  factKind: 'SETTLEMENT' | 'PAYMENT';
  factId: string;
  unitId: string;
  amount: string;
  currencyCode: string;
  occurredOn: string;
  financialState: EconomicFinancialState;
  accountingState: EconomicAccountingState;
  situation: EconomicSituation;
  severity: EconomicSeverity;
  summary: string;
  impact: string | null;
  economicEvent: EconomicEventSummary | null;
  posting: EconomicPostingFact;
  trace: EconomicTraceNode[];
  nextAction: EconomicNextAction;
  availableCommands: EconomicCommand[];
};

export type EconomicWorkItem = {
  factKind: 'SETTLEMENT' | 'PAYMENT';
  factId: string;
  unitId: string;
  reference: string;
  amount: string;
  currencyCode: string;
  financialState: EconomicFinancialState;
  accountingState: EconomicAccountingState;
  situation: EconomicSituation;
  severity: EconomicSeverity;
  reason: string;
  firstFailedAt: string | null;
  attempts: number;
  nextAction: EconomicNextAction;
  availableCommands: EconomicCommand[];
  route: string;
};

export type EconomicWorklistView = {
  counts: { pending: number; failed: number; reversed: number };
  items: EconomicWorkItem[];
  limit: number;
  offset: number;
  total: number;
};

export type EconomicTraceApiErrorKind =
  | 'unauthenticated'
  | 'denied'
  | 'not_found'
  | 'network'
  | 'unknown';

export class EconomicTraceApiError extends Error {
  readonly kind: EconomicTraceApiErrorKind;

  constructor(kind: EconomicTraceApiErrorKind) {
    super(kind);
    this.name = 'EconomicTraceApiError';
    this.kind = kind;
  }
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new EconomicTraceApiError('unauthenticated');
  }
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
}

function errorKind(status: number): EconomicTraceApiErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'denied';
  if (status === 404) return 'not_found';
  return 'unknown';
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, { headers: authHeaders(), signal });
  } catch {
    throw new EconomicTraceApiError('network');
  }
  if (!response.ok) {
    throw new EconomicTraceApiError(errorKind(response.status));
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch {
    throw new EconomicTraceApiError('network');
  }
  if (!response.ok) {
    throw new EconomicTraceApiError(errorKind(response.status));
  }
  return (await response.json()) as T;
}

export function fetchSettlementTrace(
  settlementId: string,
  signal?: AbortSignal,
): Promise<EconomicTraceView> {
  return getJson(`/api/v1/accounting/economic-trace/settlement/${encodeURIComponent(settlementId)}`, signal);
}

export function fetchPaymentTrace(
  paymentId: string,
  signal?: AbortSignal,
): Promise<EconomicTraceView> {
  return getJson(`/api/v1/accounting/economic-trace/payment/${encodeURIComponent(paymentId)}`, signal);
}

export function fetchEconomicWorklist(
  unitId: string,
  options: { limit?: number; offset?: number; situation?: string } = {},
  signal?: AbortSignal,
): Promise<EconomicWorklistView> {
  const params = new URLSearchParams({ unitId });
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  if (options.situation) params.set('situation', options.situation);
  return getJson(`/api/v1/accounting/economic-trace/worklist?${params.toString()}`, signal);
}

/**
 * Comando REAL de reprocessamento — `POST /accounting/economic-events/:id/retry`.
 *
 * O evento da outbox é a identidade do transporte. A tela só chama isto quando o
 * backend incluiu `RETRY_POSTING` em `availableCommands`.
 */
export function retryEconomicPosting(
  outboxEventId: string,
  signal?: AbortSignal,
): Promise<{ outcome: string; journalEntryId: string; postingRequestId: string }> {
  return postJson(
    `/api/v1/accounting/economic-events/${encodeURIComponent(outboxEventId)}/retry`,
    {},
    signal,
  );
}

/** Rótulos — apresentação. A DECISÃO nunca vem daqui. */
export const ECONOMIC_STATE_LABELS: Record<EconomicAccountingState, string> = {
  NOT_REACHED: 'Não alcançada',
  PENDING: 'Pendente',
  POSTED: 'Contabilizado',
  REVERSED: 'Estornado',
  FAILED: 'Falhou',
};

export const ECONOMIC_FINANCIAL_LABELS: Record<EconomicFinancialState, string> = {
  OPEN: 'Aberto',
  PARTIALLY_SETTLED: 'Parcial',
  SETTLED: 'Liquidado',
  REVERSED: 'Estornado',
  CANCELLED: 'Cancelado',
};

export const ECONOMIC_SEVERITY_TONE: Record<EconomicSeverity, 'critical' | 'warning' | 'info' | 'success' | 'neutral'> = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
  NONE: 'success',
};

export const ECONOMIC_TRACE_KIND_LABELS: Record<EconomicTraceNode['kind'], string> = {
  RECEIVABLE: 'Título a receber',
  PAYABLE: 'Título a pagar',
  SETTLEMENT: 'Liquidação',
  PAYMENT: 'Pagamento',
  ECONOMIC_EVENT: 'Evento econômico',
  POSTING: 'Posting',
  JOURNAL: 'Lançamento',
};

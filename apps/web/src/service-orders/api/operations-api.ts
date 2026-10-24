/**
 * CLIENTE DE OPERAÇÕES — leitura e comandos.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * SEPARAÇÃO LEITURA / ESCRITA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 *   GET  /api/v1/query/operations/dispatch
 *   GET  /api/v1/query/operations/execution
 *   GET  /api/v1/query/service-orders/:id/overview
 *   GET  /api/v1/query/service-orders/:id/measurement-readiness
 *
 *   POST /api/v1/service-orders/:id/commands/dispatch
 *   POST /api/v1/service-orders/:id/commands/check-in
 *   POST /api/v1/service-orders/:id/commands/register-actual
 *   POST /api/v1/service-orders/:id/commands/register-meter
 *   POST /api/v1/service-orders/:id/commands/register-fuel
 *   POST /api/v1/service-orders/:id/commands/register-signature
 *
 * A leitura nunca dispara comando; a escrita nunca devolve o agregado de escrita
 * como se fosse read model — devolve o MESMO overview que a object page usa, para
 * que a tela não precise remontar estado por conta própria.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ERRO COM CAUSA EMPRESARIAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `DISPATCH_BLOCKED` e `COMPLETION_BLOCKED` carregam `details.blockingReasons`.
 * A tela mostra a LISTA que veio — nunca uma mensagem genérica. É o que impede o
 * operador de receber "Algo deu errado" quando o sistema sabe exatamente o que falta.
 */
import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import type {
  DispatchBoardReadModel,
  ExecutionConsoleReadModel,
  MeasurementReadinessReadModel,
  ServiceOrderOverview,
} from '../types/operations.types';

// ═══════════════════════════════════════════════════════════════════════════════
// ERRO
// ═══════════════════════════════════════════════════════════════════════════════

export type OperationsErrorKind =
  | 'denied'
  | 'not_found'
  | 'version_conflict'
  | 'invalid_state'
  | 'blocked'
  | 'validation'
  | 'network'
  | 'unknown';

/** Motivo de bloqueio devolvido pelo backend, no envelope de erro. */
export type BlockingReason = {
  readonly code: string;
  readonly message: string;
  readonly missingCode: string | null;
  readonly resourceCode: string | null;
  readonly resolution: string | null;
};

export class OperationsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly kind: OperationsErrorKind,
    readonly blockingReasons: readonly BlockingReason[] = [],
    readonly resolution: {
      readonly command: string | null;
      readonly label: string | null;
    } | null = null,
  ) {
    super(code ?? `OPERATIONS_HTTP_${status}`);
  }
}

function classify(status: number, code: string | undefined): OperationsErrorKind {
  if (code === 'SERVICE_ORDERS_DENIED' || status === 403) {
    return 'denied';
  }
  if (code === 'SERVICE_ORDERS_NOT_FOUND' || status === 404) {
    return 'not_found';
  }
  if (code === 'SERVICE_ORDERS_VERSION_CONFLICT') {
    return 'version_conflict';
  }
  if (code === 'SERVICE_ORDERS_DISPATCH_BLOCKED' || code === 'SERVICE_ORDERS_COMPLETION_BLOCKED') {
    return 'blocked';
  }
  if (
    code === 'SERVICE_ORDERS_INVALID_STATE' ||
    code === 'SERVICE_ORDERS_METER_READING_NOT_MONOTONIC' ||
    code === 'SERVICE_ORDERS_DUPLICATE_FINAL_METER_READING'
  ) {
    return 'invalid_state';
  }
  if (code === 'SERVICE_ORDERS_VALIDATION_FAILED' || status === 400) {
    return 'validation';
  }
  return 'unknown';
}

/** Corpo de erro da API, com `details` quando o domínio souber a causa. */
type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: {
      blockingReasons?: Array<{
        code: string;
        message: string;
        missingCode?: string | null;
        resourceCode?: string | null;
        resolution?: string | null;
      }>;
    };
    resolution?: { command?: string | null; label?: string | null };
  };
  code?: string;
  message?: string;
};

async function parseError(response: Response): Promise<OperationsApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Corpo não-JSON: o status continua sendo a evidência.
  }

  const code = body.error?.code ?? body.code;
  const reasons = (body.error?.details?.blockingReasons ?? []).map((item) => ({
    code: item.code,
    message: item.message,
    missingCode: item.missingCode ?? null,
    resourceCode: item.resourceCode ?? null,
    resolution: item.resolution ?? null,
  }));

  const resolution = body.error?.resolution
    ? {
        command: body.error.resolution.command ?? null,
        label: body.error.resolution.label ?? null,
      }
    : null;

  return new OperationsApiError(
    response.status,
    code,
    classify(response.status, code),
    reasons,
    resolution,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSPORTE
// ═══════════════════════════════════════════════════════════════════════════════

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new OperationsApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, init);
    if (!response.ok) {
      throw await parseError(response);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof OperationsApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new OperationsApiError(0, undefined, 'network');
    }
    throw new OperationsApiError(0, undefined, 'unknown');
  }
}

/** Chave de idempotência do comando. */
export function createCommandKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEITURA
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDispatchBoard(
  input: { unitId: string; limit?: number },
  signal?: AbortSignal,
): Promise<DispatchBoardReadModel> {
  const params = new URLSearchParams({ unitId: input.unitId });
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  return requestJson<DispatchBoardReadModel>(`/api/v1/query/operations/dispatch?${params}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getExecutionConsole(
  input: { unitId: string; limit?: number },
  signal?: AbortSignal,
): Promise<ExecutionConsoleReadModel> {
  const params = new URLSearchParams({ unitId: input.unitId });
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  return requestJson<ExecutionConsoleReadModel>(`/api/v1/query/operations/execution?${params}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}

export async function getServiceOrderOverview(
  serviceOrderId: string,
  signal?: AbortSignal,
): Promise<ServiceOrderOverview> {
  return requestJson<ServiceOrderOverview>(
    `/api/v1/query/service-orders/${serviceOrderId}/overview`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

export async function getMeasurementReadiness(
  serviceOrderId: string,
  signal?: AbortSignal,
): Promise<MeasurementReadinessReadModel> {
  return requestJson<MeasurementReadinessReadModel>(
    `/api/v1/query/service-orders/${serviceOrderId}/measurement-readiness`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMANDOS
// ═══════════════════════════════════════════════════════════════════════════════

/** Base obrigatória de todo comando mutável: versão + chave de idempotência. */
export type CommandBase = {
  readonly rowVersion: number;
  readonly idempotencyKey: string;
};

function commandPath(serviceOrderId: string, command: string): string {
  return `/api/v1/service-orders/${serviceOrderId}/commands/${command}`;
}

export async function dispatchServiceOrder(
  serviceOrderId: string,
  body: CommandBase & { windowStart?: string; windowEnd?: string },
): Promise<ServiceOrderOverview> {
  return requestJson<ServiceOrderOverview>(commandPath(serviceOrderId, 'dispatch'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

export async function checkInServiceOrder(
  serviceOrderId: string,
  body: CommandBase,
): Promise<ServiceOrderOverview> {
  return requestJson<ServiceOrderOverview>(commandPath(serviceOrderId, 'check-in'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

export async function registerActual(
  serviceOrderId: string,
  body: CommandBase & {
    actualKind: string;
    physicalAssetId?: string | null;
    workforceMemberId?: string | null;
    actualValue: string;
    unitOfMeasure: string;
    occurredAt?: string;
    notes?: string | null;
  },
): Promise<ServiceOrderOverview> {
  return requestJson<ServiceOrderOverview>(commandPath(serviceOrderId, 'register-actual'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

export async function registerMeter(
  serviceOrderId: string,
  body: CommandBase & {
    physicalAssetId: string;
    meterKind: string;
    readingValue: string;
    unitOfMeasure: string;
    isInitial?: boolean;
    isFinal?: boolean;
    readAt?: string;
    notes?: string | null;
  },
): Promise<ServiceOrderOverview> {
  return requestJson<ServiceOrderOverview>(commandPath(serviceOrderId, 'register-meter'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

export async function registerFuel(
  serviceOrderId: string,
  body: CommandBase & {
    physicalAssetId: string;
    volumeLiters: string;
    unitPrice?: string | null;
    odometerReading?: string | null;
    fueledAt?: string;
    supplierReference?: string | null;
  },
): Promise<ServiceOrderOverview> {
  return requestJson<ServiceOrderOverview>(commandPath(serviceOrderId, 'register-fuel'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

export async function registerSignature(
  serviceOrderId: string,
  body: CommandBase & {
    signerName: string;
    signerDocument?: string | null;
    signerRole?: string | null;
    signatureKind?: string;
    signedAt?: string;
  },
): Promise<ServiceOrderOverview> {
  return requestJson<ServiceOrderOverview>(commandPath(serviceOrderId, 'register-signature'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENSAGENS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mensagem para o OPERADOR.
 *
 * Quando o domínio sabe a causa, a mensagem é a lista de motivos — não "erro".
 * Só quando a causa é desconhecida a tela admite que não sabe.
 */
export function describeOperationsError(error: unknown): string {
  if (!(error instanceof OperationsApiError)) {
    return 'Não foi possível concluir a operação.';
  }

  if (error.kind === 'network') {
    return 'Não foi possível falar com o servidor. A operação NÃO foi aplicada — tente novamente.';
  }

  if (error.kind === 'denied') {
    return 'Você não tem permissão para executar este comando nesta ordem.';
  }

  if (error.kind === 'not_found') {
    return 'A ordem de serviço não foi encontrada ou está fora do seu escopo.';
  }

  if (error.kind === 'version_conflict') {
    return 'Está ordem foi alterada por outro usuário. Recarregue para ver a versão atual.';
  }

  if (error.kind === 'blocked' && error.blockingReasons.length > 0) {
    return error.blockingReasons.map((reason) => reason.message).join(' · ');
  }

  if (error.kind === 'invalid_state' && error.blockingReasons.length > 0) {
    return error.blockingReasons.map((reason) => reason.message).join(' · ');
  }

  if (error.kind === 'invalid_state') {
    return 'A ordem não está em um estado que aceite este comando.';
  }

  if (error.kind === 'validation') {
    return 'Os dados informados estão incompletos ou inválidos.';
  }

  return 'Não foi possível concluir a operação.';
}

/**
 * CLIENTE DA CAPABILITY MEDIÇÃO → ACEITE → FATURAMENTO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * SEPARAÇÃO LEITURA / ESCRITA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 *   GET  /api/v1/query/measurements/:serviceOrderId/workbench
 *   GET  /api/v1/query/measurements/queue?unitId=...
 *   GET  /api/v1/query/measurements/revenue-leakage?unitId=...
 *
 *   POST /api/v1/service-orders/:serviceOrderId/measurements/:measurementId/acceptance
 *
 * A leitura NUNCA dispara comando; a escrita devolve o MESMO read model que o
 * workbench usa, para que a tela não remonte estado por conta própria. Um POST
 * que devolvesse só "ok" obrigaria o React a recompor dezenas de campos — e é
 * assim que a tela passa a "simular" o backend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE CLIENTE NÃO FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não filtra, não ordena, não decide habilitação de comando. Ele traduz HTTP em
 * tipos e classifica o erro — a decisão vem no corpo da resposta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ERRO COM CAUSA EMPRESARIAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O envelope `{ error: { code, message } }` carrega o código de negócio. Um
 * `denied` não é erro técnico: é ausência de capability, e a tela mostra isso
 * como estado, não como falha de sistema.
 */
import { getApiBaseUrl, isNetworkError } from '../../auth/api/auth-api';
import { tokenStore } from '../../auth/storage/token-store';
import type {
  MeasurementWorkbenchReadModel,
  MeasurementWorkQueueReadModel,
  RecordAcceptancePayload,
  RevenueLeakageReadModel,
} from '../types/measurement-workbench.types';

// ═══════════════════════════════════════════════════════════════════════════════
// ERRO
// ═══════════════════════════════════════════════════════════════════════════════

export type MeasurementErrorKind =
  | 'denied'
  | 'not_found'
  | 'version_conflict'
  | 'invalid_state'
  | 'validation'
  | 'network'
  | 'unknown';

export class MeasurementApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly kind: MeasurementErrorKind,
  ) {
    super(code ?? `MEASUREMENT_API_${status}`);
    this.name = 'MeasurementApiError';
  }
}

function classifyError(status: number, code: string | undefined): MeasurementErrorKind {
  if (status === 403 || code?.endsWith('_DENIED')) {
    return 'denied';
  }
  if (status === 404 || code?.endsWith('_NOT_FOUND')) {
    return 'not_found';
  }
  if (code?.endsWith('_VERSION_CONFLICT')) {
    return 'version_conflict';
  }
  if (
    code?.endsWith('_INVALID_STATE') ||
    code?.endsWith('_NOT_EDITABLE') ||
    code?.endsWith('_ALREADY_RECORDED')
  ) {
    return 'invalid_state';
  }
  if (status === 400 || code?.endsWith('_VALIDATION_FAILED')) {
    return 'validation';
  }
  if (status === 409) {
    // Conflito de negócio que não é de versão: a medição muda de estado por uma
    // regra, não por outro operador.
    return 'invalid_state';
  }
  return 'unknown';
}

async function parseError(response: Response): Promise<MeasurementApiError> {
  let code: string | undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
      code?: string;
    };
    code = body.error?.code ?? body.code;
  } catch {
    // Corpo não-JSON: o status já classifica.
  }
  return new MeasurementApiError(response.status, code, classifyError(response.status, code));
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    throw new MeasurementApiError(401, undefined, 'denied');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

function jsonHeaders(): HeadersInit {
  return { ...authHeaders(), 'Content-Type': 'application/json' };
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
    if (error instanceof MeasurementApiError) {
      throw error;
    }
    if (isNetworkError(error)) {
      throw new MeasurementApiError(0, undefined, 'network');
    }
    throw new MeasurementApiError(0, undefined, 'unknown');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEITURA
// ═══════════════════════════════════════════════════════════════════════════════

/** A ESTAÇÃO DE TRABALHO da medição de uma ordem. */
export async function getMeasurementWorkbench(
  serviceOrderId: string,
  signal?: AbortSignal,
): Promise<MeasurementWorkbenchReadModel> {
  return requestJson<MeasurementWorkbenchReadModel>(
    `/api/v1/query/measurements/${encodeURIComponent(serviceOrderId)}/workbench`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

/**
 * FILA DE TRABALHO da unidade.
 *
 * `unitId` é obrigatório porque sem unidade não há escopo operacional — o mesmo
 * motivo pelo qual o backend recusa a leitura sem ele.
 */
export async function getMeasurementWorkQueue(
  unitId: string,
  input: { limit?: number; at?: string } = {},
  signal?: AbortSignal,
): Promise<MeasurementWorkQueueReadModel> {
  const params = new URLSearchParams({ unitId });
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.at !== undefined) {
    params.set('at', input.at);
  }
  const payload = await requestJson<MeasurementWorkQueueReadModel>(
    `/api/v1/query/measurements/queue?${params.toString()}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
  return normalizeWorkQueue(payload);
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A FILA É NORMALIZADA NA FRONTEIRA HTTP — E ISSO NÃO É CINTO DE SEGURANÇA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O contrato declara `items` e `counts` sempre presentes. Na prática o navegador
 * quebrou em produção com:
 *
 *   TypeError: Cannot read properties of undefined (reading 'map')
 *
 * A tela lia `queueData.items.length` e `items.map(...)` direto da resposta. Uma
 * resposta sem essas chaves — proxy que corta o corpo, erro parcial, versão de
 * backend diferente do frontend durante o deploy — derrubava a ESTAÇÃO INTEIRA,
 * incluindo as colunas que não dependem da fila.
 *
 * O reparo é na fronteira, e o motivo é de arquitetura: o React recebe um tipo
 * que afirma `items: WorkQueueItem[]`, então o valor que chega precisa HONRAR o
 * tipo. Normalizar aqui mantém uma única porta de entrada do dado; espalhar
 * `?? []` pelas telas faria cada componente inventar sua própria tolerância.
 *
 * Lista vazia é a resposta correta para "não recebi a lista": a fila fica vazia e
 * a tela continua operável. O que NÃO se faz aqui é inventar item, contagem ou
 * qualquer valor de negócio — a normalização só garante a FORMA declarada.
 */
function normalizeWorkQueue(
  payload: MeasurementWorkQueueReadModel | null | undefined,
): MeasurementWorkQueueReadModel {
  return {
    context: payload?.context ?? { unitId: '', at: new Date().toISOString() },
    counts: payload?.counts ?? {},
    items: Array.isArray(payload?.items) ? payload.items : [],
    // `authority` continua `SERVER`: a forma é garantida aqui, a AFIRMAÇÃO de
    // frescura continua sendo do servidor. Um clique do cliente nunca a produz.
    freshness: payload?.freshness ?? { readAt: new Date().toISOString(), authority: 'SERVER' },
  };
}

/** LACUNA DE RECEITA por estágio da cadeia. */
export async function getRevenueLeakage(
  unitId: string,
  input: { limit?: number; at?: string } = {},
  signal?: AbortSignal,
): Promise<RevenueLeakageReadModel> {
  const params = new URLSearchParams({ unitId });
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.at !== undefined) {
    params.set('at', input.at);
  }
  return requestJson<RevenueLeakageReadModel>(
    `/api/v1/query/measurements/revenue-leakage?${params.toString()}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESCRITA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * REGISTRA O ACEITE DO CLIENTE.
 *
 * Devolve o WORKBENCH já recomposto pelo backend — com a elegibilidade
 * REAVALIADA na mesma transação. A tela não recalcula elegibilidade depois do
 * comando: ela troca o read model inteiro.
 *
 * `idempotencyKey` é do CHAMADOR e deve ser a MESMA em retries do mesmo
 * comando. Gerar outra chave num retry transformaria um reenvio seguro numa
 * segunda decisão.
 */
export async function recordCustomerAcceptance(
  serviceOrderId: string,
  measurementId: string,
  payload: RecordAcceptancePayload,
): Promise<MeasurementWorkbenchReadModel> {
  return requestJson<MeasurementWorkbenchReadModel>(
    `/api/v1/service-orders/${encodeURIComponent(serviceOrderId)}/measurements/${encodeURIComponent(
      measurementId,
    )}/acceptance`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    },
  );
}

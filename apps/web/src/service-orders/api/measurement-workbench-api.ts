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
  | 'contract'
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
  const targetServiceOrderId = requireRequestKey(serviceOrderId, 'MEASUREMENT_SERVICE_ORDER_REQUIRED');
  const payload = await requestJson<MeasurementWorkbenchReadModel>(
    `/api/v1/query/measurements/${encodeURIComponent(targetServiceOrderId)}/workbench`,
    { method: 'GET', headers: authHeaders(), signal },
  );
  return decodeWorkbench(payload, targetServiceOrderId);
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
  const targetUnitId = requireRequestKey(unitId, 'MEASUREMENT_UNIT_REQUIRED');
  const params = new URLSearchParams({ unitId: targetUnitId });
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
  return decodeWorkQueue(payload, targetUnitId);
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
function contractError(code: string): MeasurementApiError {
  return new MeasurementApiError(0, code, 'contract');
}

function requireRequestKey(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw contractError(code);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw contractError(code);
  }
  return value;
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw contractError(code);
  }
  return value;
}

function requireNumber(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw contractError(code);
  }
  return value;
}

function requireNumberOrNull(value: unknown, code: string): number | null {
  if (value === null) return null;
  return requireNumber(value, code);
}

function requireBoolean(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') {
    throw contractError(code);
  }
  return value;
}

function requireRecordPath(
  root: Record<string, unknown>,
  path: readonly string[],
  code: string,
): Record<string, unknown> {
  let current = root;
  for (const segment of path) {
    current = requireRecord(current[segment], code);
  }
  return current;
}

function assertServerFreshness(value: unknown, code: string): void {
  const freshness = requireRecord(value, code);
  requireString(freshness['readAt'], code);
  if (freshness['authority'] !== 'SERVER') {
    throw contractError(code);
  }
}

export const WORKBENCH_COLLECTION_PATHS = [
  ['variances'],
  ['adjustments'],
  ['items'],
  ['evidence'],
  ['situations'],
  ['relationships'],
  ['documentFlow'],
  ['timeline'],
  ['availableCommands'],
  ['processContext', 'completedMilestones'],
  ['processContext', 'pendingMilestones'],
  ['processContext', 'milestones'],
  ['measurementBasis', 'lines'],
  ['quantities', 'lines'],
  ['acceptance', 'history'],
  ['billingEligibility', 'dimensions'],
  ['billingEligibility', 'blockingReasons'],
  ['availableCommands[]', 'blockingReasons'],
  ['availableCommands[]', 'reasonLabels'],
] as const;

export const REVENUE_LEAKAGE_COLLECTION_PATHS = [
  ['stages'],
  ['positions'],
] as const;

type CollectionPath = readonly string[];

/**
 * Prova que TODA coleção declarada pelo contrato realmente chegou como array.
 *
 * Ausência NÃO vira []: numa superfície autoritativa isso esconderia perda de
 * dados como "nenhum item". O boundary falha fechado e a UI entra em estado de
 * erro controlado, preservando a verdade operacional.
 */
function assertCollections(
  input: unknown,
  paths: ReadonlyArray<CollectionPath>,
  code: string,
): Record<string, unknown> {
  const root = requireRecord(input, code);

  const visit = (
    holder: Record<string, unknown>,
    path: readonly string[],
  ): void => {
    const [head, ...rest] = path as [string, ...string[]];

    if (head.endsWith('[]')) {
      const key = head.slice(0, -2);
      const list = holder[key];
      if (!Array.isArray(list)) {
        throw contractError(code);
      }
      for (const element of list) {
        visit(requireRecord(element, code), rest);
      }
      return;
    }

    if (rest.length === 0) {
      if (!Array.isArray(holder[head])) {
        throw contractError(code);
      }
      return;
    }

    visit(requireRecord(holder[head], code), rest);
  };

  for (const path of paths) {
    visit(root, path);
  }
  return root;
}

function decodeWorkQueue(
  payload: MeasurementWorkQueueReadModel | null | undefined,
  expectedUnitId: string,
): MeasurementWorkQueueReadModel {
  const root = assertCollections(payload, [['items']], 'MEASUREMENT_QUEUE_CONTRACT_INVALID');
  const context = requireRecord(root['context'], 'MEASUREMENT_QUEUE_CONTEXT_INVALID');
  const counts = requireRecord(root['counts'], 'MEASUREMENT_QUEUE_COUNTS_INVALID');
  void counts;
  assertServerFreshness(root['freshness'], 'MEASUREMENT_QUEUE_FRESHNESS_INVALID');

  const actualUnitId = requireString(context['unitId'], 'MEASUREMENT_QUEUE_UNIT_INVALID');
  if (actualUnitId !== expectedUnitId) {
    throw contractError('MEASUREMENT_QUEUE_UNIT_MISMATCH');
  }

  for (const item of root['items'] as unknown[]) {
    const row = requireRecord(item, 'MEASUREMENT_QUEUE_ITEM_INVALID');
    requireString(row['serviceOrderId'], 'MEASUREMENT_QUEUE_ITEM_INVALID');
    requireString(row['orderNumber'], 'MEASUREMENT_QUEUE_ITEM_INVALID');
    requireRecord(row['nextAction'], 'MEASUREMENT_QUEUE_ITEM_INVALID');
  }

  return root as unknown as MeasurementWorkQueueReadModel;
}

function decodeWorkbench(
  payload: MeasurementWorkbenchReadModel | null | undefined,
  expectedServiceOrderId: string,
  expectedMeasurementId?: string,
): MeasurementWorkbenchReadModel {
  const root = assertCollections(
    payload,
    WORKBENCH_COLLECTION_PATHS,
    'MEASUREMENT_WORKBENCH_COLLECTION_INVALID',
  );

  const identity = requireRecord(root['identity'], 'MEASUREMENT_WORKBENCH_IDENTITY_INVALID');
  const businessContext = requireRecord(
    root['businessContext'],
    'MEASUREMENT_WORKBENCH_BUSINESS_CONTEXT_INVALID',
  );
  requireRecord(root['statuses'], 'MEASUREMENT_WORKBENCH_STATUSES_INVALID');
  const processContext = requireRecord(
    root['processContext'],
    'MEASUREMENT_WORKBENCH_PROCESS_CONTEXT_INVALID',
  );
  const health = requireRecord(
    processContext['health'],
    'MEASUREMENT_WORKBENCH_PROCESS_HEALTH_INVALID',
  );
  const measurementBasis = requireRecord(
    root['measurementBasis'],
    'MEASUREMENT_WORKBENCH_BASIS_INVALID',
  );
  const quantities = requireRecord(root['quantities'], 'MEASUREMENT_WORKBENCH_QUANTITIES_INVALID');
  const totals = requireRecord(
    quantities['totals'],
    'MEASUREMENT_WORKBENCH_QUANTITY_TOTALS_INVALID',
  );
  requireRecord(root['economics'], 'MEASUREMENT_WORKBENCH_ECONOMICS_INVALID');
  const commercialContext = requireRecord(
    root['commercialContext'],
    'MEASUREMENT_WORKBENCH_COMMERCIAL_CONTEXT_INVALID',
  );
  requireRecord(commercialContext['pricing'], 'MEASUREMENT_WORKBENCH_PRICING_INVALID');
  const tolerance = requireRecord(
    commercialContext['tolerance'],
    'MEASUREMENT_WORKBENCH_TOLERANCE_INVALID',
  );
  const varianceSummary = requireRecord(
    root['varianceSummary'],
    'MEASUREMENT_WORKBENCH_VARIANCE_SUMMARY_INVALID',
  );
  const acceptance = requireRecord(
    root['acceptance'],
    'MEASUREMENT_WORKBENCH_ACCEPTANCE_INVALID',
  );
  const eligibility = requireRecord(
    root['billingEligibility'],
    'MEASUREMENT_WORKBENCH_ELIGIBILITY_INVALID',
  );
  requireRecord(
    root['decisionExplanation'],
    'MEASUREMENT_WORKBENCH_DECISION_EXPLANATION_INVALID',
  );
  assertServerFreshness(root['freshness'], 'MEASUREMENT_WORKBENCH_FRESHNESS_INVALID');

  const actualServiceOrderId = requireString(
    identity['serviceOrderId'],
    'MEASUREMENT_WORKBENCH_SERVICE_ORDER_INVALID',
  );
  if (actualServiceOrderId !== expectedServiceOrderId) {
    throw contractError('MEASUREMENT_WORKBENCH_SERVICE_ORDER_MISMATCH');
  }

  if (expectedMeasurementId !== undefined) {
    const actualMeasurementId = requireString(
      identity['measurementId'],
      'MEASUREMENT_WORKBENCH_MEASUREMENT_INVALID',
    );
    if (actualMeasurementId !== expectedMeasurementId) {
      throw contractError('MEASUREMENT_WORKBENCH_MEASUREMENT_MISMATCH');
    }
  }

  requireString(identity['orderNumber'], 'MEASUREMENT_WORKBENCH_ORDER_NUMBER_INVALID');
  requireString(businessContext['unit'], 'MEASUREMENT_WORKBENCH_UNIT_INVALID');
  requireString(health['currentStageLabel'], 'MEASUREMENT_WORKBENCH_PROCESS_HEALTH_INVALID');
  requireNumberOrNull(health['elapsedSeconds'], 'MEASUREMENT_WORKBENCH_PROCESS_HEALTH_INVALID');
  requireString(health['risk'], 'MEASUREMENT_WORKBENCH_PROCESS_HEALTH_INVALID');
  requireNumber(measurementBasis['lineCount'], 'MEASUREMENT_WORKBENCH_BASIS_INVALID');
  requireNumber(totals['planned'], 'MEASUREMENT_WORKBENCH_QUANTITY_TOTALS_INVALID');
  requireNumber(totals['actual'], 'MEASUREMENT_WORKBENCH_QUANTITY_TOTALS_INVALID');
  requireNumber(totals['measured'], 'MEASUREMENT_WORKBENCH_QUANTITY_TOTALS_INVALID');
  requireNumber(tolerance['percentage'], 'MEASUREMENT_WORKBENCH_TOLERANCE_INVALID');
  requireString(varianceSummary['highestSeverity'], 'MEASUREMENT_WORKBENCH_VARIANCE_SUMMARY_INVALID');
  requireNumber(
    varianceSummary['decisionRequiredCount'],
    'MEASUREMENT_WORKBENCH_VARIANCE_SUMMARY_INVALID',
  );
  requireBoolean(acceptance['required'], 'MEASUREMENT_WORKBENCH_ACCEPTANCE_INVALID');
  requireString(acceptance['state'], 'MEASUREMENT_WORKBENCH_ACCEPTANCE_INVALID');
  requireString(eligibility['result'], 'MEASUREMENT_WORKBENCH_ELIGIBILITY_INVALID');

  if (!Object.prototype.hasOwnProperty.call(root, 'nextAction')) {
    throw contractError('MEASUREMENT_WORKBENCH_NEXT_ACTION_INVALID');
  }
  if (root['nextAction'] !== null) {
    requireRecord(root['nextAction'], 'MEASUREMENT_WORKBENCH_NEXT_ACTION_INVALID');
  }

  for (const command of root['availableCommands'] as unknown[]) {
    const entry = requireRecord(command, 'MEASUREMENT_WORKBENCH_COMMAND_INVALID');
    requireString(entry['code'], 'MEASUREMENT_WORKBENCH_COMMAND_INVALID');
    requireString(entry['label'], 'MEASUREMENT_WORKBENCH_COMMAND_INVALID');
    requireBoolean(entry['enabled'], 'MEASUREMENT_WORKBENCH_COMMAND_INVALID');
    requireString(entry['requiredPermission'], 'MEASUREMENT_WORKBENCH_COMMAND_INVALID');
  }

  return root as unknown as MeasurementWorkbenchReadModel;
}

function decodeRevenueLeakage(
  payload: RevenueLeakageReadModel | null | undefined,
  expectedUnitId: string,
): RevenueLeakageReadModel {
  const root = assertCollections(
    payload,
    REVENUE_LEAKAGE_COLLECTION_PATHS,
    'MEASUREMENT_REVENUE_LEAKAGE_COLLECTION_INVALID',
  );
  const context = requireRecord(
    root['context'],
    'MEASUREMENT_REVENUE_LEAKAGE_CONTEXT_INVALID',
  );
  requireRecord(root['total'], 'MEASUREMENT_REVENUE_LEAKAGE_TOTAL_INVALID');
  assertServerFreshness(
    root['freshness'],
    'MEASUREMENT_REVENUE_LEAKAGE_FRESHNESS_INVALID',
  );

  const actualUnitId = requireString(
    context['unitId'],
    'MEASUREMENT_REVENUE_LEAKAGE_UNIT_INVALID',
  );
  if (actualUnitId !== expectedUnitId) {
    throw contractError('MEASUREMENT_REVENUE_LEAKAGE_UNIT_MISMATCH');
  }

  return root as unknown as RevenueLeakageReadModel;
}

/** LACUNA DE RECEITA por estágio da cadeia. */
export async function getRevenueLeakage(
  unitId: string,
  input: { limit?: number; at?: string } = {},
  signal?: AbortSignal,
): Promise<RevenueLeakageReadModel> {
  const targetUnitId = requireRequestKey(unitId, 'MEASUREMENT_UNIT_REQUIRED');
  const params = new URLSearchParams({ unitId: targetUnitId });
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.at !== undefined) {
    params.set('at', input.at);
  }
  /**
   * A LACUNA DE RECEITA TEM A MESMA EXPOSIÇÃO.
   *
   * `RevenueLeakagePage` faz `data.stages.map(...)` e `positions.map(...)`. Sem
   * normalização, uma resposta sem `stages` derruba a tela — o mesmo defeito que
   * já custou cinco releases na estação de medição. Aqui a garantia entra ANTES
   * de o defeito existir, não depois.
   */
  const payload = await requestJson<RevenueLeakageReadModel>(
    `/api/v1/query/measurements/revenue-leakage?${params.toString()}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
  return decodeRevenueLeakage(payload, targetUnitId);
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
  const targetServiceOrderId = requireRequestKey(serviceOrderId, 'MEASUREMENT_SERVICE_ORDER_REQUIRED');
  const targetMeasurementId = requireRequestKey(measurementId, 'MEASUREMENT_ID_REQUIRED');
  const response = await requestJson<MeasurementWorkbenchReadModel>(
    `/api/v1/service-orders/${encodeURIComponent(targetServiceOrderId)}/measurements/${encodeURIComponent(
      targetMeasurementId,
    )}/acceptance`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    },
  );
  return decodeWorkbench(response, targetServiceOrderId, targetMeasurementId);
}

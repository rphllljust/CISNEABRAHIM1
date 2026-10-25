/**
 * MEDIÇÃO → ACEITE → FATURAMENTO — CONTRATOS DE LEITURA E COMANDO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * O prompt é explícito: "NÃO SERIALIZE O WRITE AGGREGATE E CHAME ISSO DE READ
 * MODEL". O aggregate de escrita (`msr.measurements` + itens + ajustes) descreve
 * COMO o dado é mantido. O operador precisa de outra coisa: uma resposta
 * orientada à DECISÃO.
 *
 * `MeasurementWorkbenchReadModel` é essa resposta. Ele responde, nesta ordem, as
 * perguntas que o operador faz quando abre a estação de trabalho:
 *
 *   O QUE precisa da minha atenção?     workQueue + situations
 *   QUAL é o objeto?                    identity + businessContext
 *   O QUE aconteceu?                    quantities (planned/actual/measured)
 *   POR QUE há problema?                variances
 *   QUAL o impacto?                     economics + variance financialImpact
 *   O QUE posso fazer?                  availableCommands (do backend)
 *   O QUE o sistema recomenda?          nextAction
 *   O QUE acontece se eu executar?      decisionExplanation
 *   QUAL o próximo trabalho?            nextAction + documentFlow
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MULTI-STATUS: CINCO EIXOS INDEPENDENTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O status da medição é apenas UM eixo. Aceite, elegibilidade de faturamento e
 * faturamento são DIMENSÕES PRÓPRIAS com ciclos próprios — esmagá-las num único
 * enum faria `BILLING_BLOCKED` parecer estado da medição, e a state machine da
 * medição deixaria de ser verificável.
 */

import type { BillingEligibilityDecision } from '../domain/billing-eligibility';
import type { MeasurementCommandSurface } from '../domain/measurement-command-surface';
import type { ProcessContext } from '../domain/measurement-process-context';
import type { DetectedVariance, ResolvedTolerance } from '../domain/measurement-variance';

// ═══════════════════════════════════════════════════════════════════════════════
// ESTADO DE FRESCURA
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchFreshness = {
  /** Instante da leitura, ISO 8601 (relógio do servidor). */
  readAt: string;
  /** Sempre `SERVER`: o cliente não declara a própria frescura. */
  authority: 'SERVER';
};

// ═══════════════════════════════════════════════════════════════════════════════
// EIXOS DE STATUS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Os cinco eixos independentes. Cada um declara sua própria verdade.
 *
 * `accounting` fica `NOT_APPLICABLE` nesta capability por decisão de ESCOPO, não
 * por falta de dado: a fronteira é `READY_TO_BILL`, e afirmar qualquer coisa
 * sobre contabilidade aqui seria atravessar a fronteira declarada.
 */
export type WorkbenchStatuses = {
  execution: string;
  measurement: string;
  acceptance: string;
  billingEligibility: string;
  billing: string;
  accounting: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// QUANTIDADES: TRÊS VERDADES
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchQuantityLine = {
  /** Chave do grupo: unidade de medida da base. */
  dimensionKey: string;
  label: string;
  unitOfMeasure: string;
  /** `null` quando o planojamento não declarou meta — nunca zero. */
  planned: string | null;
  /** `null` quando a execução não registrou o realizado. */
  actual: string | null;
  /** `null` quando não há item medido para a unidade. */
  measured: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// WORKBENCH
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchIdentity = {
  measurementId: string | null;
  number: string | null;
  serviceOrderId: string;
  orderNumber: string;
  /** Versão do agregado observada nesta leitura — base do `expectedVersion`. */
  rowVersion: number | null;
};

export type WorkbenchBusinessContext = {
  company: string | null;
  unit: string;
  customer: string | null;
  customerId: string | null;
  contract: string | null;
  purchaseOrder: string | null;
  responsible: string | null;
};

export type WorkbenchProcessContext = ProcessContext & {
  nextMilestone: string | null;
};

/** Base de medição consumida — a PROVA do handoff. */
export type WorkbenchMeasurementBasis = {
  basisId: string | null;
  executionClosureId: string | null;
  preparedAt: string | null;
  lineCount: number;
  /** As linhas publicadas pela execução, como recebidas. */
  lines: Array<{
    lineKey: string;
    unitCode: string;
    actualQuantity: string;
    plannedQuantity: string | null;
    recordCount: number;
    source: string;
  }>;
};

export type WorkbenchEconomics = {
  grossValue: string | null;
  currency: string | null;
  /** Soma do impacto das variações que exigem decisão. */
  financialVariance: string | null;
  /** Exposição total: valor em jogo se o faturamento for bloqueado. */
  revenueExposure: string | null;
};

export type WorkbenchCommercialContext = {
  pricing: { source: string | null; lineCount: number; currencyCode: string | null };
  paymentTerms: string | null;
  tolerance: ResolvedTolerance;
  purchaseOrderRequirement: string | null;
  billingPolicy: string;
};

export type WorkbenchAdjustment = {
  id: string;
  measurementItemId: string;
  adjustmentQuantity: string;
  unitCode: string;
  reason: string;
  authorizedByIdentityId: string;
  financialImpact: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type WorkbenchEvidence = {
  id: string;
  kind: string;
  status: string;
  recordedAt: string;
};

export type WorkbenchAcceptance = {
  policy: string;
  policySource: string;
  policyReason: string;
  required: boolean;
  state: string;
  blocksBilling: boolean;
  blockingReason: string | null;
  latest: {
    id: string;
    cycleNumber: number;
    result: string;
    observation: string;
    rejectionReason: string | null;
    evidenceId: string | null;
    customerSignerName: string | null;
    acceptedByIdentityId: string;
    occurredAt: string;
  } | null;
  history: Array<{
    id: string;
    cycleNumber: number;
    result: string;
    rejectionReason: string | null;
    occurredAt: string;
  }>;
  nextActionCode: string | null;
  nextActionLabel: string | null;
};

export type WorkbenchSituation = {
  code: string;
  severity: string;
  title: string;
  detail: string;
  ownerRole: string;
  nextBestAction: string;
  blocking: boolean;
};

export type WorkbenchRelationship = {
  kind: string;
  reference: string;
  label: string;
};

/** Document flow: quais artefatos de negócio existem, e como navegar entre eles. */
export type WorkbenchDocumentFlowStep = {
  step: number;
  kind: string;
  reference: string | null;
  label: string;
  /** `EXISTS` quando o artefato existe; `ABSENT` quando ainda não foi criado. */
  state: 'EXISTS' | 'ABSENT';
  href: string | null;
};

export type WorkbenchTimelineEvent = {
  at: string;
  kind: string;
  label: string;
  detail: string | null;
  actorIdentityId: string | null;
};

/**
 * O READ MODEL ORIENTADO À DECISÃO.
 *
 * Nenhum campo aqui é o aggregate serializado: tudo é derivado e ordenado para
 * responder uma pergunta operacional.
 */
export type MeasurementWorkbenchReadModel = {
  identity: WorkbenchIdentity;
  businessContext: WorkbenchBusinessContext;
  statuses: WorkbenchStatuses;
  processContext: WorkbenchProcessContext;
  measurementBasis: WorkbenchMeasurementBasis;
  quantities: {
    lines: WorkbenchQuantityLine[];
    /** Totais por unidade, para a faixa de números do topo. */
    totals: { planned: number; actual: number; measured: number };
  };
  economics: WorkbenchEconomics;
  commercialContext: WorkbenchCommercialContext;
  variances: DetectedVariance[];
  varianceSummary: {
    highestSeverity: string;
    decisionRequiredCount: number;
    approvalClearable: boolean;
    summary: string;
  };
  adjustments: WorkbenchAdjustment[];
  items: Array<{
    id: string;
    lineNumber: number;
    unitCode: string;
    plannedQuantity: string | null;
    actualQuantity: string;
    measuredQuantity: string;
    unitPrice: string | null;
    lineAmount: string | null;
    origin: string;
    sourceBasisLineKey: string | null;
  }>;
  evidence: WorkbenchEvidence[];
  acceptance: WorkbenchAcceptance;
  billingEligibility: BillingEligibilityDecision;
  situations: WorkbenchSituation[];
  relationships: WorkbenchRelationship[];
  documentFlow: WorkbenchDocumentFlowStep[];
  timeline: WorkbenchTimelineEvent[];
  nextAction: { code: string | null; label: string | null; explanation: string | null } | null;
  availableCommands: MeasurementCommandSurface['availableCommands'];
  decisionExplanation: {
    measurement: string;
    approval: string;
    acceptance: string;
    billing: string;
    /** O que acontece ao preparar faturamento. */
    onBilling: string;
  };
  freshness: WorkbenchFreshness;
};

// ═══════════════════════════════════════════════════════════════════════════════
// WORK QUEUE — o que precisa de atenção
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkQueueItem = {
  measurementId: string | null;
  serviceOrderId: string;
  orderNumber: string;
  customerLabel: string | null;
  statuses: {
    measurement: string;
    acceptance: string;
    billingEligibility: string;
  };
  stage: string;
  stageLabel: string;
  /** Por que este item está na fila, em código. */
  reasonCode: string;
  reasonLabel: string;
  severity: string;
  amount: string | null;
  currencyCode: string | null;
  ageSeconds: number | null;
  ownerRole: string;
  nextAction: { code: string; label: string };
};

export type MeasurementWorkQueueReadModel = {
  context: { unitId: string; at: string };
  counts: Record<string, number>;
  items: WorkQueueItem[];
  freshness: WorkbenchFreshness;
};

// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE LEAKAGE — CONTROL TOWER
// ═══════════════════════════════════════════════════════════════════════════════

export type RevenueLeakageStageReadModel = {
  stage: string;
  label: string;
  count: number;
  amount: string | null;
  unknownAmountCount: number;
  currencyCode: string | null;
};

export type RevenueLeakagePositionReadModel = {
  serviceOrderId: string;
  orderNumber: string;
  clientLabel: string | null;
  stage: string;
  stageLabel: string;
  amount: string | null;
  currencyCode: string | null;
  ageSeconds: number | null;
  ownerRole: string;
  blockerCode: string | null;
  nextAction: { code: string; label: string };
  severity: string;
  statuses: { measurement: string; acceptance: string; billingEligibility: string };
};

export type RevenueLeakageReadModel = {
  context: { unitId: string; at: string };
  stages: RevenueLeakageStageReadModel[];
  total: {
    count: number;
    amount: string | null;
    unknownAmountCount: number;
    currencyCode: string | null;
  };
  positions: RevenueLeakagePositionReadModel[];
  freshness: WorkbenchFreshness;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRADAS DE COMANDO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ENVELOPE DE COMANDO.
 *
 * Todo comando empresarial carrega os mesmos campos: qual comando, sobre qual
 * agregado, em qual contexto empresarial, por qual ator, com qual versão
 * esperada, com que chave de idempotência e por qual motivo. Um comando sem
 * `expectedVersion` sobrescreveria trabalho alheio; sem `idempotencyKey`
 * duplicaria efeito num retry de rede.
 */
export type CommandEnvelope = {
  aggregateId: string;
  enterpriseContext: { company: string | null; unit: string };
  actorIdentityId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string | null;
};

export type RecordAcceptanceCommand = CommandEnvelope & {
  result: 'ACCEPTED' | 'REJECTED';
  observation: string;
  rejectionReason?: string | null;
  evidenceId?: string | null;
  signatureId?: string | null;
  customerSignerName?: string | null;
  occurredAt?: string;
};

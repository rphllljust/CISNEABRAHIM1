/**
 * MEDIÇÃO → ACEITE → FATURAMENTO — CONTRATO DE LEITURA TIPADO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * ESTE ARQUIVO É A FRONTEIRA, E ELA É DE MÃO ÚNICA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * O backend é AUTORITATIVO. O frontend é a EXPERIÊNCIA OPERACIONAL da verdade
 * publicada. Tudo que decide negócio — status derivado, severidade de variação,
 * política de aceite, elegibilidade de faturamento, comando habilitado, próxima
 * ação — chega PRONTO neste contrato e a tela apenas o apresenta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE A TELA NÃO FAZ (E O TESTE DE FITNESS REPROVA SE VOLTAR A FAZER)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   if (measurement.status === 'UNDER_REVIEW' && variance < tolerance) enableApproval()
 *
 * Essa linha era o padrão nesta base: uma regra de aprovação reimplementada em
 * React. Quando a variação passou a bloquear a aprovação, a tela continuou
 * habilitando o botão e o operador recebia 409 de um comando que ela mesma
 * disse que era possível.
 *
 * Aqui:
 *
 *   comando habilitado  → `availableCommands[].enabled` (decidido pelo backend)
 *   motivo do bloqueio  → `availableCommands[].blockingReasons` (códigos)
 *   próximo trabalho    → `nextAction` (decidido pelo backend)
 *   elegibilidade       → `billingEligibility.result` (modelo de decisão)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MULTI-STATUS: CINCO EIXOS, NÃO UM ENUM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `statuses` tem eixos independentes porque medição, aceite, elegibilidade e
 * faturamento têm ciclos próprios. Esmagá-los num único status faria
 * "BLOCKED" parecer estado da medição — e a state machine da medição deixaria
 * de ser verificável.
 *
 * Os tipos abaixo espelham EXATAMENTE o que
 * `apps/api/src/measurements/application/measurement-workbench.contracts.ts`
 * publica. Se o backend mudar, o contrato mudar aqui E o teste de contrato
 * reprova — a divergência não pode ser silenciosa.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// FRESCURA
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchFreshness = {
  /** Instante da leitura, ISO 8601 (relógio do servidor). */
  readonly readAt: string;
  /** Sempre `SERVER`: o cliente não declara a própria frescura. */
  readonly authority: 'SERVER';
};

// ═══════════════════════════════════════════════════════════════════════════════
// EIXOS DE STATUS
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchStatuses = {
  readonly execution: string;
  readonly measurement: string;
  readonly acceptance: string;
  readonly billingEligibility: string;
  readonly billing: string;
  readonly accounting: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// IDENTIDADE E CONTEXTO
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchIdentity = {
  readonly measurementId: string | null;
  readonly number: string | null;
  readonly serviceOrderId: string;
  readonly orderNumber: string;
  /**
   * Versão do agregado observada nesta leitura.
   *
   * O comando exige `expectedVersion`, e sem este campo a única saída seria o
   * cliente adivinhar — o que produziria 409 em toda tentativa. A versão
   * pertence à resposta porque é ela que o operador está vendo.
   */
  readonly rowVersion: number | null;
};

export type WorkbenchBusinessContext = {
  readonly company: string | null;
  readonly unit: string;
  readonly customer: string | null;
  readonly customerId: string | null;
  readonly contract: string | null;
  readonly purchaseOrder: string | null;
  readonly responsible: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESSO
// ═══════════════════════════════════════════════════════════════════════════════

export type ProcessMilestone = {
  readonly stage: string;
  readonly label: string;
  readonly state: string;
  readonly reachedAt: string | null;
};

export type ProcessHealth = {
  readonly currentStage: string;
  readonly currentStageLabel: string;
  readonly elapsedSeconds: number | null;
  readonly targetSeconds: number | null;
  readonly forecastSecondsRemaining: number | null;
  readonly risk: string;
  readonly riskReason: string;
  readonly ownerRole: string;
  readonly blockingReason: string | null;
  readonly nextMilestone: string | null;
};

export type WorkbenchProcessContext = {
  readonly milestones: ProcessMilestone[];
  readonly completedMilestones: string[];
  readonly pendingMilestones: string[];
  readonly health: ProcessHealth;
  readonly nextMilestone: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// BASE DE MEDIÇÃO — A LINHAGEM
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchBasisLine = {
  readonly lineKey: string;
  readonly unitCode: string;
  readonly actualQuantity: string;
  readonly plannedQuantity: string | null;
  readonly recordCount: number;
  readonly source: string;
};

export type WorkbenchMeasurementBasis = {
  readonly basisId: string | null;
  readonly executionClosureId: string | null;
  readonly preparedAt: string | null;
  readonly lineCount: number;
  readonly lines: WorkbenchBasisLine[];
};

// ═══════════════════════════════════════════════════════════════════════════════
// PLANEJADO / REALIZADO / MEDIDO — TRÊS VERDADES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * As três quantidades são campos SEPARADOS, e `null` significa "não informado" —
 * nunca zero. Somar as três num número só apagaria a decisão comercial.
 */
export type WorkbenchQuantityLine = {
  readonly dimensionKey: string;
  readonly label: string;
  readonly unitOfMeasure: string;
  readonly planned: string | null;
  readonly actual: string | null;
  readonly measured: string | null;
};

export type WorkbenchQuantities = {
  readonly lines: WorkbenchQuantityLine[];
  readonly totals: { readonly planned: number; readonly actual: number; readonly measured: number };
};

// ═══════════════════════════════════════════════════════════════════════════════
// ECONOMIA E CONTEXTO COMERCIAL
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchEconomics = {
  readonly grossValue: string | null;
  readonly currency: string | null;
  readonly financialVariance: string | null;
  readonly revenueExposure: string | null;
};

export type ResolvedTolerance = {
  readonly percentage: number;
  readonly source: string;
};

export type WorkbenchCommercialContext = {
  readonly pricing: {
    readonly source: string | null;
    readonly lineCount: number;
    readonly currencyCode: string | null;
  };
  readonly paymentTerms: string | null;
  readonly tolerance: ResolvedTolerance;
  readonly purchaseOrderRequirement: string | null;
  readonly billingPolicy: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// VARIAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Uma variação vem COMPLETA do backend: dimensão, as três quantidades, delta,
 * percentual, tolerância aplicada com sua fonte, severidade, impacto
 * financeiro, se exige decisão, o motivo do bloqueio em CÓDIGO e a resolução
 * recomendada.
 *
 * A tela NÃO recalcula nada disso e NÃO redige a explicação: `explanation` já
 * vem escrita pelo domínio, com o mesmo texto que a trilha registra.
 */
export type DetectedVariance = {
  readonly dimension: string;
  readonly dimensionKey: string;
  readonly measurementItemId: string | null;
  readonly plannedValue: string | null;
  readonly actualValue: string | null;
  readonly measuredValue: string | null;
  readonly unitOfMeasure: string | null;
  readonly absoluteDelta: string;
  readonly percentageDelta: number | null;
  readonly tolerancePercentage: number;
  readonly toleranceSource: string;
  readonly severity: string;
  readonly financialImpact: string | null;
  readonly currencyCode: string | null;
  readonly requiresDecision: boolean;
  readonly decisionKind: string;
  readonly blockingReason: string | null;
  readonly recommendedResolution: string | null;
  readonly explanation: string;
};

export type WorkbenchVarianceSummary = {
  readonly highestSeverity: string;
  readonly decisionRequiredCount: number;
  readonly approvalClearable: boolean;
  readonly summary: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ITENS, AJUSTES, EVIDÊNCIA
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchItem = {
  readonly id: string;
  readonly lineNumber: number;
  readonly unitCode: string;
  readonly plannedQuantity: string | null;
  readonly actualQuantity: string;
  readonly measuredQuantity: string;
  readonly unitPrice: string | null;
  readonly lineAmount: string | null;
  readonly origin: string;
  readonly sourceBasisLineKey: string | null;
};

export type WorkbenchAdjustment = {
  readonly id: string;
  readonly measurementItemId: string;
  readonly adjustmentQuantity: string;
  readonly unitCode: string;
  readonly reason: string;
  readonly authorizedByIdentityId: string;
  readonly financialImpact: string | null;
  readonly decidedAt: string | null;
  readonly createdAt: string;
};

export type WorkbenchEvidence = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly recordedAt: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ACEITE
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchAcceptanceRecord = {
  readonly id: string;
  readonly cycleNumber: number;
  readonly result: string;
  readonly observation: string;
  readonly rejectionReason: string | null;
  readonly evidenceId: string | null;
  readonly customerSignerName: string | null;
  readonly acceptedByIdentityId: string;
  readonly occurredAt: string;
};

export type WorkbenchAcceptance = {
  readonly policy: string;
  readonly policySource: string;
  readonly policyReason: string;
  readonly required: boolean;
  readonly state: string;
  readonly blocksBilling: boolean;
  readonly blockingReason: string | null;
  readonly latest: WorkbenchAcceptanceRecord | null;
  readonly history: Array<{
    readonly id: string;
    readonly cycleNumber: number;
    readonly result: string;
    readonly rejectionReason: string | null;
    readonly occurredAt: string;
  }>;
  readonly nextActionCode: string | null;
  readonly nextActionLabel: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ELEGIBILIDADE DE FATURAMENTO — MODELO DE DECISÃO
// ═══════════════════════════════════════════════════════════════════════════════

export type EligibilityDimensionResult = {
  readonly dimension: string;
  readonly label: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly reasonCode: string | null;
  readonly detail: string;
  readonly nextActionCode: string | null;
  readonly nextActionLabel: string | null;
  readonly blocking: boolean;
};

export type BillingEligibilityDecision = {
  /** `READY` é o único resultado que libera faturamento. É o READY_TO_BILL. */
  readonly result: string;
  readonly dimensions: EligibilityDimensionResult[];
  readonly blockingReasons: string[];
  readonly nextAction: { readonly code: string; readonly label: string } | null;
  readonly totalAmount: string | null;
  readonly currencyCode: string | null;
  readonly summary: string;
  readonly explanation: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// SITUAÇÕES, RELAÇÕES, FLUXO DE DOCUMENTOS, TRILHA
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkbenchSituation = {
  readonly code: string;
  readonly severity: string;
  readonly title: string;
  readonly detail: string;
  readonly ownerRole: string;
  readonly nextBestAction: string;
  readonly blocking: boolean;
};

export type WorkbenchRelationship = {
  readonly kind: string;
  readonly reference: string;
  readonly label: string;
};

export type WorkbenchDocumentFlowStep = {
  readonly step: number;
  readonly kind: string;
  readonly reference: string | null;
  readonly label: string;
  readonly state: 'EXISTS' | 'ABSENT';
  readonly href: string | null;
};

export type WorkbenchTimelineEvent = {
  readonly at: string;
  readonly kind: string;
  readonly label: string;
  readonly detail: string | null;
  readonly actorIdentityId: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMANDOS E PRÓXIMA AÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * UM COMANDO COM A DECISÃO JÁ TOMADA PELO BACKEND.
 *
 * A tela representa `enabled` e `blockingReasons`. Ela NÃO recalcula a
 * habilitação: não existe `status === X && variance < Y` em React.
 *
 * `reasonLabels` vem na MESMA ordem de `blockingReasons` — o backend já traduziu
 * os códigos, e um código novo aparece como o próprio código em vez de sumir.
 */
export type AvailableCommand = {
  readonly code: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly blockingReasons: string[];
  readonly reasonLabels: string[];
  readonly nextAction: string | null;
  readonly requiredPermission: string;
};

export type WorkbenchNextAction = {
  readonly code: string | null;
  readonly label: string | null;
  readonly explanation: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// WORKBENCH
// ═══════════════════════════════════════════════════════════════════════════════

export type MeasurementWorkbenchReadModel = {
  readonly identity: WorkbenchIdentity;
  readonly businessContext: WorkbenchBusinessContext;
  readonly statuses: WorkbenchStatuses;
  readonly processContext: WorkbenchProcessContext;
  readonly measurementBasis: WorkbenchMeasurementBasis;
  readonly quantities: WorkbenchQuantities;
  readonly economics: WorkbenchEconomics;
  readonly commercialContext: WorkbenchCommercialContext;
  readonly variances: DetectedVariance[];
  readonly varianceSummary: WorkbenchVarianceSummary;
  readonly adjustments: WorkbenchAdjustment[];
  readonly items: WorkbenchItem[];
  readonly evidence: WorkbenchEvidence[];
  readonly acceptance: WorkbenchAcceptance;
  readonly billingEligibility: BillingEligibilityDecision;
  readonly situations: WorkbenchSituation[];
  readonly relationships: WorkbenchRelationship[];
  readonly documentFlow: WorkbenchDocumentFlowStep[];
  readonly timeline: WorkbenchTimelineEvent[];
  readonly nextAction: WorkbenchNextAction | null;
  readonly availableCommands: AvailableCommand[];
  readonly decisionExplanation: {
    readonly measurement: string;
    readonly approval: string;
    readonly acceptance: string;
    readonly billing: string;
    readonly onBilling: string;
  };
  readonly freshness: WorkbenchFreshness;
};

// ═══════════════════════════════════════════════════════════════════════════════
// WORK QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

export type WorkQueueStatuses = {
  readonly measurement: string;
  readonly acceptance: string;
  readonly billingEligibility: string;
};

export type WorkQueueItem = {
  readonly measurementId: string | null;
  readonly serviceOrderId: string;
  readonly orderNumber: string;
  readonly customerLabel: string | null;
  readonly statuses: WorkQueueStatuses;
  readonly stage: string;
  readonly stageLabel: string;
  readonly reasonCode: string;
  readonly reasonLabel: string;
  readonly severity: string;
  readonly amount: string | null;
  readonly currencyCode: string | null;
  readonly ageSeconds: number | null;
  readonly ownerRole: string;
  readonly nextAction: { readonly code: string; readonly label: string };
};

export type MeasurementWorkQueueReadModel = {
  readonly context: { readonly unitId: string; readonly at: string };
  readonly counts: Record<string, number>;
  readonly items: WorkQueueItem[];
  readonly freshness: WorkbenchFreshness;
};

// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE LEAKAGE
// ═══════════════════════════════════════════════════════════════════════════════

export type RevenueLeakageStageTotal = {
  readonly stage: string;
  readonly label: string;
  readonly count: number;
  readonly amount: string | null;
  readonly unknownAmountCount: number;
  readonly currencyCode: string | null;
};

export type RevenueLeakagePosition = {
  readonly serviceOrderId: string;
  readonly orderNumber: string;
  readonly clientLabel: string | null;
  readonly stage: string;
  readonly stageLabel: string;
  readonly amount: string | null;
  readonly currencyCode: string | null;
  readonly ageSeconds: number | null;
  readonly ownerRole: string;
  readonly blockerCode: string | null;
  readonly nextAction: { readonly code: string; readonly label: string };
  readonly severity: string;
  readonly statuses: WorkQueueStatuses;
};

export type RevenueLeakageReadModel = {
  readonly context: { readonly unitId: string; readonly at: string };
  readonly stages: RevenueLeakageStageTotal[];
  readonly total: {
    readonly count: number;
    readonly amount: string | null;
    readonly unknownAmountCount: number;
    readonly currencyCode: string | null;
  };
  readonly positions: RevenueLeakagePosition[];
  readonly freshness: WorkbenchFreshness;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENVELOPE DE COMANDO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Todo comando carrega versão esperada e chave de idempotência. Sem versão, um
 * operador sobrescreveria o trabalho de outro; sem chave, um retry de rede
 * duplicaria o efeito.
 */
export type MeasurementCommandEnvelope = {
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly reason?: string | null;
};

export type RecordAcceptancePayload = MeasurementCommandEnvelope & {
  readonly result: 'ACCEPTED' | 'REJECTED';
  readonly observation: string;
  readonly rejectionReason?: string | null;
  readonly evidenceId?: string | null;
  readonly signatureId?: string | null;
  readonly customerSignerName?: string | null;
  readonly occurredAt?: string;
};

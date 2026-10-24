/**
 * CONTRATOS DE OPERAÇÃO — espelho EXATO do que o backend publica.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * A REGRA QUE ESTES TIPOS PROTEGEM
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Nenhum cálculo de decisão vive aqui. Não existe, neste arquivo, `isReady`,
 * `canComplete`, `computeSla` nem `shouldDispatch`: essas perguntas são respondidas
 * pelo backend, e o frontend apenas LÊ.
 *
 * Os campos abaixo são `readonly` de propósito. Um read model que o React pode
 * mutar é um read model que o React pode reescrever — e a primeira mutação é
 * sempre "só para organizar a tela".
 */

// ═══════════════════════════════════════════════════════════════════════════════
// COMANDOS
// ═══════════════════════════════════════════════════════════════════════════════

export type AvailableCommandCode =
  | 'DISPATCH'
  | 'CHECK_IN'
  | 'START'
  | 'PAUSE'
  | 'RESUME'
  | 'REGISTER_PROGRESS'
  | 'REGISTER_ACTUAL'
  | 'REGISTER_METER'
  | 'REGISTER_FUEL'
  | 'REGISTER_LABOR'
  | 'REGISTER_EQUIPMENT_USAGE'
  | 'REGISTER_MATERIAL_USAGE'
  | 'ATTACH_EVIDENCE'
  | 'REGISTER_SIGNATURE'
  | 'REPORT_EXCEPTION'
  | 'ESCALATE'
  | 'COMPLETE'
  | 'CANCEL';

/**
 * Comando disponível, com a decisão JÁ tomada pelo backend.
 *
 * `enabled` e `reasons` chegam prontos. A tela não deriva um do outro.
 */
export type AvailableCommand = {
  readonly code: AvailableCommandCode;
  readonly label: string;
  readonly enabled: boolean;
  readonly reasons: readonly string[];
  readonly reasonLabels: readonly string[];
  readonly nextAction: AvailableCommandCode | null;
  readonly requiredPermission: string;
  readonly route: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRONTIDÃO DE DESPACHO
// ═══════════════════════════════════════════════════════════════════════════════

export type DispatchReadinessStatus = 'READY' | 'BLOCKED' | 'WARNING' | 'NOT_APPLICABLE';

export type DispatchReadinessDimension = {
  readonly dimension: string;
  readonly status: DispatchReadinessStatus;
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly resource: {
    readonly id: string;
    readonly code: string;
    readonly kind: string;
    readonly label: string | null;
  } | null;
  readonly qualificationCode: string | null;
  readonly dueAt: string | null;
  readonly resolution: string | null;
};

export type DispatchReadiness = {
  readonly ready: boolean;
  readonly status: DispatchReadinessStatus;
  readonly blockingReasons: readonly DispatchReadinessDimension[];
  readonly warnings: readonly DispatchReadinessDimension[];
  readonly dimensions: readonly DispatchReadinessDimension[];
  readonly nextAction: string | null;
  readonly summary: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// GATE DE CONCLUSÃO
// ═══════════════════════════════════════════════════════════════════════════════

export type CompletionBlocker = {
  readonly reasonCode: string;
  readonly reason: string;
  readonly resource: {
    readonly id: string;
    readonly code: string;
    readonly kind: string;
    readonly label: string | null;
  } | null;
  readonly missingCode: string | null;
  readonly resolution: string;
  readonly resolutionLabel: string;
};

export type CompletionGate = {
  readonly canComplete: boolean;
  readonly blockingReasons: readonly CompletionBlocker[];
  readonly nextAction: string | null;
  readonly nextActionLabel: string | null;
  readonly consequences: readonly { readonly code: string; readonly label: string }[];
  readonly summary: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESSO
// ═══════════════════════════════════════════════════════════════════════════════

export type OperationalStageState = 'DONE' | 'CURRENT' | 'PENDING' | 'ATTENTION' | 'NOT_APPLICABLE';

export type OperationalStageStep = {
  readonly stage: string;
  readonly label: string;
  readonly state: OperationalStageState;
  readonly at: string | null;
  readonly detail: string | null;
  readonly href: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// SITUAÇÕES
// ═══════════════════════════════════════════════════════════════════════════════

export type ExecutionSituation = {
  readonly code: string;
  readonly detectedKey: string;
  readonly severity: string;
  readonly title: string;
  readonly detail: string;
  readonly impact: string;
  readonly ownerRole: string;
  readonly nextBestAction: string;
  readonly occurredAt: string;
  readonly blocking: boolean;
  readonly financialExposure: string | null;
  readonly alreadyOpen: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ACTUALS
// ═══════════════════════════════════════════════════════════════════════════════

export type VarianceDirection = 'OVER' | 'UNDER' | 'EQUAL' | 'UNKNOWN';

export type ActualComparisonLine = {
  readonly group: string;
  readonly label: string;
  readonly actualValue: string | null;
  readonly unitOfMeasure: string | null;
  readonly plannedValue: string | null;
  readonly variance: string | null;
  readonly direction: VarianceDirection;
  readonly explainable: boolean;
  readonly explanation: string | null;
  readonly recordCount: number;
};

export type ResourceSubstitution = {
  readonly role: 'DRIVER' | 'VEHICLE' | 'EQUIPMENT';
  readonly plannedCode: string | null;
  readonly actualCode: string | null;
  readonly changed: boolean;
};

export type ExecutionActualRecord = {
  readonly id: string;
  readonly actualKind: string;
  readonly resourceLabel: string | null;
  readonly actualValue: string;
  readonly unitOfMeasure: string;
  readonly plannedValue: string | null;
  readonly source: string;
  readonly occurredAt: string;
};

export type ExecutionMeterRecord = {
  readonly id: string;
  readonly meterKind: string;
  readonly readingValue: string;
  readonly unitOfMeasure: string;
  readonly isInitial: boolean;
  readonly isFinal: boolean;
  readonly readAt: string;
};

export type ExecutionFuelRecord = {
  readonly id: string;
  readonly volumeLiters: string;
  readonly unitPrice: string | null;
  readonly odometerReading: string | null;
  readonly fueledAt: string;
};

export type ExecutionEvidenceRecord = {
  readonly id: string;
  readonly evidenceKind: string;
  readonly status: string;
  readonly recordedAt: string;
};

export type ExecutionSignatureRecord = {
  readonly id: string;
  readonly signerName: string;
  readonly signatureKind: string;
  readonly signedAt: string;
};

export type ExecutionActualsReadModel = {
  readonly comparison: {
    readonly lines: readonly ActualComparisonLine[];
    readonly substitutions: readonly ResourceSubstitution[];
    readonly recordCount: number;
    readonly hasActuals: boolean;
    readonly summary: string;
  };
  readonly records: readonly ExecutionActualRecord[];
  readonly meters: readonly ExecutionMeterRecord[];
  readonly fuel: readonly ExecutionFuelRecord[];
  readonly evidence: readonly ExecutionEvidenceRecord[];
  readonly signatures: readonly ExecutionSignatureRecord[];
};

// ═══════════════════════════════════════════════════════════════════════════════
// OBJECT PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export type ServiceOrderOverview = {
  readonly identity: {
    readonly serviceOrderId: string;
    readonly orderNumber: string;
    readonly internalCode: string | null;
    readonly serviceLabel: string | null;
    readonly clientLabel: string | null;
    readonly unitId: string;
    readonly description: string | null;
    readonly rowVersion: number;
  };
  readonly businessContext: {
    readonly origin: string | null;
    readonly contractReference: string | null;
    readonly customerPurchaseOrderNumber: string | null;
    readonly priority: string | null;
  };
  readonly statuses: {
    readonly operational: string;
    readonly planning: string;
    readonly reservation: string;
    readonly dispatch: string;
    readonly execution: string;
    readonly actuals: string;
    readonly measurement: string;
    readonly billing: string;
    readonly accounting: string;
  };
  readonly process: readonly OperationalStageStep[];
  readonly currentStage: string | null;
  readonly planning: {
    readonly plannedResourceCount: number;
    readonly activeAllocationCount: number;
    readonly activeResources: readonly {
      readonly allocationId: string;
      readonly resourceCode: string;
      readonly resourceLabel: string | null;
      readonly role: string;
      readonly operationalStart: string;
      readonly operationalEnd: string;
    }[];
  };
  readonly dispatch: {
    readonly dispatchedAt: string | null;
    readonly checkedInAt: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
    readonly readiness: DispatchReadiness;
  };
  readonly execution: {
    readonly startedAt: string | null;
    readonly pausedAt: string | null;
    readonly completedAt: string | null;
    readonly executionClosedAt: string | null;
    readonly measurementBasisPreparedAt: string | null;
  };
  readonly actuals: ExecutionActualsReadModel;
  readonly completionGate: CompletionGate;
  readonly economics: {
    readonly plannedRevenue: string | null;
    readonly plannedCost: string | null;
    readonly currencyCode: string | null;
  };
  readonly situations: readonly ExecutionSituation[];
  readonly timeline: readonly {
    readonly at: string;
    readonly kind: string;
    readonly label: string;
    readonly detail: string | null;
    readonly actorIdentityId: string | null;
  }[];
  readonly nextAction: {
    readonly code: string | null;
    readonly label: string | null;
    readonly explanation: string | null;
  };
  readonly availableCommands: readonly AvailableCommand[];
  readonly decisionExplanation: {
    readonly completionSummary: string;
    readonly onCompletion: readonly { readonly code: string; readonly label: string }[];
    readonly dispatchSummary: string;
  };
  readonly freshness: { readonly readAt: string; readonly authority: 'SERVER' };
};

// ═══════════════════════════════════════════════════════════════════════════════
// BOARD E CONSOLE
// ═══════════════════════════════════════════════════════════════════════════════

export type DispatchBoardItem = {
  readonly serviceOrderId: string;
  readonly orderNumber: string;
  readonly clientLabel: string | null;
  readonly serviceLabel: string | null;
  readonly unitId: string;
  readonly status: string;
  /** Versão do agregado observada nesta leitura — enviada no comando. */
  readonly rowVersion: number;
  readonly windowStartAt: string | null;
  readonly windowEndAt: string | null;
  readonly readiness: {
    readonly ready: boolean;
    readonly status: string;
    readonly summary: string;
    readonly blockingReasons: readonly {
      readonly dimension: string;
      readonly reasonCode: string | null;
      readonly reason: string | null;
      readonly resolution: string | null;
      readonly resourceCode: string | null;
    }[];
  };
  readonly dispatchedAt: string | null;
  readonly checkedInAt: string | null;
  readonly dueAt: string | null;
  readonly slaRemaining: string | null;
  readonly availableCommands: readonly AvailableCommand[];
  readonly nextAction: { readonly code: string; readonly label: string } | null;
  readonly situations: readonly {
    readonly code: string;
    readonly severity: string;
    readonly title: string;
    readonly blocking: boolean;
  }[];
};

export type DispatchBoardReadModel = {
  readonly context: { readonly unitId: string; readonly at: string };
  readonly readyCount: number;
  readonly blockedCount: number;
  readonly riskCount: number;
  readonly dispatchedCount: number;
  readonly items: readonly DispatchBoardItem[];
  readonly freshness: { readonly readAt: string; readonly authority: 'SERVER' };
};

export type ExecutionConsoleItem = {
  readonly serviceOrderId: string;
  readonly orderNumber: string;
  readonly clientLabel: string | null;
  readonly serviceLabel: string | null;
  readonly status: string;
  readonly startedAt: string | null;
  readonly pausedAt: string | null;
  readonly dueAt: string | null;
  readonly slaRemaining: string | null;
  readonly slaStatus: 'OK' | 'RISK' | 'LATE' | 'UNKNOWN';
  readonly progress: {
    readonly measured: string;
    readonly planned: string;
    readonly ratio: number;
  } | null;
  readonly situations: readonly {
    readonly code: string;
    readonly severity: string;
    readonly title: string;
    readonly detail: string;
    readonly ownerRole: string;
    readonly nextBestAction: string;
    readonly blocking: boolean;
  }[];
  readonly availableCommands: readonly AvailableCommand[];
  readonly nextAction: { readonly code: string; readonly label: string } | null;
  readonly exceptionReason: string | null;
};

export type ExecutionConsoleReadModel = {
  readonly context: { readonly unitId: string; readonly at: string };
  readonly summary: {
    readonly inProgress: number;
    readonly paused: number;
    readonly atRisk: number;
    readonly overdue: number;
    readonly blocked: number;
  };
  readonly items: readonly ExecutionConsoleItem[];
  readonly freshness: { readonly readAt: string; readonly authority: 'SERVER' };
};

export type MeasurementReadinessReadModel = {
  readonly ready: boolean;
  readonly summary: string;
  readonly executionClosedAt: string | null;
  readonly basisPreparedAt: string | null;
  readonly basisId: string | null;
  readonly lineCount: number;
  readonly blockers: readonly string[];
  readonly freshness: { readonly readAt: string; readonly authority: 'SERVER' };
};

// ═══════════════════════════════════════════════════════════════════════════════
// RÓTULOS DE APRESENTAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rótulo humano dos estados.
 *
 * Apresentação, não decisão: um estado que chega do backend sem tradução aparece
 * como o próprio código, em vez de receber um rótulo inventado. O texto não altera
 * o significado nem habilita nada.
 */
export const STATE_LABELS: Readonly<Record<string, string>> = {
  CONFIRMED: 'Confirmado',
  NOT_PLANNED: 'Não planejado',
  NOT_RESERVED: 'Não reservado',
  NOT_DISPATCHED: 'Não despachado',
  DISPATCHED: 'Despachado',
  CHECKED_IN: 'Chegada registrada',
  NOT_STARTED: 'Não iniciada',
  IN_PROGRESS: 'Em execução',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
  BLOCKED: 'Bloqueada',
  NONE: 'Nenhum',
  PARTIAL: 'Parcial',
  COMPLETE: 'Completo',
  READY: 'Pronto',
  PENDING_BASIS: 'Base de medição pendente',
  NOT_CLOSED: 'Execução não fechada',
  NOT_READY: 'Não pronta',
  NOT_ELIGIBLE: 'Não elegível',
  NOT_APPLICABLE: 'Não aplicável',
  RELEASED: 'Liberada',
  PREPARED: 'Preparada',
  DRAFT: 'Rascunho',
  WARNING: 'Atenção',
};

export function stateLabel(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  return STATE_LABELS[value] ?? value;
}

/** Rótulo do estágio do processo. Já vem do backend; aqui é só a cor. */
export const STAGE_TONE: Readonly<Record<OperationalStageState, string>> = {
  DONE: 'text-emerald-700',
  CURRENT: 'text-brand-700 font-semibold',
  ATTENTION: 'text-amber-700 font-semibold',
  PENDING: 'text-gray-400',
  NOT_APPLICABLE: 'text-gray-300',
};

export const STAGE_MARK: Readonly<Record<OperationalStageState, string>> = {
  DONE: '✓',
  CURRENT: '●',
  ATTENTION: '!',
  PENDING: '○',
  NOT_APPLICABLE: '–',
};

/** Tom da severidade da situação. Fechado; não existe severidade inventada. */
export const SEVERITY_TONE: Readonly<Record<string, string>> = {
  P1: 'text-red-700 bg-red-50 border-red-200',
  P2: 'text-amber-700 bg-amber-50 border-amber-200',
  P3: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  P4: 'text-gray-700 bg-gray-50 border-gray-200',
};

export function severityTone(severity: string): string {
  return SEVERITY_TONE[severity] ?? SEVERITY_TONE['P4']!;
}

/** Tom do SLA conforme o backend classificou. */
export const SLA_TONE: Readonly<Record<string, string>> = {
  OK: 'text-emerald-700',
  RISK: 'text-amber-700',
  LATE: 'text-red-700',
  UNKNOWN: 'text-gray-500',
};

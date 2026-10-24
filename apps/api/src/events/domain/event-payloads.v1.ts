import { DOMAIN_EVENT_PAYLOAD_VERSION } from './domain-event-type';

type PayloadBase = {
  schemaVersion: typeof DOMAIN_EVENT_PAYLOAD_VERSION;
};

export type ServiceRequestSubmittedPayloadV1 = PayloadBase & {
  serviceRequestId: string;
  unitId: string;
  clientId: string | null;
  submittedAt: string;
};

export type ServiceOrderReleasedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  clientId: string | null;
  orderNumber: string;
  releasedAt: string;
};

export type ServiceOrderAssignedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  allocationId: string;
  physicalAssetId: string | null;
  workforceMemberId?: string | null;
  resourceTypeCode: string;
  assignedAt: string;
};

export type ServiceOrderCompletedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  clientId: string | null;
  orderNumber: string;
  completedAt: string;
};

export type MeasurementSubmittedPayloadV1 = PayloadBase & {
  measurementId: string;
  serviceOrderId: string;
  unitId: string;
  submittedAt: string;
};

export type MeasurementApprovedPayloadV1 = PayloadBase & {
  measurementId: string;
  serviceOrderId: string;
  unitId: string;
  approvedAt: string;
};

export type BillingReadyPayloadV1 = PayloadBase & {
  billingRecordId: string;
  serviceOrderId: string;
  measurementId: string | null;
  unitId: string;
  totalAmount: string;
  preparedAt: string;
};

export type PaymentOverduePayloadV1 = PayloadBase & {
  billingDocumentId: string;
  billingRecordId: string;
  serviceOrderId: string;
  unitId: string;
  documentNumber: string;
  dueDate: string;
  overdueDetectedAt: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// DISPATCH + EXECUTION + ACTUALS
// ═══════════════════════════════════════════════════════════════════════════════
//
// Nenhum destes payloads carrega ator, sessão, grant ou permissão: a autorização
// é do comando, não do fato. `assertAuthorizationIndependentPayload` recusaria —
// e é justamente o que impede um evento de virar vetor de vazamento de escopo.

/** Fato de despacho: a ordem SAIU, com janela e recursos confirmados. */
export type ServiceOrderDispatchedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  clientId: string | null;
  orderNumber: string;
  dispatchId: string;
  windowStart: string;
  windowEnd: string;
  /** Quantidade de recursos confirmados no ato (nunca a lista nominal). */
  confirmedResourceCount: number;
  dispatchedAt: string;
};

export type ServiceExecutionStartedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  clientId: string | null;
  orderNumber: string;
  startedAt: string;
};

export type ServiceExecutionPausedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  pausedAt: string;
};

export type ServiceExecutionResumedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  resumedAt: string;
};

/** Progresso medido. Alimenta a leitura de SLA por ritmo. */
export type ServiceProgressRecordedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  entryId: string;
  progressKind: string;
  quantityValue: string | null;
  unitCode: string | null;
  recordedAt: string;
};

/**
 * Uso de RECURSO. É o fato que o COSTING consome por categoria.
 *
 * `actualKind` e `unitOfMeasure` são o vocabulário do domínio; o valor é string
 * decimal para não perder precisão no transporte.
 */
export type ResourceUsageRecordedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  actualId: string;
  actualKind: string;
  actualValue: string;
  unitOfMeasure: string;
  physicalAssetId: string | null;
  workforceMemberId: string | null;
  occurredAt: string;
};

export type ExecutionExceptionReportedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  occurrenceId: string;
  occurrenceCode: string;
  reportedAt: string;
};

/** Conclusão da execução: os realizados estão congelados. */
export type ExecutionCompletedPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  clientId: string | null;
  orderNumber: string;
  executionClosureId: string;
  actualCount: number;
  completedAt: string;
};

/** Base de medição publicada: a capability seguinte já pode trabalhar. */
export type MeasurementBasisReadyPayloadV1 = PayloadBase & {
  serviceOrderId: string;
  unitId: string;
  clientId: string | null;
  orderNumber: string;
  measurementBasisId: string;
  executionClosureId: string;
  lineCount: number;
  preparedAt: string;
};

export type DomainEventPayloadV1 =
  | ServiceRequestSubmittedPayloadV1
  | ServiceOrderReleasedPayloadV1
  | ServiceOrderAssignedPayloadV1
  | ServiceOrderCompletedPayloadV1
  | MeasurementSubmittedPayloadV1
  | MeasurementApprovedPayloadV1
  | BillingReadyPayloadV1
  | PaymentOverduePayloadV1
  | ServiceOrderDispatchedPayloadV1
  | ServiceExecutionStartedPayloadV1
  | ServiceExecutionPausedPayloadV1
  | ServiceExecutionResumedPayloadV1
  | ServiceProgressRecordedPayloadV1
  | ResourceUsageRecordedPayloadV1
  | ExecutionExceptionReportedPayloadV1
  | ExecutionCompletedPayloadV1
  | MeasurementBasisReadyPayloadV1;

export function assertDomainEventPayloadVersion(version: number): void {
  if (version !== DOMAIN_EVENT_PAYLOAD_VERSION) {
    throw new Error(`UNSUPPORTED_DOMAIN_EVENT_PAYLOAD_VERSION:${version}`);
  }
}

function withSchemaVersion<T extends Record<string, unknown>>(payload: T): T & PayloadBase {
  return { schemaVersion: DOMAIN_EVENT_PAYLOAD_VERSION, ...payload };
}

export function buildServiceRequestSubmittedPayloadV1(
  input: Omit<ServiceRequestSubmittedPayloadV1, 'schemaVersion'>,
): ServiceRequestSubmittedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildServiceOrderReleasedPayloadV1(
  input: Omit<ServiceOrderReleasedPayloadV1, 'schemaVersion'>,
): ServiceOrderReleasedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildServiceOrderAssignedPayloadV1(
  input: Omit<ServiceOrderAssignedPayloadV1, 'schemaVersion'>,
): ServiceOrderAssignedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildServiceOrderCompletedPayloadV1(
  input: Omit<ServiceOrderCompletedPayloadV1, 'schemaVersion'>,
): ServiceOrderCompletedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildMeasurementSubmittedPayloadV1(
  input: Omit<MeasurementSubmittedPayloadV1, 'schemaVersion'>,
): MeasurementSubmittedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildMeasurementApprovedPayloadV1(
  input: Omit<MeasurementApprovedPayloadV1, 'schemaVersion'>,
): MeasurementApprovedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildBillingReadyPayloadV1(
  input: Omit<BillingReadyPayloadV1, 'schemaVersion'>,
): BillingReadyPayloadV1 {
  return withSchemaVersion(input);
}

export function buildPaymentOverduePayloadV1(
  input: Omit<PaymentOverduePayloadV1, 'schemaVersion'>,
): PaymentOverduePayloadV1 {
  return withSchemaVersion(input);
}

export function buildServiceOrderDispatchedPayloadV1(
  input: Omit<ServiceOrderDispatchedPayloadV1, 'schemaVersion'>,
): ServiceOrderDispatchedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildServiceExecutionStartedPayloadV1(
  input: Omit<ServiceExecutionStartedPayloadV1, 'schemaVersion'>,
): ServiceExecutionStartedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildServiceExecutionPausedPayloadV1(
  input: Omit<ServiceExecutionPausedPayloadV1, 'schemaVersion'>,
): ServiceExecutionPausedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildServiceExecutionResumedPayloadV1(
  input: Omit<ServiceExecutionResumedPayloadV1, 'schemaVersion'>,
): ServiceExecutionResumedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildServiceProgressRecordedPayloadV1(
  input: Omit<ServiceProgressRecordedPayloadV1, 'schemaVersion'>,
): ServiceProgressRecordedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildResourceUsageRecordedPayloadV1(
  input: Omit<ResourceUsageRecordedPayloadV1, 'schemaVersion'>,
): ResourceUsageRecordedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildExecutionExceptionReportedPayloadV1(
  input: Omit<ExecutionExceptionReportedPayloadV1, 'schemaVersion'>,
): ExecutionExceptionReportedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildExecutionCompletedPayloadV1(
  input: Omit<ExecutionCompletedPayloadV1, 'schemaVersion'>,
): ExecutionCompletedPayloadV1 {
  return withSchemaVersion(input);
}

export function buildMeasurementBasisReadyPayloadV1(
  input: Omit<MeasurementBasisReadyPayloadV1, 'schemaVersion'>,
): MeasurementBasisReadyPayloadV1 {
  return withSchemaVersion(input);
}

export function isAuthorizationSensitivePayloadKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('actor') ||
    normalized.includes('identity') ||
    normalized.includes('session') ||
    normalized.includes('grant') ||
    normalized.includes('permission')
  );
}

export function assertAuthorizationIndependentPayload(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (isAuthorizationSensitivePayloadKey(key)) {
      throw new Error(`AUTHORIZATION_SENSITIVE_PAYLOAD_FIELD:${key}`);
    }
    const value = payload[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      assertAuthorizationIndependentPayload(value as Record<string, unknown>);
    }
  }
}

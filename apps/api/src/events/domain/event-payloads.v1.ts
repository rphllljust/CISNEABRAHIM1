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

export type DomainEventPayloadV1 =
  | ServiceRequestSubmittedPayloadV1
  | ServiceOrderReleasedPayloadV1
  | ServiceOrderAssignedPayloadV1
  | ServiceOrderCompletedPayloadV1
  | MeasurementSubmittedPayloadV1
  | MeasurementApprovedPayloadV1
  | BillingReadyPayloadV1
  | PaymentOverduePayloadV1;

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

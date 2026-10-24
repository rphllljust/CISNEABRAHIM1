export const DOMAIN_EVENT_TYPES = {
  ServiceRequestSubmitted: 'SERVICE_REQUEST_SUBMITTED',
  ServiceOrderReleased: 'SERVICE_ORDER_RELEASED',
  ServiceOrderAssigned: 'SERVICE_ORDER_ASSIGNED',
  ServiceOrderCompleted: 'SERVICE_ORDER_COMPLETED',
  MeasurementSubmitted: 'MEASUREMENT_SUBMITTED',
  MeasurementApproved: 'MEASUREMENT_APPROVED',
  BillingReady: 'BILLING_READY',
  PaymentOverdue: 'PAYMENT_OVERDUE',
  /**
   * F1.1 — fatos econômicos publicados pelo FINANCE. Antes desta lista o FINANCE
   * alterava estado econômico sem nenhum evento: o ACCOUNTING não tinha como saber
   * que o journal do settlement/payment era devido.
   */
  SettlementConfirmed: 'SETTLEMENT_CONFIRMED',
  SettlementReversed: 'SETTLEMENT_REVERSED',
  PaymentConfirmed: 'PAYMENT_CONFIRMED',
  PaymentReversed: 'PAYMENT_REVERSED',
  /**
   * F1.2 — fatos econômicos dos demais produtores. Antes desta lista, FISCAL,
   * INVENTORY e PAYROLL publicavam a contabilidade por chamada síncrona depois do
   * COMMIT: o fato existia sem evento e sem retry.
   */
  FiscalDocumentAuthorized: 'FISCAL_DOCUMENT_AUTHORIZED',
  FiscalDocumentCancelled: 'FISCAL_DOCUMENT_CANCELLED',
  TaxCalculationConfirmed: 'TAX_CALCULATION_CONFIRMED',
  InventoryMovementPosted: 'INVENTORY_MOVEMENT_POSTED',
  PayrollClosed: 'PAYROLL_CLOSED',
  PayrollReopened: 'PAYROLL_REOPENED',
} as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES];

/**
 * F1.1 — o evento carrega um FATO ECONÔMICO que exige decisão contábil?
 *
 * Fonte única da distinção. Quem publica (outbox) e quem decide (ACCOUNTING) usam a
 * MESMA função — nenhum dos dois mantém lista própria de tipos que possam divergir.
 */
const ECONOMIC_DOMAIN_EVENT_TYPES = new Set<string>([
  DOMAIN_EVENT_TYPES.SettlementConfirmed,
  DOMAIN_EVENT_TYPES.SettlementReversed,
  DOMAIN_EVENT_TYPES.PaymentConfirmed,
  DOMAIN_EVENT_TYPES.PaymentReversed,
  DOMAIN_EVENT_TYPES.FiscalDocumentAuthorized,
  DOMAIN_EVENT_TYPES.FiscalDocumentCancelled,
  DOMAIN_EVENT_TYPES.TaxCalculationConfirmed,
  DOMAIN_EVENT_TYPES.InventoryMovementPosted,
  DOMAIN_EVENT_TYPES.PayrollClosed,
  DOMAIN_EVENT_TYPES.PayrollReopened,
]);

export function isEconomicDomainEventType(value: string): boolean {
  return ECONOMIC_DOMAIN_EVENT_TYPES.has(value);
}

export const AGGREGATE_TYPES = {
  ServiceRequest: 'service-request',
  ServiceOrder: 'service-order',
  Measurement: 'measurement',
  BillingRecord: 'billing-record',
  BillingDocument: 'billing-document',
} as const;

export type AggregateType = (typeof AGGREGATE_TYPES)[keyof typeof AGGREGATE_TYPES];

export const DOMAIN_EVENT_PAYLOAD_VERSION = 1;

export const NOTIFICATION_INTENT_PAYLOAD_VERSION = 1;

export const NOTIFICATION_INTENT_STATUS = {
  Pending: 'PENDING',
  Dispatched: 'DISPATCHED',
  Cancelled: 'CANCELLED',
} as const;

export type NotificationIntentStatus =
  (typeof NOTIFICATION_INTENT_STATUS)[keyof typeof NOTIFICATION_INTENT_STATUS];

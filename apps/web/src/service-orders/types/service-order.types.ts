export const SERVICE_ORDER_STATUSES = {
  Draft: 'DRAFT',
  Prepared: 'PREPARED',
  Released: 'RELEASED',
  InExecution: 'IN_EXECUTION',
  Paused: 'PAUSED',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
} as const;

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[keyof typeof SERVICE_ORDER_STATUSES];

export type ServiceOrderHistoryEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  actorIdentityId: string | null;
  occurredAt: string;
};

export type ServiceOrderServiceSnapshot = {
  serviceCode: string;
  serviceName: string;
  measurementModel?: {
    mode: string;
    basis: string;
    defaultUnitCode: string | null;
  };
  allowedUnits?: Array<{ unitCode: string; isDefault?: boolean; sortOrder?: number }>;
  requirements: {
    resources: Array<{
      physicalResourceTypeCode: string;
      requirementLevel: string;
      minQuantity: string | null;
      sortOrder: number;
    }>;
    labor: Array<{
      laborTypeCode: string;
      requirementLevel: string;
      minQuantity: string | null;
      sortOrder: number;
    }>;
    execution: Array<{
      evidenceKind: string;
      requirementLevel: string;
      config: Record<string, unknown> | null;
      sortOrder: number;
    }>;
  };
};

export type ServiceOrderDetail = {
  id: string;
  internalCode: string;
  orderNumber: string;
  unitId: string;
  status: ServiceOrderStatus;
  origin: string;
  clientId: string | null;
  clientSnapshot: Record<string, unknown> | null;
  proposalId?: string | null;
  proposalSnapshot?: Record<string, unknown> | null;
  purchaseOrderId?: string | null;
  purchaseOrderSnapshot?: Record<string, unknown> | null;
  contractReference?: string | null;
  contractSnapshot?: Record<string, unknown> | null;
  serviceDefinitionId: string | null;
  serviceDefinitionVersionId: string | null;
  serviceSnapshot: ServiceOrderServiceSnapshot;
  description: string | null;
  rowVersion: number;
  /**
   * Instantes PERSISTIDOS do ciclo de vida. O detalhe da OS ja devolve esses campos
   * (`toServiceOrderResponse`); eles entram aqui para que a interface possa datar cada passo
   * real do fluxo sem derivar nada. Ausente = o passo ainda nao aconteceu.
   */
  createdAt?: string | null;
  preparedAt: string | null;
  releasedAt: string | null;
  startedAt?: string | null;
  pausedAt?: string | null;
  completedAt?: string | null;
  cancelledAt: string | null;
  historyEvents: ServiceOrderHistoryEvent[];
  /**
   * Operations Control Center: projeção DERIVADA pelo backend (progressão, planejado x realizado,
   * downstream e próximo passo). O frontend renderiza apenas o que veio autorizado — blocos de
   * medição/faturamento chegam zerados/nulos quando o ator não tem autorização no módulo dono.
   */
  controlCenter?: ServiceOrderControlCenter;
};

export type ControlCenterStepCode =
  | 'DEMAND'
  | 'PLANNING'
  | 'RELEASE'
  | 'EXECUTION'
  | 'COMPLETION'
  | 'MEASUREMENT'
  | 'BILLING';

export type ServiceOrderControlCenter = {
  progression: Array<{
    code: ControlCenterStepCode;
    state: 'DONE' | 'CURRENT' | 'PENDING' | 'ATTENTION';
    at: string | null;
    detail: string | null;
    ownerStatus: string | null;
  }>;
  plannedVsActual: {
    plannedResources: number;
    activeAllocations: number;
    executionEntries: number;
    executedQuantityTotal: string | null;
    divergences: string[];
  };
  downstream: {
    measurement: { count: number; status: string | null; createdAt: string | null };
    billing: {
      count: number;
      status: string | null;
      createdAt: string | null;
      totalAmount: string | null;
      currencyCode: string | null;
    };
  };
  nextAction: {
    step: string;
    transition: string | null;
    availableTransitions: string[];
    blockers: string[];
  };
};

export const SERVICE_ORDERS_ERROR_CODES = {
  VALIDATION_FAILED: 'SERVICE_ORDERS_VALIDATION_FAILED',
  DENIED: 'SERVICE_ORDERS_DENIED',
  NOT_FOUND: 'SERVICE_ORDERS_NOT_FOUND',
  VERSION_CONFLICT: 'SERVICE_ORDERS_VERSION_CONFLICT',
  INVALID_STATE: 'SERVICE_ORDERS_INVALID_STATE',
  ASSET_NOT_FOUND: 'SERVICE_ORDERS_ASSET_NOT_FOUND',
  ASSET_INACTIVE: 'SERVICE_ORDERS_ASSET_INACTIVE',
  ALLOCATION_CONFLICT: 'SERVICE_ORDERS_ALLOCATION_CONFLICT',
  RESOURCE_TYPE_MISMATCH: 'SERVICE_ORDERS_RESOURCE_TYPE_MISMATCH',
  RESOURCE_TYPE_NOT_REQUIRED: 'SERVICE_ORDERS_RESOURCE_TYPE_NOT_REQUIRED',
  ALLOCATION_OUTSIDE_WINDOW: 'SERVICE_ORDERS_ALLOCATION_OUTSIDE_WINDOW',
  PLANNED_RESOURCE_NOT_FOUND: 'SERVICE_ORDERS_PLANNED_RESOURCE_NOT_FOUND',
  ALLOCATION_NOT_FOUND: 'SERVICE_ORDERS_ALLOCATION_NOT_FOUND',
  MINIMUM_RESOURCES_NOT_MET: 'SERVICE_ORDERS_MINIMUM_RESOURCES_NOT_MET',
  REQUIRED_EVIDENCE_MISSING: 'SERVICE_ORDERS_REQUIRED_EVIDENCE_MISSING',
} as const;

export type ServiceOrdersErrorCode =
  (typeof SERVICE_ORDERS_ERROR_CODES)[keyof typeof SERVICE_ORDERS_ERROR_CODES];

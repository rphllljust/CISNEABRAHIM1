export type ServiceOrderRow = {
  id: string;
  internal_code: string;
  order_number: string;
  unit_id: string;
  status: string;
  origin: string;
  client_id: string | null;
  client_snapshot: Record<string, unknown> | null;
  service_definition_id: string | null;
  service_definition_version_id: string | null;
  service_snapshot: Record<string, unknown>;
  description: string | null;
  location: Record<string, unknown>;
  priority: string | null;
  operational_notes: string | null;
  service_request_id: string | null;
  proposal_id: string | null;
  proposal_snapshot: Record<string, unknown> | null;
  purchase_order_id: string | null;
  purchase_order_snapshot: Record<string, unknown> | null;
  rc_number: string | null;
  contract_id: string | null;
  contract_reference: string | null;
  contract_snapshot: Record<string, unknown> | null;
  prepared_at: string | null;
  prepared_by_identity_id: string | null;
  released_at: string | null;
  released_by_identity_id: string | null;
  cancelled_at: string | null;
  cancelled_by_identity_id: string | null;
  cancellation_reason: string | null;
  started_at: string | null;
  started_by_identity_id: string | null;
  paused_at: string | null;
  paused_by_identity_id: string | null;
  completed_at: string | null;
  completed_by_identity_id: string | null;
  status_before_cancel: string | null;
  reopened_at: string | null;
  reopened_by_identity_id: string | null;
  reopen_reason: string | null;
  status_before_reopen: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  created_by_identity_id: string;
  updated_by_identity_id: string;
  assigned_identity_id?: string | null;
  /**
   * Projecao de despacho da listagem: membro de mao de obra atribuido
   * (alocacao ACTIVE) e prazo operacional derivado pelo kernel
   * so.deadline_for. Ausente nas leituras de escrita.
   */
  assigned_workforce_member_id?: string | null;
  assigned_workforce_member_code?: string | null;
  assigned_workforce_member_name?: string | null;
  deadline_at?: string | null;
};

export type ServiceOrderHistoryEventRow = {
  id: string;
  service_order_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor_identity_id: string | null;
  occurred_at: string;
};

export type CreateServiceOrderPersistenceInput = {
  internalCode: string;
  orderNumber: string;
  unitId: string;
  origin: string;
  clientId?: string | null;
  clientSnapshot?: Record<string, unknown> | null;
  serviceDefinitionId?: string | null;
  serviceDefinitionVersionId?: string | null;
  serviceSnapshot: Record<string, unknown>;
  description?: string | null;
  location?: Record<string, unknown>;
  priority?: string | null;
  operationalNotes?: string | null;
  serviceRequestId?: string | null;
  proposalId?: string | null;
  proposalSnapshot?: Record<string, unknown> | null;
  purchaseOrderId?: string | null;
  purchaseOrderSnapshot?: Record<string, unknown> | null;
  rcNumber?: string | null;
  contractId?: string | null;
  contractReference?: string | null;
  contractSnapshot?: Record<string, unknown> | null;
  actorIdentityId: string;
  historyEventType: string;
  historyPayload?: Record<string, unknown>;
};

export type ConvertServiceRequestPersistenceInput = {
  serviceRequestId: string;
  rowVersion: number;
  actorIdentityId: string;
  internalCode: string;
  orderNumber: string;
  clientSnapshot: Record<string, unknown> | null;
  serviceSnapshot: Record<string, unknown>;
  proposalSnapshot: Record<string, unknown> | null;
  purchaseOrderSnapshot: Record<string, unknown> | null;
  rcNumber: string | null;
  contractId?: string | null;
  contractReference?: string | null;
  contractSnapshot?: Record<string, unknown> | null;
};

export type ConvertServiceRequestPersistenceResult =
  | { outcome: 'converted'; serviceOrder: ServiceOrderRow }
  | { outcome: 'version_conflict' }
  | { outcome: 'invalid_state' }
  | { outcome: 'already_converted'; serviceOrderId: string };

export type UpdateServiceOrderPersistenceInput = {
  serviceOrderId: string;
  rowVersion: number;
  actorIdentityId: string;
  description?: string | null;
  location?: Record<string, unknown>;
  priority?: string | null;
  operationalNotes?: string | null;
  clientId?: string | null;
  serviceDefinitionId?: string | null;
  serviceDefinitionVersionId?: string | null;
  serviceSnapshot?: Record<string, unknown>;
  clientSnapshot?: Record<string, unknown> | null;
  proposalId?: string | null;
  proposalSnapshot?: Record<string, unknown> | null;
  purchaseOrderId?: string | null;
  purchaseOrderSnapshot?: Record<string, unknown> | null;
  rcNumber?: string | null;
  contractId?: string | null;
  contractReference?: string | null;
  contractSnapshot?: Record<string, unknown> | null;
};

export type TransitionServiceOrderPersistenceInput = {
  serviceOrderId: string;
  rowVersion: number;
  actorIdentityId: string;
  currentStatus: string;
  nextStatus: string;
  transition:
    | 'prepare'
    | 'release'
    | 'cancel'
    | 'start'
    | 'pause'
    | 'resume'
    | 'complete'
    | 'reopen';
  clientSnapshot?: Record<string, unknown> | null;
  cancellationReason?: string | null;
  reopenReason?: string | null;
};

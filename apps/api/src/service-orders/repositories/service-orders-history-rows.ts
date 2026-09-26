import type { PoolClient } from 'pg';
import type { TransitionServiceOrderPersistenceInput } from './service-orders.repository.types';

export const SERVICE_ORDER_RETURNING = `
  id, internal_code, order_number, unit_id, status::text AS status, origin::text AS origin,
  client_id, client_snapshot, service_definition_id, service_definition_version_id,
  service_snapshot, description, location, priority, operational_notes,
  service_request_id, proposal_id, proposal_snapshot, purchase_order_id, purchase_order_snapshot,
  rc_number, contract_id, contract_reference, contract_snapshot,
  prepared_at, prepared_by_identity_id, released_at, released_by_identity_id,
  cancelled_at, cancelled_by_identity_id, cancellation_reason,
  started_at, started_by_identity_id, paused_at, paused_by_identity_id,
  completed_at, completed_by_identity_id,
  status_before_cancel, reopened_at, reopened_by_identity_id, reopen_reason, status_before_reopen,
  row_version, created_at, updated_at, created_by_identity_id, updated_by_identity_id,
  NULL::uuid AS assigned_identity_id
`;

export const SERVICE_ORDER_SELECT = `
  SELECT
    id, internal_code, order_number, unit_id, status::text AS status, origin::text AS origin,
    client_id, client_snapshot, service_definition_id, service_definition_version_id,
    service_snapshot, description, location, priority, operational_notes,
    service_request_id, proposal_id, proposal_snapshot, purchase_order_id, purchase_order_snapshot,
    rc_number, contract_id, contract_reference, contract_snapshot,
    prepared_at, prepared_by_identity_id, released_at, released_by_identity_id,
    cancelled_at, cancelled_by_identity_id, cancellation_reason,
    started_at, started_by_identity_id, paused_at, paused_by_identity_id,
    completed_at, completed_by_identity_id,
    status_before_cancel, reopened_at, reopened_by_identity_id, reopen_reason, status_before_reopen,
    row_version, created_at, updated_at, created_by_identity_id, updated_by_identity_id,
    (
      SELECT wm.identity_id
      FROM res.resource_allocations ra
      INNER JOIN wrk.workforce_members wm ON wm.id = ra.workforce_member_id
      WHERE ra.service_order_id = so.service_orders.id
        AND ra.status = 'ACTIVE'::res.resource_allocation_status
        AND wm.status = 'ACTIVE'::wrk.workforce_member_status
        AND wm.identity_id IS NOT NULL
      ORDER BY ra.allocated_at ASC, ra.id ASC
      LIMIT 1
    ) AS assigned_identity_id
  FROM so.service_orders
`;

export async function insertServiceOrderHistoryEvent(
  client: PoolClient,
  input: {
    serviceOrderId: string;
    eventType: string;
    payload: Record<string, unknown>;
    actorIdentityId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO so.service_order_history_events (
       service_order_id, event_type, payload, actor_identity_id
     )
     VALUES ($1, $2, $3::jsonb, $4)`,
    [input.serviceOrderId, input.eventType, JSON.stringify(input.payload), input.actorIdentityId],
  );
}

export function buildServiceOrderTransitionFields(input: TransitionServiceOrderPersistenceInput): {
  sql: string;
  params: unknown[];
} {
  switch (input.transition) {
    case 'prepare':
      return {
        sql: 'prepared_at = NOW(), prepared_by_identity_id = $4',
        params: [],
      };
    case 'release':
      return {
        sql: 'released_at = NOW(), released_by_identity_id = $4, client_snapshot = COALESCE($6::jsonb, client_snapshot)',
        params: [input.clientSnapshot ? JSON.stringify(input.clientSnapshot) : null],
      };
    case 'cancel':
      return {
        sql: 'status_before_cancel = $5::so.service_order_status, cancelled_at = NOW(), cancelled_by_identity_id = $4, cancellation_reason = $6',
        params: [input.cancellationReason ?? null],
      };
    case 'start':
      return {
        sql: 'started_at = NOW(), started_by_identity_id = $4, paused_at = NULL, paused_by_identity_id = NULL',
        params: [],
      };
    case 'pause':
      return {
        sql: 'paused_at = NOW(), paused_by_identity_id = $4',
        params: [],
      };
    case 'resume':
      return {
        sql: 'paused_at = NULL, paused_by_identity_id = NULL',
        params: [],
      };
    case 'complete':
      return {
        sql: 'completed_at = NOW(), completed_by_identity_id = $4',
        params: [],
      };
    case 'reopen':
      return {
        sql: 'status_before_reopen = $5::so.service_order_status, reopened_at = NOW(), reopened_by_identity_id = $4, reopen_reason = $6',
        params: [input.reopenReason ?? null],
      };
    default:
      return { sql: '', params: [] };
  }
}

export function historyEventForServiceOrderTransition(
  transition: TransitionServiceOrderPersistenceInput['transition'],
): string {
  switch (transition) {
    case 'prepare':
      return 'PREPARED';
    case 'release':
      return 'RELEASED';
    case 'cancel':
      return 'CANCELLED';
    case 'start':
      return 'STARTED';
    case 'pause':
      return 'PAUSED';
    case 'resume':
      return 'RESUMED';
    case 'complete':
      return 'COMPLETED';
    case 'reopen':
      return 'REOPENED';
    default:
      return transition;
  }
}

import type { Pool } from 'pg';
import type { ServiceOrderListSqlParts } from '../domain/service-order-list.query';
import type { ServiceOrderRow } from './service-orders.repository.types';

export async function listServiceOrders(pool: Pool, 
    parts: ServiceOrderListSqlParts,
    limit: number,
    offset: number,
  ): Promise<ServiceOrderRow[]> {
    const params = [...parts.params, limit, offset];
    const result = await pool.query<ServiceOrderRow>(
      `SELECT
         so.id, so.internal_code, so.order_number, so.unit_id, so.status::text AS status, so.origin::text AS origin,
         so.client_id, so.contract_id, so.client_snapshot, so.service_definition_id, so.service_definition_version_id,
         so.service_snapshot, so.description, so.location, so.priority, so.operational_notes,
         so.service_request_id, so.proposal_id, so.proposal_snapshot, so.purchase_order_id, so.purchase_order_snapshot,
         so.rc_number, so.contract_reference, so.contract_snapshot,
         so.prepared_at, so.prepared_by_identity_id, so.released_at, so.released_by_identity_id,
         so.cancelled_at, so.cancelled_by_identity_id, so.cancellation_reason,
         so.started_at, so.started_by_identity_id, so.paused_at, so.paused_by_identity_id,
         so.completed_at, so.completed_by_identity_id,
         so.status_before_cancel, so.reopened_at, so.reopened_by_identity_id, so.reopen_reason,
         so.status_before_reopen,
         so.row_version, so.created_at, so.updated_at, so.created_by_identity_id, so.updated_by_identity_id,
         (
           SELECT wm.identity_id
           FROM res.resource_allocations ra
           INNER JOIN wrk.workforce_members wm ON wm.id = ra.workforce_member_id
           WHERE ra.service_order_id = so.id
             AND ra.status = 'ACTIVE'::res.resource_allocation_status
             AND wm.status = 'ACTIVE'::wrk.workforce_member_status
             AND wm.identity_id IS NOT NULL
           ORDER BY ra.allocated_at ASC, ra.id ASC
           LIMIT 1
         ) AS assigned_identity_id,
         assigned.workforce_member_id AS assigned_workforce_member_id,
         assigned.member_code AS assigned_workforce_member_code,
         assigned.display_name AS assigned_workforce_member_name,
         so.deadline_for(so.id) AS deadline_at
       FROM ${parts.fromClause}
       LEFT JOIN LATERAL (
         SELECT wm.id AS workforce_member_id, wm.member_code,
                COALESCE(wm.preferred_name, wm.legal_name) AS display_name
         FROM res.resource_allocations ra
         INNER JOIN wrk.workforce_members wm ON wm.id = ra.workforce_member_id
         WHERE ra.service_order_id = so.id
           AND ra.status = 'ACTIVE'::res.resource_allocation_status
           AND wm.status = 'ACTIVE'::wrk.workforce_member_status
         ORDER BY ra.allocated_at ASC, ra.id ASC
         LIMIT 1
       ) assigned ON TRUE
       WHERE ${parts.whereClause}
       ORDER BY ${parts.orderBy}
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );
    return result.rows;
}

export async function countServiceOrders(pool: Pool, parts: ServiceOrderListSqlParts): Promise<number> {
    const result = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM ${parts.fromClause}
       WHERE ${parts.whereClause}`,
      parts.params,
    );
    return Number(result.rows[0]?.total ?? '0');
}

import type { PoolClient } from 'pg';

export const ALLOCATION_RETURNING = `
  id, service_order_id, planned_resource_id, physical_asset_id, workforce_member_id, resource_type_code,
  operational_start, operational_end, status::text AS status, row_version,
  allocated_at, allocated_by_identity_id, removed_at, removed_by_identity_id,
  reallocated_to_allocation_id, created_at, updated_at
`;

export const ALLOCATION_SELECT = `
  SELECT ${ALLOCATION_RETURNING}
  FROM res.resource_allocations
`;

export async function insertResourceAllocationHistory(
  client: PoolClient,
  input: {
    allocationId: string;
    eventType: string;
    payload: Record<string, unknown>;
    actorIdentityId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO res.resource_allocation_history_events (
       resource_allocation_id, event_type, payload, actor_identity_id
     )
     VALUES ($1, $2, $3::jsonb, $4)`,
    [input.allocationId, input.eventType, JSON.stringify(input.payload), input.actorIdentityId],
  );
}

export function isAllocationExclusionViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return (
    pgError.code === '23P01' ||
    pgError.constraint === 'resource_allocations_no_overlap_active_excl' ||
    pgError.constraint === 'resource_allocations_physical_no_overlap_active_excl' ||
    pgError.constraint === 'resource_allocations_workforce_no_overlap_active_excl'
  );
}

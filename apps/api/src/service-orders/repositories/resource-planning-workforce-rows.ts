import type { Pool } from 'pg';
import { ALLOCATION_SELECT } from './resource-planning-allocation-rows';
import type { ResourceAllocationRow } from './resource-planning.repository.types';

/**
 * Raw labor allocation candidates for the owner application service.
 * NEVER expose these rows to a controller: the owning service authorizes BOTH
 * the service order record and allocation before any metadata is serialized.
 */
export async function queryWorkforceAllocationCandidates(
  pool: Pool,
  workforceMemberId: string,
  limit: number,
  offset: number,
): Promise<ResourceAllocationRow[]> {
  const result = await pool.query<ResourceAllocationRow>(
    `${ALLOCATION_SELECT}
     WHERE workforce_member_id = $1
     ORDER BY allocated_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [workforceMemberId, limit, offset],
  );
  return result.rows;
}

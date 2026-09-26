import type { PoolClient } from 'pg';
import {
  ALLOCATION_HISTORY_EVENTS,
  buildAllocationHistoryPayload,
  RESOURCE_ALLOCATION_STATUSES,
} from '../domain/resource-planning';
import { SERVICE_ORDER_HISTORY_EVENTS } from '../domain/service-order';
import type { ResourceAllocationRow } from './resource-planning.repository.types';
import { insertServiceOrderHistoryEvent } from './service-orders-history-rows';

/**
 * Motivo registrado quando a alocacao e liberada pelo cancelamento da OS,
 * e nao por remocao explicita do operador.
 */
export const SERVICE_ORDER_CANCELLED_ALLOCATION_REASON = 'SERVICE_ORDER_CANCELLED';

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

/**
 * Libera as alocacoes ativas de uma OS cancelada. Uma OS cancelada nao pode
 * permanecer com compromisso ativo sobre ativo fisico ou mao de obra: a
 * janela continuaria bloqueando o recurso para outras OS pela exclusao de
 * sobreposicao, e o empregado seguiria atribuido a uma ordem encerrada.
 *
 * Roda no client da transacao do cancelamento e registra os mesmos eventos
 * que a remocao explicita de alocacao, distinguindo o motivo.
 */
export async function releaseActiveAllocationsForServiceOrder(
  client: PoolClient,
  input: { serviceOrderId: string; actorIdentityId: string },
): Promise<ResourceAllocationRow[]> {
  const released = await client.query<ResourceAllocationRow>(
    `UPDATE res.resource_allocations
     SET status = $3::res.resource_allocation_status,
         removed_at = NOW(),
         removed_by_identity_id = $2,
         updated_at = NOW(),
         row_version = row_version + 1
     WHERE service_order_id = $1
       AND status = $4::res.resource_allocation_status
     RETURNING ${ALLOCATION_RETURNING}`,
    [
      input.serviceOrderId,
      input.actorIdentityId,
      RESOURCE_ALLOCATION_STATUSES.Removed,
      RESOURCE_ALLOCATION_STATUSES.Active,
    ],
  );

  for (const allocation of released.rows) {
    const payload = buildAllocationHistoryPayload(
      {
        serviceOrderId: allocation.service_order_id,
        plannedResourceId: allocation.planned_resource_id,
        physicalAssetId: allocation.physical_asset_id,
        workforceMemberId: allocation.workforce_member_id,
        resourceTypeCode: allocation.resource_type_code,
        operationalStart: allocation.operational_start,
        operationalEnd: allocation.operational_end,
      },
      { allocationId: allocation.id, reason: SERVICE_ORDER_CANCELLED_ALLOCATION_REASON },
    );
    await insertResourceAllocationHistory(client, {
      allocationId: allocation.id,
      eventType: ALLOCATION_HISTORY_EVENTS.RemoveAllocation,
      payload,
      actorIdentityId: input.actorIdentityId,
    });
    await insertServiceOrderHistoryEvent(client, {
      serviceOrderId: allocation.service_order_id,
      eventType: SERVICE_ORDER_HISTORY_EVENTS.AllocationRemoved,
      payload,
      actorIdentityId: input.actorIdentityId,
    });
  }

  return released.rows;
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

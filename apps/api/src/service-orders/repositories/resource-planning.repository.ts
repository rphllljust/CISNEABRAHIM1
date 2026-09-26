import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import { OutboxDomainEventWriter } from '../../platform/outbox/services/outbox-domain-event.writer';
import { ASSET_LIFECYCLE_STATUSES } from '../../resources/domain/physical-asset';
import { lockPhysicalAssetForAllocation } from '../../resources/repositories/physical-asset-allocation.persistence';
import {
  ALLOCATION_HISTORY_EVENTS,
  assertAllocationsWithinPlannedWindow,
  assertPlannedOperationalWindow,
  buildAllocationHistoryPayload,
  buildPlannedResourceHistoryPayload,
  collectChangedPlannedResourceFields,
  PLANNED_RESOURCE_STATUSES,
  resolvePlannedOperationalWindow,
  RESOURCE_ALLOCATION_STATUSES,
  SERVICE_ORDER_PLANNING_ALLOWED_STATUSES,
  type PlannedResourceHistorySnapshot,
} from '../domain/resource-planning';
import { SERVICE_ORDER_HISTORY_EVENTS } from '../domain/service-order';
import type {
  AllocateResourcePersistenceInput,
  AllocateResourcePersistenceResult,
  CreatePlannedResourcePersistenceInput,
  PhysicalAssetAllocationContext,
  PlannedResourceRow,
  ReallocateResourcePersistenceInput,
  RemoveAllocationPersistenceInput,
  RemovePlannedResourcePersistenceInput,
  ResourceAllocationHistoryEventRow,
  ResourceAllocationRow,
  UpdatePlannedResourcePersistenceInput,
  WorkforceMemberAllocationContext,
} from './resource-planning.repository.types';
import {
  ALLOCATION_RETURNING,
  ALLOCATION_SELECT,
  insertResourceAllocationHistory,
  isAllocationExclusionViolation,
} from './resource-planning-allocation-rows';
import { insertServiceOrderHistoryEvent } from './service-orders-history-rows';

const PLANNED_SELECT = `
  SELECT
    id, service_order_id, requirement_kind::text AS requirement_kind,
    resource_type_code, labor_type_code, planned_quantity::text AS planned_quantity,
    operational_start, operational_end, notes, status::text AS status,
    row_version, created_at, updated_at, created_by_identity_id, updated_by_identity_id
  FROM so.planned_resources
`;

@Injectable()
export class ResourcePlanningRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly outboxWriter: OutboxDomainEventWriter,
    @Optional() @Inject(FAULT_INJECTION_PORT) private readonly faultInjection?: FaultInjectionPort,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async listPlannedResources(serviceOrderId: string): Promise<PlannedResourceRow[]> {
    const result = await this.pool().query<PlannedResourceRow>(
      `${PLANNED_SELECT}
       WHERE service_order_id = $1 AND status = $2::so.planned_resource_status
       ORDER BY created_at ASC, id ASC`,
      [serviceOrderId, PLANNED_RESOURCE_STATUSES.Planned],
    );
    return result.rows;
  }

  async listAllocations(serviceOrderId: string): Promise<ResourceAllocationRow[]> {
    const result = await this.pool().query<ResourceAllocationRow>(
      `${ALLOCATION_SELECT}
       WHERE service_order_id = $1
       ORDER BY allocated_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  async findPlannedResourceById(
    plannedResourceId: string,
    serviceOrderId: string,
  ): Promise<PlannedResourceRow | null> {
    const result = await this.pool().query<PlannedResourceRow>(
      `${PLANNED_SELECT} WHERE id = $1 AND service_order_id = $2`,
      [plannedResourceId, serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  async findAllocationById(
    allocationId: string,
    serviceOrderId: string,
  ): Promise<ResourceAllocationRow | null> {
    const result = await this.pool().query<ResourceAllocationRow>(
      `${ALLOCATION_SELECT} WHERE id = $1 AND service_order_id = $2`,
      [allocationId, serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  async listAllocationHistory(allocationId: string): Promise<ResourceAllocationHistoryEventRow[]> {
    const result = await this.pool().query<ResourceAllocationHistoryEventRow>(
      `SELECT id, resource_allocation_id, event_type, payload, actor_identity_id, occurred_at
       FROM res.resource_allocation_history_events
       WHERE resource_allocation_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [allocationId],
    );
    return result.rows;
  }

  async createPlannedResource(input: CreatePlannedResourcePersistenceInput): Promise<PlannedResourceRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<PlannedResourceRow>(
        `INSERT INTO so.planned_resources (
           service_order_id, requirement_kind, resource_type_code, labor_type_code,
           planned_quantity, operational_start, operational_end, notes,
           created_by_identity_id, updated_by_identity_id
         )
         VALUES ($1, $2::so.planned_resource_kind, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING
           id, service_order_id, requirement_kind::text AS requirement_kind,
           resource_type_code, labor_type_code, planned_quantity::text AS planned_quantity,
           operational_start, operational_end, notes, status::text AS status,
           row_version, created_at, updated_at, created_by_identity_id, updated_by_identity_id`,
        [
          input.serviceOrderId,
          input.requirementKind,
          input.resourceTypeCode ?? null,
          input.laborTypeCode ?? null,
          input.plannedQuantity,
          input.operationalStart ?? null,
          input.operationalEnd ?? null,
          input.notes ?? null,
          input.actorIdentityId,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('PLANNED_RESOURCE_INSERT_FAILED');
      }
      await insertServiceOrderHistoryEvent(client, {
        serviceOrderId: row.service_order_id,
        eventType: SERVICE_ORDER_HISTORY_EVENTS.PlannedResourceAdded,
        payload: buildPlannedResourceHistoryPayload(toPlannedResourceHistorySnapshot(row), {
          plannedResourceId: row.id,
        }),
        actorIdentityId: input.actorIdentityId,
      });
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePlannedResource(
    input: UpdatePlannedResourcePersistenceInput,
  ): Promise<
    | PlannedResourceRow
    | 'VERSION_CONFLICT'
    | 'INVALID_STATE'
    | 'ALLOCATION_OUTSIDE_WINDOW'
    | 'VALIDATION_FAILED'
  > {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<PlannedResourceRow>(
        `${PLANNED_SELECT} WHERE id = $1 AND service_order_id = $2 FOR UPDATE`,
        [input.plannedResourceId, input.serviceOrderId],
      );
      const current = locked.rows[0];
      if (!current || current.status !== PLANNED_RESOURCE_STATUSES.Planned) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      try {
        const nextWindow = resolvePlannedOperationalWindow(current, input);
        assertPlannedOperationalWindow(nextWindow.start, nextWindow.end);
        const activeAllocations = await client.query<{
          operational_start: string;
          operational_end: string;
        }>(
          `SELECT operational_start, operational_end
           FROM res.resource_allocations
           WHERE planned_resource_id = $1 AND status = $2::res.resource_allocation_status`,
          [input.plannedResourceId, RESOURCE_ALLOCATION_STATUSES.Active],
        );
        assertAllocationsWithinPlannedWindow(
          activeAllocations.rows,
          nextWindow.start,
          nextWindow.end,
        );
      } catch (error) {
        await client.query('ROLLBACK');
        if (error instanceof Error) {
          if (error.message === 'ALLOCATION_OUTSIDE_PLANNED_WINDOW') {
            return 'ALLOCATION_OUTSIDE_WINDOW';
          }
          if (['PLANNED_WINDOW_INCOMPLETE', 'PLANNED_WINDOW_INVALID'].includes(error.message)) {
            return 'VALIDATION_FAILED';
          }
        }
        throw error;
      }

      const result = await client.query<PlannedResourceRow>(
        `UPDATE so.planned_resources
         SET
           planned_quantity = COALESCE($4::numeric, planned_quantity),
           operational_start = CASE WHEN $5::text = '__UNSET__' THEN operational_start ELSE $5::timestamptz END,
           operational_end = CASE WHEN $6::text = '__UNSET__' THEN operational_end ELSE $6::timestamptz END,
           notes = CASE WHEN $7::text = '__UNSET__' THEN notes ELSE $7 END,
           updated_by_identity_id = $3,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1 AND service_order_id = $2 AND row_version = $8
         RETURNING
           id, service_order_id, requirement_kind::text AS requirement_kind,
           resource_type_code, labor_type_code, planned_quantity::text AS planned_quantity,
           operational_start, operational_end, notes, status::text AS status,
           row_version, created_at, updated_at, created_by_identity_id, updated_by_identity_id`,
        [
          input.plannedResourceId,
          input.serviceOrderId,
          input.actorIdentityId,
          input.plannedQuantity ?? null,
          input.operationalStart === undefined ? '__UNSET__' : input.operationalStart,
          input.operationalEnd === undefined ? '__UNSET__' : input.operationalEnd,
          input.notes === undefined ? '__UNSET__' : input.notes,
          input.rowVersion,
        ],
      );
      const updated = result.rows[0];
      if (!updated) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      const changedFields = collectChangedPlannedResourceFields(current, input);
      if (changedFields.length > 0) {
        await insertServiceOrderHistoryEvent(client, {
          serviceOrderId: updated.service_order_id,
          eventType: SERVICE_ORDER_HISTORY_EVENTS.PlannedResourceUpdated,
          payload: buildPlannedResourceHistoryPayload(toPlannedResourceHistorySnapshot(updated), {
            plannedResourceId: updated.id,
            changedFields,
          }),
          actorIdentityId: input.actorIdentityId,
        });
      }
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async removePlannedResource(
    input: RemovePlannedResourcePersistenceInput,
  ): Promise<PlannedResourceRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<PlannedResourceRow>(
        `${PLANNED_SELECT} WHERE id = $1 AND service_order_id = $2 FOR UPDATE`,
        [input.plannedResourceId, input.serviceOrderId],
      );
      const current = locked.rows[0];
      if (!current || current.status !== PLANNED_RESOURCE_STATUSES.Planned) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      const activeAllocations = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM res.resource_allocations
         WHERE planned_resource_id = $1 AND status = $2::res.resource_allocation_status`,
        [input.plannedResourceId, RESOURCE_ALLOCATION_STATUSES.Active],
      );
      if (Number(activeAllocations.rows[0]?.count ?? '0') > 0) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      const result = await client.query<PlannedResourceRow>(
        `UPDATE so.planned_resources
         SET status = $4::so.planned_resource_status,
             updated_by_identity_id = $3,
             updated_at = NOW(),
             row_version = row_version + 1
         WHERE id = $1 AND service_order_id = $2 AND row_version = $5
         RETURNING
           id, service_order_id, requirement_kind::text AS requirement_kind,
           resource_type_code, labor_type_code, planned_quantity::text AS planned_quantity,
           operational_start, operational_end, notes, status::text AS status,
           row_version, created_at, updated_at, created_by_identity_id, updated_by_identity_id`,
        [
          input.plannedResourceId,
          input.serviceOrderId,
          input.actorIdentityId,
          PLANNED_RESOURCE_STATUSES.Removed,
          input.rowVersion,
        ],
      );
      const updated = result.rows[0];
      if (!updated) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      await insertServiceOrderHistoryEvent(client, {
        serviceOrderId: updated.service_order_id,
        eventType: SERVICE_ORDER_HISTORY_EVENTS.PlannedResourceRemoved,
        payload: buildPlannedResourceHistoryPayload(toPlannedResourceHistorySnapshot(updated), {
          plannedResourceId: updated.id,
          status: updated.status,
        }),
        actorIdentityId: input.actorIdentityId,
      });
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async allocateResource(
    input: AllocateResourcePersistenceInput,
  ): Promise<AllocateResourcePersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const orderState = await this.lockPlanningOrderState(client, input.serviceOrderId);
      if (!orderState) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const planned = await client.query<PlannedResourceRow>(
        `${PLANNED_SELECT} WHERE id = $1 AND service_order_id = $2 FOR UPDATE`,
        [input.plannedResourceId, input.serviceOrderId],
      );
      const plannedRow = planned.rows[0];
      if (!plannedRow || plannedRow.status !== PLANNED_RESOURCE_STATUSES.Planned) {
        await client.query('ROLLBACK');
        return { outcome: 'planned_not_found' };
      }
      if (
        plannedRow.requirement_kind !== 'PHYSICAL_RESOURCE' &&
        plannedRow.requirement_kind !== 'LABOR'
      ) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      if (plannedRow.requirement_kind === 'PHYSICAL_RESOURCE') {
        if (!input.physicalAssetId || input.workforceMemberId) {
          await client.query('ROLLBACK');
          return { outcome: 'invalid_state' };
        }
        const asset = await this.lockPhysicalAsset(client, input.physicalAssetId);
        if (!asset) {
          await client.query('ROLLBACK');
          return { outcome: 'asset_not_found' };
        }
        if (asset.lifecycle_status !== ASSET_LIFECYCLE_STATUSES.Active) {
          await client.query('ROLLBACK');
          return { outcome: 'asset_inactive' };
        }
        if (asset.resource_type_code !== input.resourceTypeCode) {
          await client.query('ROLLBACK');
          return { outcome: 'invalid_state' };
        }
      } else {
        if (!input.workforceMemberId || input.physicalAssetId) {
          await client.query('ROLLBACK');
          return { outcome: 'invalid_state' };
        }
        const workforceMember = await this.lockWorkforceMember(client, input.workforceMemberId);
        if (!workforceMember) {
          await client.query('ROLLBACK');
          return { outcome: 'asset_not_found' };
        }
        if (workforceMember.status !== 'ACTIVE') {
          await client.query('ROLLBACK');
          return { outcome: 'asset_inactive' };
        }
        if (workforceMember.default_labor_type_code !== input.resourceTypeCode) {
          await client.query('ROLLBACK');
          return { outcome: 'invalid_state' };
        }
      }

      const inserted = await this.insertAllocation(client, {
        serviceOrderId: input.serviceOrderId,
        plannedResourceId: input.plannedResourceId,
        physicalAssetId: input.physicalAssetId ?? null,
        workforceMemberId: input.workforceMemberId ?? null,
        resourceTypeCode: input.resourceTypeCode,
        operationalStart: input.operationalStart,
        operationalEnd: input.operationalEnd,
        actorIdentityId: input.actorIdentityId,
        historyEventType: ALLOCATION_HISTORY_EVENTS.AllocateResource,
        serviceOrderHistoryEventType: SERVICE_ORDER_HISTORY_EVENTS.ResourceAllocated,
        historyPayload: buildAllocationHistoryPayload({
          serviceOrderId: input.serviceOrderId,
          plannedResourceId: input.plannedResourceId,
          physicalAssetId: input.physicalAssetId ?? null,
          workforceMemberId: input.workforceMemberId ?? null,
          resourceTypeCode: input.resourceTypeCode,
          operationalStart: input.operationalStart,
          operationalEnd: input.operationalEnd,
        }),
      });
      if (!inserted) {
        await client.query('ROLLBACK');
        return { outcome: 'allocation_conflict' };
      }

      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.AllocationAfterInsertBeforeOutbox);
      const order = await client.query<{ unit_id: string }>(
        `SELECT unit_id FROM so.service_orders WHERE id = $1`,
        [input.serviceOrderId],
      );
      await this.outboxWriter.appendServiceOrderAssigned(client, {
        serviceOrderId: input.serviceOrderId,
        unitId: order.rows[0]?.unit_id ?? '',
        allocationId: inserted.id,
        physicalAssetId: inserted.physical_asset_id,
        workforceMemberId: inserted.workforce_member_id,
        resourceTypeCode: inserted.resource_type_code,
        assignedAt: inserted.created_at,
      });

      await client.query('COMMIT');
      return { outcome: 'allocated', allocation: inserted };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isAllocationExclusionViolation(error)) {
        return { outcome: 'allocation_conflict' };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async reallocateResource(
    input: ReallocateResourcePersistenceInput,
  ): Promise<AllocateResourcePersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const orderState = await this.lockPlanningOrderState(client, input.serviceOrderId);
      if (!orderState) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const currentAllocation = await client.query<ResourceAllocationRow>(
        `${ALLOCATION_SELECT} WHERE id = $1 AND service_order_id = $2 FOR UPDATE`,
        [input.allocationId, input.serviceOrderId],
      );
      const current = currentAllocation.rows[0];
      if (!current || current.status !== RESOURCE_ALLOCATION_STATUSES.Active) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }

      const asset = await this.lockPhysicalAsset(client, input.newPhysicalAssetId);
      if (!asset) {
        await client.query('ROLLBACK');
        return { outcome: 'asset_not_found' };
      }
      if (asset.lifecycle_status !== ASSET_LIFECYCLE_STATUSES.Active) {
        await client.query('ROLLBACK');
        return { outcome: 'asset_inactive' };
      }
      if (asset.resource_type_code !== input.resourceTypeCode) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const samePhysicalAsset = input.newPhysicalAssetId === current.physical_asset_id;

      if (samePhysicalAsset) {
        const demoted = await client.query<ResourceAllocationRow>(
          `UPDATE res.resource_allocations
           SET status = $3::res.resource_allocation_status,
               removed_at = NOW(),
               removed_by_identity_id = $4,
               updated_at = NOW(),
               row_version = row_version + 1
           WHERE id = $1 AND service_order_id = $2 AND status = $5::res.resource_allocation_status
           RETURNING ${ALLOCATION_RETURNING}`,
          [
            input.allocationId,
            input.serviceOrderId,
            RESOURCE_ALLOCATION_STATUSES.Reallocated,
            input.actorIdentityId,
            RESOURCE_ALLOCATION_STATUSES.Active,
          ],
        );
        if (!demoted.rows[0]) {
          await client.query('ROLLBACK');
          return { outcome: 'version_conflict' };
        }

        const newAllocation = await this.insertAllocation(client, {
          serviceOrderId: input.serviceOrderId,
          plannedResourceId: current.planned_resource_id,
          physicalAssetId: input.newPhysicalAssetId,
          workforceMemberId: null,
          resourceTypeCode: input.resourceTypeCode,
          operationalStart: input.operationalStart,
          operationalEnd: input.operationalEnd,
          actorIdentityId: input.actorIdentityId,
          historyEventType: ALLOCATION_HISTORY_EVENTS.ReallocateResource,
          serviceOrderHistoryEventType: SERVICE_ORDER_HISTORY_EVENTS.ResourceReallocated,
          historyPayload: buildAllocationHistoryPayload(
            {
              serviceOrderId: input.serviceOrderId,
              plannedResourceId: current.planned_resource_id,
              physicalAssetId: input.newPhysicalAssetId,
              resourceTypeCode: input.resourceTypeCode,
              operationalStart: input.operationalStart,
              operationalEnd: input.operationalEnd,
            },
            { fromAllocationId: input.allocationId },
          ),
        });
        if (!newAllocation) {
          await client.query('ROLLBACK');
          return { outcome: 'allocation_conflict' };
        }

        await client.query(
          `UPDATE res.resource_allocations
           SET reallocated_to_allocation_id = $3, updated_at = NOW()
           WHERE id = $1 AND service_order_id = $2`,
          [input.allocationId, input.serviceOrderId, newAllocation.id],
        );

        await insertResourceAllocationHistory(client, {
          allocationId: input.allocationId,
          eventType: ALLOCATION_HISTORY_EVENTS.ReallocateResource,
          payload: buildAllocationHistoryPayload(
            {
              serviceOrderId: input.serviceOrderId,
              plannedResourceId: current.planned_resource_id,
              physicalAssetId: current.physical_asset_id,
              resourceTypeCode: current.resource_type_code,
              operationalStart: current.operational_start,
              operationalEnd: current.operational_end,
            },
            { toAllocationId: newAllocation.id },
          ),
          actorIdentityId: input.actorIdentityId,
        });

        const order = await client.query<{ unit_id: string }>(
          `SELECT unit_id FROM so.service_orders WHERE id = $1`,
          [input.serviceOrderId],
        );
        await this.outboxWriter.appendServiceOrderAssigned(client, {
          serviceOrderId: input.serviceOrderId,
          unitId: order.rows[0]?.unit_id ?? '',
          allocationId: newAllocation.id,
          physicalAssetId: newAllocation.physical_asset_id,
          resourceTypeCode: newAllocation.resource_type_code,
          assignedAt: newAllocation.created_at,
        });

        await client.query('COMMIT');
        return { outcome: 'allocated', allocation: newAllocation };
      }

      const newAllocation = await this.insertAllocation(client, {
        serviceOrderId: input.serviceOrderId,
        plannedResourceId: current.planned_resource_id,
        physicalAssetId: input.newPhysicalAssetId,
        workforceMemberId: null,
        resourceTypeCode: input.resourceTypeCode,
        operationalStart: input.operationalStart,
        operationalEnd: input.operationalEnd,
        actorIdentityId: input.actorIdentityId,
        historyEventType: ALLOCATION_HISTORY_EVENTS.ReallocateResource,
        serviceOrderHistoryEventType: SERVICE_ORDER_HISTORY_EVENTS.ResourceReallocated,
        historyPayload: buildAllocationHistoryPayload(
          {
            serviceOrderId: input.serviceOrderId,
            plannedResourceId: current.planned_resource_id,
            physicalAssetId: input.newPhysicalAssetId,
            resourceTypeCode: input.resourceTypeCode,
            operationalStart: input.operationalStart,
            operationalEnd: input.operationalEnd,
          },
          { fromAllocationId: input.allocationId },
        ),
      });
      if (!newAllocation) {
        await client.query('ROLLBACK');
        return { outcome: 'allocation_conflict' };
      }

      const replaced = await client.query<ResourceAllocationRow>(
        `UPDATE res.resource_allocations
         SET status = $3::res.resource_allocation_status,
             removed_at = NOW(),
             removed_by_identity_id = $4,
             reallocated_to_allocation_id = $5,
             updated_at = NOW(),
             row_version = row_version + 1
         WHERE id = $1 AND service_order_id = $2 AND status = $6::res.resource_allocation_status
         RETURNING ${ALLOCATION_RETURNING}`,
        [
          input.allocationId,
          input.serviceOrderId,
          RESOURCE_ALLOCATION_STATUSES.Reallocated,
          input.actorIdentityId,
          newAllocation.id,
          RESOURCE_ALLOCATION_STATUSES.Active,
        ],
      );
      if (!replaced.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }

      await insertResourceAllocationHistory(client, {
        allocationId: input.allocationId,
        eventType: ALLOCATION_HISTORY_EVENTS.ReallocateResource,
        payload: buildAllocationHistoryPayload(
          {
            serviceOrderId: input.serviceOrderId,
            plannedResourceId: current.planned_resource_id,
            physicalAssetId: current.physical_asset_id,
            resourceTypeCode: current.resource_type_code,
            operationalStart: current.operational_start,
            operationalEnd: current.operational_end,
          },
          { toAllocationId: newAllocation.id },
        ),
        actorIdentityId: input.actorIdentityId,
      });

      const order = await client.query<{ unit_id: string }>(
        `SELECT unit_id FROM so.service_orders WHERE id = $1`,
        [input.serviceOrderId],
      );
      await this.outboxWriter.appendServiceOrderAssigned(client, {
        serviceOrderId: input.serviceOrderId,
        unitId: order.rows[0]?.unit_id ?? '',
        allocationId: newAllocation.id,
        physicalAssetId: newAllocation.physical_asset_id,
        resourceTypeCode: newAllocation.resource_type_code,
        assignedAt: newAllocation.created_at,
      });

      await client.query('COMMIT');
      return { outcome: 'allocated', allocation: newAllocation };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isAllocationExclusionViolation(error)) {
        return { outcome: 'allocation_conflict' };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async removeAllocation(
    input: RemoveAllocationPersistenceInput,
  ): Promise<ResourceAllocationRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<ResourceAllocationRow>(
        `${ALLOCATION_SELECT} WHERE id = $1 AND service_order_id = $2 FOR UPDATE`,
        [input.allocationId, input.serviceOrderId],
      );
      const current = locked.rows[0];
      if (!current || current.status !== RESOURCE_ALLOCATION_STATUSES.Active) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      const result = await client.query<ResourceAllocationRow>(
        `UPDATE res.resource_allocations
         SET status = $4::res.resource_allocation_status,
             removed_at = NOW(),
             removed_by_identity_id = $3,
             updated_at = NOW(),
             row_version = row_version + 1
         WHERE id = $1 AND service_order_id = $2 AND row_version = $5
         RETURNING ${ALLOCATION_RETURNING}`,
        [
          input.allocationId,
          input.serviceOrderId,
          input.actorIdentityId,
          RESOURCE_ALLOCATION_STATUSES.Removed,
          input.rowVersion,
        ],
      );
      const updated = result.rows[0];
      if (!updated) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      await insertResourceAllocationHistory(client, {
        allocationId: updated.id,
        eventType: ALLOCATION_HISTORY_EVENTS.RemoveAllocation,
        payload: buildAllocationHistoryPayload({
          serviceOrderId: updated.service_order_id,
          plannedResourceId: updated.planned_resource_id,
          physicalAssetId: updated.physical_asset_id,
          resourceTypeCode: updated.resource_type_code,
          operationalStart: updated.operational_start,
          operationalEnd: updated.operational_end,
        }),
        actorIdentityId: input.actorIdentityId,
      });

      await insertServiceOrderHistoryEvent(client, {
        serviceOrderId: updated.service_order_id,
        eventType: SERVICE_ORDER_HISTORY_EVENTS.AllocationRemoved,
        payload: buildAllocationHistoryPayload({
          serviceOrderId: updated.service_order_id,
          plannedResourceId: updated.planned_resource_id,
          physicalAssetId: updated.physical_asset_id,
          workforceMemberId: updated.workforce_member_id,
          resourceTypeCode: updated.resource_type_code,
          operationalStart: updated.operational_start,
          operationalEnd: updated.operational_end,
        }, { allocationId: updated.id }),
        actorIdentityId: input.actorIdentityId,
      });

      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async isAssetAvailable(
    physicalAssetId: string,
    operationalStart: string,
    operationalEnd: string,
    excludeAllocationId?: string,
  ): Promise<boolean> {
    const result = await this.pool().query<{ available: boolean }>(
      `SELECT NOT EXISTS (
         SELECT 1
         FROM res.resource_allocations
         WHERE physical_asset_id = $1
           AND status = $2::res.resource_allocation_status
           AND ($5::uuid IS NULL OR id <> $5::uuid)
           AND operational_period && tstzrange($3::timestamptz, $4::timestamptz, '[)')
       ) AS available`,
      [
        physicalAssetId,
        RESOURCE_ALLOCATION_STATUSES.Active,
        operationalStart,
        operationalEnd,
        excludeAllocationId ?? null,
      ],
    );
    return result.rows[0]?.available === true;
  }

  private async lockPhysicalAsset(
    client: PoolClient,
    assetId: string,
  ): Promise<PhysicalAssetAllocationContext | null> {
    return lockPhysicalAssetForAllocation(client, assetId);
  }

  /**
   * Trava a linha da OS e rele o estado dentro da transacao. A checagem da
   * camada de servico ocorre fora da transacao: sem esta releitura, um
   * cancelamento concorrente poderia efetivar depois dela e a alocacao
   * nasceria ativa sobre uma OS cancelada.
   */
  private async lockPlanningOrderState(
    client: PoolClient,
    serviceOrderId: string,
  ): Promise<string | null> {
    const result = await client.query<{ status: string }>(
      `SELECT status::text AS status
       FROM so.service_orders
       WHERE id = $1
       FOR SHARE`,
      [serviceOrderId],
    );
    const status = result.rows[0]?.status;
    if (!status || !SERVICE_ORDER_PLANNING_ALLOWED_STATUSES.has(status)) {
      return null;
    }
    return status;
  }

  private async lockWorkforceMember(
    client: PoolClient,
    workforceMemberId: string,
  ): Promise<WorkforceMemberAllocationContext | null> {
    const result = await client.query<WorkforceMemberAllocationContext>(
      `SELECT id, member_code, default_labor_type_code, identity_id, status::text AS status
       FROM wrk.workforce_members
       WHERE id = $1
       FOR UPDATE`,
      [workforceMemberId],
    );
    return result.rows[0] ?? null;
  }

  private async insertAllocation(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      plannedResourceId: string | null;
      physicalAssetId: string | null;
      workforceMemberId: string | null;
      resourceTypeCode: string;
      operationalStart: string;
      operationalEnd: string;
      actorIdentityId: string;
      historyEventType: string;
      serviceOrderHistoryEventType: string;
      historyPayload: Record<string, unknown>;
    },
  ): Promise<ResourceAllocationRow | null> {
    try {
      const result = await client.query<ResourceAllocationRow>(
        `INSERT INTO res.resource_allocations (
           service_order_id, planned_resource_id, physical_asset_id, workforce_member_id, resource_type_code,
           operational_start, operational_end, allocated_by_identity_id
         )
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8)
         RETURNING ${ALLOCATION_RETURNING}`,
        [
          input.serviceOrderId,
          input.plannedResourceId,
          input.physicalAssetId,
          input.workforceMemberId,
          input.resourceTypeCode,
          input.operationalStart,
          input.operationalEnd,
          input.actorIdentityId,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      await insertResourceAllocationHistory(client, {
        allocationId: row.id,
        eventType: input.historyEventType,
        payload: input.historyPayload,
        actorIdentityId: input.actorIdentityId,
      });
      await insertServiceOrderHistoryEvent(client, {
        serviceOrderId: row.service_order_id,
        eventType: input.serviceOrderHistoryEventType,
        payload: { ...input.historyPayload, allocationId: row.id },
        actorIdentityId: input.actorIdentityId,
      });
      return row;
    } catch (error) {
      if (isAllocationExclusionViolation(error)) {
        return null;
      }
      throw error;
    }
  }
}

function toPlannedResourceHistorySnapshot(row: PlannedResourceRow): PlannedResourceHistorySnapshot {
  return {
    serviceOrderId: row.service_order_id,
    requirementKind: row.requirement_kind,
    resourceTypeCode: row.resource_type_code,
    laborTypeCode: row.labor_type_code,
    plannedQuantity: row.planned_quantity,
    operationalStart: row.operational_start,
    operationalEnd: row.operational_end,
  };
}

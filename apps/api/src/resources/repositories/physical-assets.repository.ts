import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  queryAssetAllocationUsage,
  queryAssetOccurrences,
} from './physical-asset-operational-lifecycle.persistence';
import { queryIsUnitRegistered } from '../../infrastructure/database/reference-lookups';
import {
  escapeLikeWildcards,
  normalizeSearchQuery,
} from '../../search/domain/search-query-normalizer';
import type { AssetLifecycleStatus } from '../domain/physical-asset';
import type { VehicleProfileInput } from '../dto/physical-assets.dto';
import type {
  PhysicalAssetDetail,
  PhysicalAssetListSummaryCounts,
} from '../serializers/physical-assets-response.serializer';

const ASSET_FROM = `
  FROM ast.physical_assets a
  INNER JOIN cat.physical_resource_types rt ON rt.id = a.physical_resource_type_id
  LEFT JOIN ast.vehicle_profiles vp ON vp.asset_id = a.id
  LEFT JOIN LATERAL (
    SELECT ra.service_order_id, so.order_number
    FROM res.resource_allocations ra
    INNER JOIN so.service_orders so ON so.id = ra.service_order_id
    WHERE ra.physical_asset_id = a.id
      AND ra.status = 'ACTIVE'
    ORDER BY ra.allocated_at DESC
    LIMIT 1
  ) current_alloc ON TRUE
`;

const ASSET_SELECT = `
  SELECT
    a.id,
    a.asset_code,
    a.physical_resource_type_id,
    rt.code AS resource_type_code,
    rt.classification::text AS resource_type_classification,
    a.name,
    a.lifecycle_status,
    a.allocation_status,
    a.unit_id,
    a.version,
    a.created_at,
    a.updated_at,
    a.deactivated_at,
    vp.plate_display,
    vp.chassis,
    vp.model,
    current_alloc.service_order_id AS current_service_order_id,
    current_alloc.order_number AS current_order_number
  ${ASSET_FROM}
`;

const ACTIVE_ALLOCATION_EXISTS_SQL = `
  EXISTS (
    SELECT 1
    FROM res.resource_allocations ra
    WHERE ra.physical_asset_id = a.id
      AND ra.status = 'ACTIVE'::res.resource_allocation_status
  )
`;

export function activeAllocationExistsClause(): string {
  return ACTIVE_ALLOCATION_EXISTS_SQL;
}

function buildSummarySelectSql(): string {
  return [
    'COUNT(*)::int AS total,',
    `COUNT(*) FILTER (
      WHERE a.lifecycle_status = 'ACTIVE'::ast.asset_lifecycle_status
        AND NOT (${ACTIVE_ALLOCATION_EXISTS_SQL})
    )::int AS available,`,
    `COUNT(*) FILTER (
      WHERE ${ACTIVE_ALLOCATION_EXISTS_SQL}
    )::int AS allocated,`,
    `COUNT(*) FILTER (
      WHERE a.lifecycle_status = 'INACTIVE'::ast.asset_lifecycle_status
    )::int AS unavailable`,
  ].join('\n    ');
}

function mapRow(row: Record<string, unknown>): PhysicalAssetDetail {
  const hasVehicle = row['plate_display'] !== null && row['plate_display'] !== undefined;
  const serviceOrderId = row['current_service_order_id'] as string | null | undefined;
  const orderNumber = row['current_order_number'] as string | null | undefined;
  return {
    id: row['id'] as string,
    asset_code: row['asset_code'] as string,
    physical_resource_type_id: row['physical_resource_type_id'] as string,
    resource_type_code: row['resource_type_code'] as string,
    resource_type_classification: row['resource_type_classification'] as string,
    name: row['name'] as string,
    lifecycle_status: row['lifecycle_status'] as PhysicalAssetDetail['lifecycle_status'],
    allocation_status: row['allocation_status'] as PhysicalAssetDetail['allocation_status'],
    unit_id: row['unit_id'] as string,
    version: row['version'] as number,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
    deactivated_at: (row['deactivated_at'] as string | null) ?? null,
    vehicle: hasVehicle
      ? {
          plate_display: row['plate_display'] as string,
          chassis: (row['chassis'] as string | null) ?? null,
          model: (row['model'] as string | null) ?? null,
        }
      : null,
    current_allocation:
      serviceOrderId && orderNumber
        ? {
            service_order_id: serviceOrderId,
            order_number: orderNumber,
          }
        : null,
  };
}

export function appendPhysicalAssetSearchClause(
  search: string,
  params: unknown[],
): string | null {
  const normalized = normalizeSearchQuery(search);
  if (!normalized) {
    return null;
  }

  if (normalized.kind === 'plate') {
    params.push(normalized.term);
    return `vp.normalized_plate = $${params.length}`;
  }

  if (normalized.kind === 'code') {
    params.push(escapeLikeWildcards(normalized.prefixTerm));
    return `a.asset_code ILIKE $${params.length} ESCAPE '\\'`;
  }

  const pattern = `%${escapeLikeWildcards(normalized.term)}%`;
  params.push(pattern);
  return `(
    a.asset_code ILIKE $${params.length} ESCAPE '\\'
    OR a.name ILIKE $${params.length} ESCAPE '\\'
    OR vp.plate_display ILIKE $${params.length} ESCAPE '\\'
  )`;
}

@Injectable()
export class PhysicalAssetsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async isUnitRegistered(unitId: string): Promise<boolean> {
    return queryIsUnitRegistered(this.pool(), unitId);
  }

  /** Utilizacoes do ativo (janela limitada), mais recentes primeiro. */
  async listAllocationUsage(physicalAssetId: string, limit: number) {
    return queryAssetAllocationUsage(this.pool(), physicalAssetId, limit);
  }

  /** Ocorrencias de execucao das OS em que o ativo foi alocado (janela limitada). */
  async listOccurrences(physicalAssetId: string, limit: number) {
    return queryAssetOccurrences(this.pool(), physicalAssetId, limit);
  }

  async findById(assetId: string): Promise<PhysicalAssetDetail | null> {
    const result = await this.pool().query<Record<string, unknown>>(
      `${ASSET_SELECT} WHERE a.id = $1`,
      [assetId],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async list(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<PhysicalAssetDetail[]> {
    const result = await this.pool().query<Record<string, unknown>>(
      `${ASSET_SELECT}
       WHERE ${whereClause}
       ORDER BY a.asset_code ASC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return result.rows.map((row) => mapRow(row));
  }

  async count(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       ${ASSET_FROM}
       WHERE ${whereClause}`,
      params,
    );
    return result.rows[0]?.count ?? 0;
  }

  async countSummary(whereClause: string, params: unknown[]): Promise<PhysicalAssetListSummaryCounts> {
    const result = await this.pool().query<{
      total: number;
      available: number;
      allocated: number;
      unavailable: number;
    }>(
      `SELECT
         ${buildSummarySelectSql()}
       ${ASSET_FROM}
       WHERE ${whereClause}`,
      params,
    );
    const row = result.rows[0];
    return {
      total: row?.total ?? 0,
      available: row?.available ?? 0,
      allocated: row?.allocated ?? 0,
      unavailable: row?.unavailable ?? 0,
    };
  }

  async create(input: {
    assetCode: string;
    resourceTypeId: string;
    name: string;
    unitId: string;
    actorIdentityId: string;
    vehicle?: VehicleProfileInput;
  }): Promise<PhysicalAssetDetail> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO ast.physical_assets (
           asset_code,
           physical_resource_type_id,
           name,
           unit_id,
           created_by_identity_id,
           updated_by_identity_id
         ) VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id`,
        [
          input.assetCode,
          input.resourceTypeId,
          input.name,
          input.unitId,
          input.actorIdentityId,
        ],
      );
      const assetId = insertResult.rows[0]?.id;
      if (!assetId) {
        throw new Error('Failed to create physical asset.');
      }

      if (input.vehicle) {
        await client.query(
          `INSERT INTO ast.vehicle_profiles (
             asset_id, normalized_plate, plate_display, chassis, model
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            assetId,
            input.vehicle.normalizedPlate,
            input.vehicle.plateDisplay,
            input.vehicle.chassis ?? null,
            input.vehicle.model ?? null,
          ],
        );
      }

      await client.query('COMMIT');

      const created = await this.findById(assetId);
      if (!created) {
        throw new Error('Failed to load created physical asset.');
      }
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(input: {
    assetId: string;
    expectedVersion: number;
    name?: string;
    vehicle?: VehicleProfileInput;
    actorIdentityId: string;
    hasVehicleProfile: boolean;
  }): Promise<PhysicalAssetDetail | null | 'VERSION_CONFLICT'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const current = await client.query<{ version: number }>(
        `SELECT version FROM ast.physical_assets WHERE id = $1 FOR UPDATE`,
        [input.assetId],
      );
      const currentRow = current.rows[0];
      if (!currentRow) {
        await client.query('ROLLBACK');
        return null;
      }
      if (currentRow.version !== input.expectedVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      if (input.name !== undefined) {
        await client.query(
          `UPDATE ast.physical_assets
           SET name = $2,
               version = version + 1,
               updated_at = now(),
               updated_by_identity_id = $3
           WHERE id = $1`,
          [input.assetId, input.name, input.actorIdentityId],
        );
      }

      if (input.vehicle !== undefined) {
        if (input.hasVehicleProfile) {
          await client.query(
            `UPDATE ast.vehicle_profiles
             SET normalized_plate = $2,
                 plate_display = $3,
                 chassis = $4,
                 model = $5,
                 updated_at = now()
             WHERE asset_id = $1`,
            [
              input.assetId,
              input.vehicle.normalizedPlate,
              input.vehicle.plateDisplay,
              input.vehicle.chassis ?? null,
              input.vehicle.model ?? null,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO ast.vehicle_profiles (
               asset_id, normalized_plate, plate_display, chassis, model
             ) VALUES ($1, $2, $3, $4, $5)`,
            [
              input.assetId,
              input.vehicle.normalizedPlate,
              input.vehicle.plateDisplay,
              input.vehicle.chassis ?? null,
              input.vehicle.model ?? null,
            ],
          );
        }

        if (input.name === undefined) {
          await client.query(
            `UPDATE ast.physical_assets
             SET version = version + 1,
                 updated_at = now(),
                 updated_by_identity_id = $2
             WHERE id = $1`,
            [input.assetId, input.actorIdentityId],
          );
        }
      }

      await client.query('COMMIT');
      return (await this.findById(input.assetId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setLifecycleStatus(
    assetId: string,
    expectedVersion: number,
    status: AssetLifecycleStatus,
    actorIdentityId: string,
  ): Promise<
    PhysicalAssetDetail | null | 'VERSION_CONFLICT' | 'INVALID_STATE' | 'HAS_ACTIVE_ALLOCATIONS'
  > {
    if (status === 'INACTIVE') {
      const client = await this.pool().connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query<{
          id: string;
          lifecycle_status: AssetLifecycleStatus;
          version: number;
        }>(
          `SELECT id, lifecycle_status::text AS lifecycle_status, version
           FROM ast.physical_assets
           WHERE id = $1
           FOR UPDATE`,
          [assetId],
        );
        const current = locked.rows[0];
        if (!current) {
          await client.query('ROLLBACK');
          return null;
        }
        if (current.version !== expectedVersion) {
          await client.query('ROLLBACK');
          return 'VERSION_CONFLICT';
        }
        if (current.lifecycle_status === status) {
          await client.query('ROLLBACK');
          return 'INVALID_STATE';
        }

        const activeAllocations = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM res.resource_allocations
           WHERE physical_asset_id = $1
             AND status = 'ACTIVE'::res.resource_allocation_status`,
          [assetId],
        );
        if (Number(activeAllocations.rows[0]?.count ?? 0) > 0) {
          await client.query('ROLLBACK');
          return 'HAS_ACTIVE_ALLOCATIONS';
        }

        const result = await client.query(
          `UPDATE ast.physical_assets
           SET lifecycle_status = $3::ast.asset_lifecycle_status,
               version = version + 1,
               updated_at = now(),
               updated_by_identity_id = $4,
               deactivated_at = now(),
               deactivated_by_identity_id = $4
           WHERE id = $1
             AND version = $2`,
          [assetId, expectedVersion, status, actorIdentityId],
        );
        if ((result.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          return 'VERSION_CONFLICT';
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return (await this.findById(assetId))!;
    }

    const current = await this.findById(assetId);
    if (!current) {
      return null;
    }
    if (current.lifecycle_status === status) {
      return 'INVALID_STATE';
    }

    const result = await this.pool().query(
      `UPDATE ast.physical_assets
       SET lifecycle_status = $3::ast.asset_lifecycle_status,
           version = version + 1,
           updated_at = now(),
           updated_by_identity_id = $4,
           deactivated_at = CASE WHEN $3::text = 'INACTIVE' THEN now() ELSE NULL END,
           deactivated_by_identity_id = CASE WHEN $3::text = 'INACTIVE' THEN $4::uuid ELSE NULL END
       WHERE id = $1
         AND version = $2`,
      [assetId, expectedVersion, status, actorIdentityId],
    );

    if ((result.rowCount ?? 0) === 0) {
      const exists = await this.findById(assetId);
      return exists ? 'VERSION_CONFLICT' : null;
    }

    return (await this.findById(assetId))!;
  }
}

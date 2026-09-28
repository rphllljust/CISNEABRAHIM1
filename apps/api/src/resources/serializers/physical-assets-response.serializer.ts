import type {
  AssetAllocationStatus,
  AssetLifecycleStatus,
} from '../domain/physical-asset';
import { resolveAllocationStatusFromCurrentAllocation } from '../domain/physical-asset';

export type VehicleProfileRow = {
  plate_display: string;
  chassis: string | null;
  model: string | null;
};

export type PhysicalAssetRow = {
  id: string;
  asset_code: string;
  physical_resource_type_id: string;
  resource_type_code: string;
  resource_type_classification: string;
  name: string;
  lifecycle_status: AssetLifecycleStatus;
  allocation_status: AssetAllocationStatus;
  unit_id: string;
  version: number;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
};

export type PhysicalAssetCurrentAllocation = {
  service_order_id: string;
  order_number: string;
};

import type { AssetOperationalLifecycle } from '../domain/asset-operational-lifecycle';
export type PhysicalAssetDetail = PhysicalAssetRow & {
  vehicle: VehicleProfileRow | null;
  current_allocation?: PhysicalAssetCurrentAllocation | null;
};

export type PhysicalAssetListSummaryCounts = {
  total: number;
  available: number;
  allocated: number;
  unavailable: number;
};

export type PhysicalAssetResponse = {
  id: string;
  assetCode: string;
  resourceTypeId: string;
  resourceTypeCode: string;
  resourceTypeClassification: string;
  name: string;
  lifecycleStatus: AssetLifecycleStatus;
  allocationStatus: AssetAllocationStatus;
  unitId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  vehicle: {
    plate: string;
    chassis: string | null;
    model: string | null;
  } | null;
  currentAllocation: {
    serviceOrderId: string;
    orderNumber: string;
  } | null;
  /**
   * Vida operacional derivada das alocacoes reais (quem usa, quando, em qual OS) + ocorrencias.
   * Elos negados pelo modulo dono sao omitidos antes de chegar aqui.
   */
  operationalLifecycle?: AssetOperationalLifecycle;
};

export type PhysicalAssetListResponse = {
  items: PhysicalAssetResponse[];
  limit: number;
  offset: number;
  total: number;
};

export type PhysicalAssetListSummaryResponse = {
  total: number;
  available: number;
  allocated: number;
  unavailable: number;
};

export function toPhysicalAssetResponse(
  detail: PhysicalAssetDetail,
  operationalLifecycle?: AssetOperationalLifecycle,
): PhysicalAssetResponse {
  return {
    id: detail.id,
    assetCode: detail.asset_code,
    resourceTypeId: detail.physical_resource_type_id,
    resourceTypeCode: detail.resource_type_code,
    resourceTypeClassification: detail.resource_type_classification,
    name: detail.name,
    lifecycleStatus: detail.lifecycle_status,
    allocationStatus: resolveAllocationStatusFromCurrentAllocation(detail.current_allocation),
    unitId: detail.unit_id,
    version: detail.version,
    createdAt: detail.created_at,
    updatedAt: detail.updated_at,
    deactivatedAt: detail.deactivated_at,
    vehicle: detail.vehicle
      ? {
          plate: detail.vehicle.plate_display,
          chassis: detail.vehicle.chassis,
          model: detail.vehicle.model,
        }
      : null,
    currentAllocation: detail.current_allocation
      ? {
          serviceOrderId: detail.current_allocation.service_order_id,
          orderNumber: detail.current_allocation.order_number,
        }
      : null,
    ...(operationalLifecycle ? { operationalLifecycle } : {}),
  };
}

export function toPhysicalAssetListSummaryResponse(
  counts: PhysicalAssetListSummaryCounts,
): PhysicalAssetListSummaryResponse {
  return {
    total: counts.total,
    available: counts.available,
    allocated: counts.allocated,
    unavailable: counts.unavailable,
  };
}

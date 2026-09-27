export const ASSET_ERROR_CODES = {
  VALIDATION_FAILED: 'ASSET_VALIDATION_FAILED',
  NOT_FOUND: 'ASSET_NOT_FOUND',
  CODE_CONFLICT: 'ASSET_CODE_CONFLICT',
  PLATE_CONFLICT: 'ASSET_PLATE_CONFLICT',
  VERSION_CONFLICT: 'ASSET_VERSION_CONFLICT',
  INVALID_STATE: 'ASSET_INVALID_STATE',
  INACTIVE_RESOURCE_TYPE: 'ASSET_INACTIVE_RESOURCE_TYPE',
  INVALID_RESOURCE_TYPE: 'ASSET_INVALID_RESOURCE_TYPE',
  VEHICLE_PROFILE_REQUIRED: 'ASSET_VEHICLE_PROFILE_REQUIRED',
  VEHICLE_PROFILE_FORBIDDEN: 'ASSET_VEHICLE_PROFILE_FORBIDDEN',
  UNIT_NOT_REGISTERED: 'ASSET_UNIT_NOT_REGISTERED',
  DENIED: 'ASSET_DENIED',
} as const;

export type AssetErrorCode = (typeof ASSET_ERROR_CODES)[keyof typeof ASSET_ERROR_CODES];

export const ASSET_LIFECYCLE_STATUSES = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;

export type AssetLifecycleStatus =
  (typeof ASSET_LIFECYCLE_STATUSES)[keyof typeof ASSET_LIFECYCLE_STATUSES];

export const ASSET_ALLOCATION_STATUSES = {
  Available: 'AVAILABLE',
  Allocated: 'ALLOCATED',
} as const;

export type AssetAllocationStatus =
  (typeof ASSET_ALLOCATION_STATUSES)[keyof typeof ASSET_ALLOCATION_STATUSES];

export const ASSET_OPERATIONAL_AVAILABILITIES = {
  Available: 'AVAILABLE',
  Allocated: 'ALLOCATED',
  Unavailable: 'UNAVAILABLE',
} as const;

export type AssetOperationalAvailability =
  (typeof ASSET_OPERATIONAL_AVAILABILITIES)[keyof typeof ASSET_OPERATIONAL_AVAILABILITIES];

export const VEHICLE_CLASSIFICATION = 'VEHICLE';

export type VehicleProfile = {
  plate: string;
  chassis: string | null;
  model: string | null;
};

export type PhysicalAssetCurrentAllocation = {
  serviceOrderId: string;
  orderNumber: string;
};

export type PhysicalAsset = {
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
  vehicle: VehicleProfile | null;
  currentAllocation: PhysicalAssetCurrentAllocation | null;
  /** Vida operacional derivada pelo backend (uso atual, próxima utilização, histórico, ocorrências). */
  operationalLifecycle?: PhysicalAssetOperationalLifecycle;
};

export type PhysicalAssetListResponse = {
  items: PhysicalAsset[];
  limit: number;
  offset: number;
  total: number;
};

export type PhysicalAssetOperationalLifecycle =
  import('./asset-operational-lifecycle.types').AssetOperationalLifecycle;

export type PhysicalAssetListSummary = {
  total: number;
  available: number;
  allocated: number;
  unavailable: number;
};

export type CreatePhysicalAssetPayload = {
  assetCode: string;
  resourceTypeId: string;
  name: string;
  unitId: string;
  vehicle?: {
    plate: string;
    chassis?: string;
    model?: string;
  };
};

export type UpdatePhysicalAssetPayload = {
  version: number;
  name?: string;
  vehicle?: {
    plate: string;
    chassis?: string;
    model?: string;
  };
};

export type PhysicalResourceTypeOption = {
  id: string;
  code: string;
  name: string;
  classification: string;
  status: string;
};

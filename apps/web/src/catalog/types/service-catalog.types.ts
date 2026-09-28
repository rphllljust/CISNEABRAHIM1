export const CATALOG_LINEAGE_STATUSES = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;

export type CatalogLineageStatus =
  (typeof CATALOG_LINEAGE_STATUSES)[keyof typeof CATALOG_LINEAGE_STATUSES];

export const VERSION_STATUSES = {
  Draft: 'DRAFT',
  Published: 'PUBLISHED',
  Retired: 'RETIRED',
} as const;

export type VersionStatus = (typeof VERSION_STATUSES)[keyof typeof VERSION_STATUSES];

export const REQUIREMENT_LEVELS = ['REQUIRED', 'OPTIONAL', 'CONDITIONAL'] as const;
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

export type AllowedUnitInput = {
  unitCode: string;
  isDefault: boolean;
  sortOrder: number;
};

export type ResourceRequirementInput = {
  resourceTypeCode: string;
  requirementLevel: RequirementLevel;
  minQuantity: number;
  sortOrder: number;
};

export type LaborRequirementInput = {
  laborTypeCode: string;
  requirementLevel: RequirementLevel;
  minQuantity: number;
  sortOrder: number;
};

export type PricingModelInput = {
  modelCode: string;
  unitCode: string | null;
  salePrice: string | null;
  internalCost: string | null;
  currencyCode: string;
  sortOrder: number;
};

export type ExecutionRequirementConfig = {
  schemaVersion?: 1;
  notes?: string;
  conditional?: {
    conditionType: string;
    measurementBasis?: string;
    archetype?: string;
    resourceTypeCode?: string;
    laborTypeCode?: string;
  };
};

export type ExecutionRequirementInput = {
  requirementType: string;
  requirementLevel: RequirementLevel;
  config: ExecutionRequirementConfig | null;
  sortOrder: number;
};

export type ServiceDefinition = {
  id: string;
  code: string;
  /** Nome humano da versao vigente. `null` quando nao ha versao ACTIVE nem DRAFT. */
  name: string | null;
  nameVersion: number | null;
  nameVersionStatus: VersionStatus | null;
  categoryId: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  status: CatalogLineageStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  latestPublishedVersion: number | null;
  currentDraftVersion: number | null;
};

export type ServiceDefinitionListResponse = {
  items: ServiceDefinition[];
  limit: number;
  offset: number;
};

export type ServiceDefinitionVersion = {
  id: string;
  serviceDefinitionId: string;
  code: string;
  version: number;
  status: VersionStatus;
  categoryId: string;
  archetype: string;
  name: string;
  description: string | null;
  defaultUnitCode: string | null;
  measurementMode: string;
  measurementBasis: string;
  billingEntitlementPolicy: string;
  requiresPurchaseOrder: boolean;
  allowedUnits: AllowedUnitInput[];
  resourceRequirements: ResourceRequirementInput[];
  laborRequirements: LaborRequirementInput[];
  pricingModels: PricingModelInput[];
  executionRequirements: ExecutionRequirementInput[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateServiceDefinitionPayload = {
  code: string;
  name: string;
  categoryId: string;
  archetype: string;
  measurementMode: string;
  measurementBasis: string;
  allowedUnits: AllowedUnitInput[];
  pricingModels: PricingModelInput[];
  description?: string | null;
  defaultUnitCode?: string | null;
  billingEntitlementPolicy?: string | null;
  requiresPurchaseOrder?: boolean | null;
  resourceRequirements?: ResourceRequirementInput[];
  laborRequirements?: LaborRequirementInput[];
  executionRequirements?: ExecutionRequirementInput[];
};

export type VersionMutationPayload = {
  name: string;
  categoryId: string;
  archetype: string;
  measurementMode: string;
  measurementBasis: string;
  allowedUnits: AllowedUnitInput[];
  resourceRequirements: ResourceRequirementInput[];
  laborRequirements: LaborRequirementInput[];
  pricingModels: PricingModelInput[];
  executionRequirements: ExecutionRequirementInput[];
  description?: string | null;
  defaultUnitCode?: string | null;
  billingEntitlementPolicy?: string | null;
  requiresPurchaseOrder?: boolean | null;
  sourceVersion?: number;
};

export type UpdateDraftPayload = VersionMutationPayload & {
  lineageVersion: number;
};

export type LineageMutationPayload = {
  lineageVersion: number;
};

export type DeactivateDefinitionPayload = LineageMutationPayload & {
  reason: string;
};

export const CATALOG_ERROR_CODES = {
  DENIED: 'CATALOG_DENIED',
  NOT_FOUND: 'CATALOG_NOT_FOUND',
  VERSION_CONFLICT: 'CATALOG_VERSION_CONFLICT',
  CODE_CONFLICT: 'CATALOG_CODE_CONFLICT',
  INVALID_STATE: 'CATALOG_INVALID_STATE',
  VALIDATION_FAILED: 'CATALOG_VALIDATION_FAILED',
  PUBLISH_INVALID: 'CATALOG_PUBLISH_INVALID',
} as const;

export type CatalogErrorCode = (typeof CATALOG_ERROR_CODES)[keyof typeof CATALOG_ERROR_CODES];

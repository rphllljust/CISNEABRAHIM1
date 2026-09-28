import type { PersistedPricingModelCode } from '../../commercial/domain/pricing-model';
import { commercialCodeFromPersisted } from '../../commercial/domain/pricing-model';
import { formatMoneyAmountForApi } from '../../commercial/domain/money';
import type { LineageStatus, VersionApiStatus, VersionDbStatus } from '../domain/service-catalog-status';
import { toVersionApiStatus } from '../domain/service-catalog-status';

export type ServiceDefinitionRow = {
  id: string;
  code: string;
  status: LineageStatus;
  version: number;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deactivation_reason: string | null;
};

export type ServiceDefinitionVersionRow = {
  id: string;
  service_definition_id: string;
  version: number;
  status: VersionDbStatus;
  category_id: string;
  archetype: string;
  name: string;
  description: string | null;
  default_unit_code: string | null;
  measurement_mode: string;
  measurement_basis: string;
  billing_entitlement_policy: string | null;
  commercial_config: Record<string, unknown> | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AllowedUnitRow = {
  unit_code: string;
  is_default: boolean;
  sort_order: number;
};

export type ResourceRequirementRow = {
  physical_resource_type_code: string;
  requirement_level: 'REQUIRED' | 'OPTIONAL' | 'CONDITIONAL';
  min_quantity: number;
  sort_order: number;
};

export type LaborRequirementRow = {
  labor_type_code: string;
  requirement_level: 'REQUIRED' | 'OPTIONAL' | 'CONDITIONAL';
  min_quantity: number;
  sort_order: number;
};

export type PricingModelRow = {
  pricing_model_code: string;
  config: { commercialCode?: string; unitCode?: string; schemaVersion?: number } | null;
  sale_price_amount: string | null;
  internal_cost_amount: string | null;
  currency_code: string;
  sort_order: number;
};

export type ExecutionRequirementRow = {
  evidence_kind: string;
  requirement_level: 'REQUIRED' | 'OPTIONAL' | 'CONDITIONAL';
  config: {
    schemaVersion?: number;
    conditional?: {
      conditionType: string;
      measurementBasis?: string;
      archetype?: string;
      resourceTypeCode?: string;
      laborTypeCode?: string;
    };
    notes?: string;
  } | null;
  sort_order: number;
};

export type ServiceDefinitionSummary = ServiceDefinitionRow & {
  latest_published_version: number | null;
  current_draft_version: number | null;
  /**
   * Nome humano da versao vigente. `null` quando a definicao nao tem versao ACTIVE nem DRAFT —
   * nesse caso a UI cai no `code`, que e a unica identidade que existe de fato.
   */
  name: string | null;
  name_version_status: VersionDbStatus | null;
  name_version: number | null;
  category_id: string | null;
  category_code: string | null;
  category_name: string | null;
};

export type ServiceDefinitionVersionDetail = ServiceDefinitionVersionRow & {
  code: string;
  allowed_units: AllowedUnitRow[];
  resource_requirements: ResourceRequirementRow[];
  labor_requirements: LaborRequirementRow[];
  pricing_models: PricingModelRow[];
  execution_requirements: ExecutionRequirementRow[];
};

export type ServiceDefinitionResponse = {
  id: string;
  code: string;
  /** Nome humano da versao vigente (ACTIVE; senao DRAFT). Campo ADITIVO. */
  name: string | null;
  /** Versao de onde o `name` veio, para a UI poder dizer qual versao ela esta lendo. */
  nameVersion: number | null;
  nameVersionStatus: VersionApiStatus | null;
  categoryId: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  status: LineageStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  latestPublishedVersion: number | null;
  currentDraftVersion: number | null;
};

export type ServiceDefinitionVersionResponse = {
  id: string;
  serviceDefinitionId: string;
  code: string;
  version: number;
  status: VersionApiStatus;
  categoryId: string;
  archetype: string;
  name: string;
  description: string | null;
  defaultUnitCode: string | null;
  measurementMode: string;
  measurementBasis: string;
  billingEntitlementPolicy: string;
  requiresPurchaseOrder: boolean;
  allowedUnits: Array<{ unitCode: string; isDefault: boolean; sortOrder: number }>;
  resourceRequirements: Array<{
    resourceTypeCode: string;
    requirementLevel: 'REQUIRED' | 'OPTIONAL' | 'CONDITIONAL';
    minQuantity: number;
    sortOrder: number;
  }>;
  laborRequirements: Array<{
    laborTypeCode: string;
    requirementLevel: 'REQUIRED' | 'OPTIONAL' | 'CONDITIONAL';
    minQuantity: number;
    sortOrder: number;
  }>;
  pricingModels: Array<{
    modelCode: string;
    unitCode: string | null;
    salePrice: string | null;
    internalCost: string | null;
    currencyCode: string;
    sortOrder: number;
  }>;
  executionRequirements: Array<{
    requirementType: string;
    requirementLevel: 'REQUIRED' | 'OPTIONAL' | 'CONDITIONAL';
    config: ExecutionRequirementRow['config'];
    sortOrder: number;
  }>;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toServiceDefinitionResponse(row: ServiceDefinitionSummary): ServiceDefinitionResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameVersion: row.name_version,
    nameVersionStatus: row.name_version_status ? toVersionApiStatus(row.name_version_status) : null,
    categoryId: row.category_id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
    deactivationReason: row.deactivation_reason,
    latestPublishedVersion: row.latest_published_version,
    currentDraftVersion: row.current_draft_version,
  };
}

export function toServiceDefinitionVersionResponse(
  row: ServiceDefinitionVersionDetail,
): ServiceDefinitionVersionResponse {
  return {
    id: row.id,
    serviceDefinitionId: row.service_definition_id,
    code: row.code,
    version: row.version,
    status: toVersionApiStatus(row.status),
    categoryId: row.category_id,
    archetype: row.archetype,
    name: row.name,
    description: row.description,
    defaultUnitCode: row.default_unit_code,
    measurementMode: row.measurement_mode,
    measurementBasis: row.measurement_basis,
    billingEntitlementPolicy: row.billing_entitlement_policy ?? 'MEASUREMENT_APPROVED',
    requiresPurchaseOrder: row.commercial_config?.['requiresPurchaseOrder'] === true,
    allowedUnits: row.allowed_units.map((unit) => ({
      unitCode: unit.unit_code,
      isDefault: unit.is_default,
      sortOrder: unit.sort_order,
    })),
    resourceRequirements: row.resource_requirements.map((requirement) => ({
      resourceTypeCode: requirement.physical_resource_type_code,
      requirementLevel: requirement.requirement_level,
      minQuantity: requirement.min_quantity,
      sortOrder: requirement.sort_order,
    })),
    laborRequirements: row.labor_requirements.map((requirement) => ({
      laborTypeCode: requirement.labor_type_code,
      requirementLevel: requirement.requirement_level,
      minQuantity: requirement.min_quantity,
      sortOrder: requirement.sort_order,
    })),
    pricingModels: row.pricing_models.map((model) => {
      const unitCode = model.config?.unitCode ?? null;
      const commercialCode =
        model.config?.commercialCode ??
        commercialCodeFromPersisted(model.pricing_model_code as PersistedPricingModelCode, unitCode);
      return {
        modelCode: commercialCode ?? model.pricing_model_code,
        unitCode,
        salePrice: formatMoneyAmountForApi(model.sale_price_amount),
        internalCost: formatMoneyAmountForApi(model.internal_cost_amount),
        currencyCode: model.currency_code.trim(),
        sortOrder: model.sort_order,
      };
    }),
    executionRequirements: row.execution_requirements.map((requirement) => ({
      requirementType: requirement.evidence_kind,
      requirementLevel: requirement.requirement_level,
      config: requirement.config,
      sortOrder: requirement.sort_order,
    })),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

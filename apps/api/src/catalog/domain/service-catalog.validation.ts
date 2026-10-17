import type { MeasurementMode, OperationalArchetype } from './service-catalog-status';
import { MEASUREMENT_MODES, OPERATIONAL_ARCHETYPES } from './service-catalog-status';
import { isValidUnitCodeFormat, normalizeUnitCode } from './unit-of-measure';
import {
  isValidPhysicalResourceTypeCodeFormat,
  normalizePhysicalResourceTypeCode,
} from '../../resources/domain/physical-resource-type';
import {
  isValidLaborTypeCodeFormat,
  normalizeLaborTypeCode,
} from '../../resources/domain/operational-labor-type';
import {
  assertCommercialConfiguration,
  assertMeasurementBasis,
  assertPricingModels,
  CommercialValidationError,
  type NormalizedPricingModelInput,
  type PricingModelInput,
} from '../../commercial/domain/commercial-compatibility';
import {
  assertExecutionRequirements,
  ExecutionRequirementValidationError,
  type ExecutionRequirementInput,
  type NormalizedExecutionRequirementInput,
} from './execution-requirement';
import { REQUIREMENT_LEVELS, type RequirementLevel } from './requirement-level';

export { REQUIREMENT_LEVELS, type RequirementLevel } from './requirement-level';

export class CatalogValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

export function assertServiceCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!CODE_PATTERN.test(normalized)) {
    throw new CatalogValidationError('INVALID_CODE_FORMAT');
  }
  return normalized;
}

export function assertNonEmptyName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new CatalogValidationError('INVALID_NAME');
  }
  return trimmed;
}

export function assertArchetype(value: string): OperationalArchetype {
  if (!(OPERATIONAL_ARCHETYPES as readonly string[]).includes(value)) {
    throw new CatalogValidationError('INVALID_ARCHETYPE');
  }
  return value as OperationalArchetype;
}

export function assertMeasurementMode(value: string): MeasurementMode {
  if (!(MEASUREMENT_MODES as readonly string[]).includes(value)) {
    throw new CatalogValidationError('INVALID_MEASUREMENT_MODE');
  }
  return value as MeasurementMode;
}

export const BILLING_ENTITLEMENT_POLICIES = [
  'MEASUREMENT_APPROVED',
  'FIXED_PRICE',
  'PERIODIC',
  'MILESTONE',
] as const;

export type BillingEntitlementPolicy =
  (typeof BILLING_ENTITLEMENT_POLICIES)[number];

/** Política de faturamento do serviço (null = usar default MEASUREMENT_APPROVED). */
export function assertBillingEntitlementPolicy(value: unknown): BillingEntitlementPolicy | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !(BILLING_ENTITLEMENT_POLICIES as readonly string[]).includes(value)) {
    throw new CatalogValidationError('INVALID_BILLING_POLICY');
  }
  return value as BillingEntitlementPolicy;
}

/** Exigência de PO parametrizável do serviço (null = usar false). */
export function assertRequiresPurchaseOrderFlag(value: unknown): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'boolean') {
    throw new CatalogValidationError('INVALID_PO_REQUIREMENT_FLAG');
  }
  return value;
}

export function assertUuid(value: string, code = 'INVALID_ID'): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new CatalogValidationError(code);
  }
  return value;
}

export type AllowedUnitInput = {
  unitCode: string;
  isDefault?: boolean;
  sortOrder?: number;
};

export function assertAllowedUnits(units: AllowedUnitInput[]): AllowedUnitInput[] {
  if (units.length === 0) {
    throw new CatalogValidationError('ALLOWED_UNITS_REQUIRED');
  }
  const normalized = units.map((unit, index) => {
    const unitCode = normalizeUnitCode(unit.unitCode);
    if (!isValidUnitCodeFormat(unitCode)) {
      throw new CatalogValidationError('INVALID_UNIT_CODE');
    }
    return {
      unitCode,
      isDefault: unit.isDefault ?? false,
      sortOrder: unit.sortOrder ?? index,
    };
  });
  const codes = new Set<string>();
  for (const unit of normalized) {
    if (codes.has(unit.unitCode)) {
      throw new CatalogValidationError('DUPLICATE_ALLOWED_UNIT');
    }
    codes.add(unit.unitCode);
  }

  const defaultCount = normalized.filter((unit) => unit.isDefault).length;
  if (defaultCount > 1) {
    throw new CatalogValidationError('MULTIPLE_DEFAULT_UNITS');
  }
  return normalized;
}

export function assertDefaultUnitConsistency(
  units: AllowedUnitInput[],
  defaultUnitCode?: string | null,
): string | undefined {
  const markedDefault = units.find((unit) => unit.isDefault)?.unitCode;
  if (!defaultUnitCode) {
    return markedDefault ? normalizeUnitCode(markedDefault) : undefined;
  }

  const normalizedDefault = normalizeUnitCode(defaultUnitCode);
  if (!units.some((unit) => normalizeUnitCode(unit.unitCode) === normalizedDefault)) {
    throw new CatalogValidationError('DEFAULT_UNIT_NOT_ALLOWED');
  }
  if (!markedDefault || normalizeUnitCode(markedDefault) !== normalizedDefault) {
    throw new CatalogValidationError('DEFAULT_UNIT_MISMATCH');
  }
  return normalizedDefault;
}

export type ResourceRequirementInput = {
  resourceTypeCode: string;
  requirementLevel: RequirementLevel;
  minQuantity?: number;
  sortOrder?: number;
};

export function assertResourceRequirements(
  requirements: ResourceRequirementInput[],
): ResourceRequirementInput[] {
  const normalized = requirements.map((requirement, index) => {
    const resourceTypeCode = normalizePhysicalResourceTypeCode(requirement.resourceTypeCode);
    if (!isValidPhysicalResourceTypeCodeFormat(resourceTypeCode)) {
      throw new CatalogValidationError('INVALID_RESOURCE_TYPE_CODE');
    }
    if (!(REQUIREMENT_LEVELS as readonly string[]).includes(requirement.requirementLevel)) {
      throw new CatalogValidationError('INVALID_REQUIREMENT_LEVEL');
    }
    const minQuantity = requirement.minQuantity ?? 1;
    if (!Number.isInteger(minQuantity) || minQuantity < 1) {
      throw new CatalogValidationError('INVALID_MIN_QUANTITY');
    }
    return {
      resourceTypeCode,
      requirementLevel: requirement.requirementLevel,
      minQuantity,
      sortOrder: requirement.sortOrder ?? index,
    };
  });

  const codes = new Set<string>();
  for (const requirement of normalized) {
    if (codes.has(requirement.resourceTypeCode)) {
      throw new CatalogValidationError('DUPLICATE_RESOURCE_TYPE');
    }
    codes.add(requirement.resourceTypeCode);
  }
  return normalized;
}

export type LaborRequirementInput = {
  laborTypeCode: string;
  requirementLevel: RequirementLevel;
  minQuantity?: number;
  sortOrder?: number;
};

export function assertLaborRequirements(requirements: LaborRequirementInput[]): LaborRequirementInput[] {
  const normalized = requirements.map((requirement, index) => {
    const laborTypeCode = normalizeLaborTypeCode(requirement.laborTypeCode);
    if (!isValidLaborTypeCodeFormat(laborTypeCode)) {
      throw new CatalogValidationError('INVALID_LABOR_TYPE_CODE');
    }
    if (!(REQUIREMENT_LEVELS as readonly string[]).includes(requirement.requirementLevel)) {
      throw new CatalogValidationError('INVALID_REQUIREMENT_LEVEL');
    }
    const minQuantity = requirement.minQuantity ?? 1;
    if (!Number.isInteger(minQuantity) || minQuantity < 1) {
      throw new CatalogValidationError('INVALID_MIN_QUANTITY');
    }
    return {
      laborTypeCode,
      requirementLevel: requirement.requirementLevel,
      minQuantity,
      sortOrder: requirement.sortOrder ?? index,
    };
  });

  const codes = new Set<string>();
  for (const requirement of normalized) {
    if (codes.has(requirement.laborTypeCode)) {
      throw new CatalogValidationError('DUPLICATE_LABOR_TYPE');
    }
    codes.add(requirement.laborTypeCode);
  }
  return normalized;
}

export type { ExecutionRequirementInput, NormalizedExecutionRequirementInput };

export function assertExecutionRequirementsCatalog(
  requirements: ExecutionRequirementInput[],
): NormalizedExecutionRequirementInput[] {
  try {
    return assertExecutionRequirements(requirements);
  } catch (error) {
    if (error instanceof ExecutionRequirementValidationError) {
      throw new CatalogValidationError(error.code);
    }
    throw error;
  }
}

export type { PricingModelInput, NormalizedPricingModelInput };
export { assertPricingModels, assertMeasurementBasis };

export function assertCommercialCatalogInput(input: {
  measurementBasis: string;
  measurementMode: MeasurementMode;
  allowedUnits: AllowedUnitInput[];
  pricingModels: PricingModelInput[];
}): {
  measurementBasis: ReturnType<typeof assertMeasurementBasis>;
  pricingModels: NormalizedPricingModelInput[];
} {
  try {
    return assertCommercialConfiguration({
      measurementBasis: input.measurementBasis,
      measurementMode: input.measurementMode,
      allowedUnitCodes: input.allowedUnits.map((unit) => unit.unitCode),
      pricingModels: input.pricingModels,
    });
  } catch (error) {
    if (error instanceof CommercialValidationError) {
      throw new CatalogValidationError(error.code);
    }
    throw error;
  }
}

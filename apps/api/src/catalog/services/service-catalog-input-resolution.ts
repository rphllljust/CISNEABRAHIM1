import { HttpStatus } from '@nestjs/common';
import type { MeasurementMode } from '../domain/service-catalog-status';
import {
  CatalogValidationError,
  assertAllowedUnits,
  assertCommercialCatalogInput,
  assertDefaultUnitConsistency,
  assertExecutionRequirementsCatalog,
  assertUuid,
  type AllowedUnitInput,
} from '../domain/service-catalog.validation';
import type { NormalizedExecutionRequirementInput, ExecutionRequirementInput } from '../domain/execution-requirement';
import { CATALOG_ERROR_CODES } from '../errors/catalog-error-codes';
import { CatalogHttpException } from '../errors/catalog-http.exception';
import { catalogAccessNotFound } from './service-catalog-access.errors';

export function assertValidCatalogDefinitionId(definitionId: string): void {
  try {
    assertUuid(definitionId);
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      throw catalogAccessNotFound();
    }
    throw error;
  }
}

export function resolveAllowedUnitConfiguration(
  allowedUnits: AllowedUnitInput[],
  defaultUnitCode?: string | null,
) {
  try {
    const normalizedUnits = assertAllowedUnits(allowedUnits);
    return {
      allowedUnits: normalizedUnits,
      defaultUnitCode: assertDefaultUnitConsistency(normalizedUnits, defaultUnitCode),
    };
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      const code =
        CATALOG_ERROR_CODES[error.code as keyof typeof CATALOG_ERROR_CODES] ??
        CATALOG_ERROR_CODES.VALIDATION_FAILED;
      throw new CatalogHttpException(HttpStatus.BAD_REQUEST, code, 'Invalid request body.');
    }
    throw error;
  }
}

export function resolveCommercialCatalogAccessInput(input: {
  measurementBasis: string;
  measurementMode: string;
  allowedUnits: Array<{ unitCode: string }>;
  pricingModels: Array<{
    modelCode: string;
    unitCode?: string | null;
    salePrice?: string | null;
    internalCost?: string | null;
    currencyCode?: string;
    sortOrder?: number;
  }>;
}) {
  try {
    return assertCommercialCatalogInput({
      measurementBasis: input.measurementBasis,
      measurementMode: input.measurementMode as MeasurementMode,
      allowedUnits: input.allowedUnits.map((unit, index) => ({
        unitCode: unit.unitCode,
        sortOrder: index,
      })),
      pricingModels: input.pricingModels.map((model) => ({
        modelCode: model.modelCode,
        unitCode: model.unitCode ?? undefined,
        salePrice: model.salePrice ?? undefined,
        internalCost: model.internalCost ?? undefined,
        currencyCode: model.currencyCode,
        sortOrder: model.sortOrder,
      })),
    });
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      const code =
        CATALOG_ERROR_CODES[error.code as keyof typeof CATALOG_ERROR_CODES] ??
        CATALOG_ERROR_CODES.VALIDATION_FAILED;
      throw new CatalogHttpException(HttpStatus.BAD_REQUEST, code, 'Invalid request body.');
    }
    throw error;
  }
}

export function resolveExecutionRequirementsCatalogAccess(
  requirements: ExecutionRequirementInput[] | undefined,
  sourceVersion?: number,
): NormalizedExecutionRequirementInput[] {
  if ((requirements?.length ?? 0) === 0 && sourceVersion !== undefined) {
    return [];
  }
  try {
    return assertExecutionRequirementsCatalog(requirements ?? []);
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      const code =
        CATALOG_ERROR_CODES[error.code as keyof typeof CATALOG_ERROR_CODES] ??
        CATALOG_ERROR_CODES.VALIDATION_FAILED;
      throw new CatalogHttpException(HttpStatus.BAD_REQUEST, code, 'Invalid request body.');
    }
    throw error;
  }
}

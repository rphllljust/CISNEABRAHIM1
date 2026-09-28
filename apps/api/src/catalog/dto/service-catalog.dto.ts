import { HttpStatus } from '@nestjs/common';
import { parseQueryPositiveInt } from '../../infrastructure/http/contracts';
import { CATALOG_ERROR_CODES } from '../errors/catalog-error-codes';
import { CatalogHttpException } from '../errors/catalog-http.exception';
import {
  assertAllowedUnits,
  assertArchetype,
  assertBillingEntitlementPolicy,
  assertMeasurementMode,
  assertNonEmptyName,
  assertLaborRequirements,
  assertRequiresPurchaseOrderFlag,
  assertResourceRequirements,
  assertCommercialCatalogInput,
  assertExecutionRequirementsCatalog,
  assertServiceCode,
  assertUuid,
  CatalogValidationError,
  type AllowedUnitInput,
  type ExecutionRequirementInput,
  type NormalizedExecutionRequirementInput,
  type LaborRequirementInput,
  type PricingModelInput,
  type NormalizedPricingModelInput,
  type ResourceRequirementInput,
} from '../domain/service-catalog.validation';
import { LINEAGE_STATUSES, type LineageStatus } from '../domain/service-catalog-status';
import type { MeasurementMode } from '../domain/service-catalog-status';
import { assertNoPrivilegedFields } from '../../security/domain/forbidden-payload-fields';

function assertObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return value as Record<string, unknown>;
}

function parseRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return value;
}

function parseOptionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return value;
}

function parsePositiveInt(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      `Invalid ${field}.`,
    );
  }
  return parsed;
}

function parseAllowedUnits(body: Record<string, unknown>): AllowedUnitInput[] {
  const raw = body['allowedUnits'];
  if (!Array.isArray(raw)) {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    const record = item as Record<string, unknown>;
    return {
      unitCode: parseRequiredString(record, 'unitCode'),
      isDefault: record['isDefault'] === true,
      sortOrder:
        record['sortOrder'] === undefined ? undefined : parsePositiveInt(record['sortOrder'], 'sortOrder'),
    };
  });
}

function parseResourceRequirements(
  body: Record<string, unknown>,
  required = false,
): ResourceRequirementInput[] {
  const raw = body['resourceRequirements'];
  if (raw === undefined) {
    if (required) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    const record = item as Record<string, unknown>;
    return {
      resourceTypeCode: parseRequiredString(record, 'resourceTypeCode'),
      requirementLevel: parseRequiredString(record, 'requirementLevel') as ResourceRequirementInput['requirementLevel'],
      minQuantity:
        record['minQuantity'] === undefined
          ? undefined
          : parsePositiveInt(record['minQuantity'], 'minQuantity'),
      sortOrder:
        record['sortOrder'] === undefined ? undefined : parsePositiveInt(record['sortOrder'], 'sortOrder'),
    };
  });
}

function parseLaborRequirements(
  body: Record<string, unknown>,
  required = false,
): LaborRequirementInput[] {
  const raw = body['laborRequirements'];
  if (raw === undefined) {
    if (required) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    const record = item as Record<string, unknown>;
    return {
      laborTypeCode: parseRequiredString(record, 'laborTypeCode'),
      requirementLevel: parseRequiredString(record, 'requirementLevel') as LaborRequirementInput['requirementLevel'],
      minQuantity:
        record['minQuantity'] === undefined
          ? undefined
          : parsePositiveInt(record['minQuantity'], 'minQuantity'),
      sortOrder:
        record['sortOrder'] === undefined ? undefined : parsePositiveInt(record['sortOrder'], 'sortOrder'),
    };
  });
}

function parseExecutionRequirements(
  body: Record<string, unknown>,
  required = false,
): ExecutionRequirementInput[] {
  const raw = body['executionRequirements'];
  if (raw === undefined) {
    if (required) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    const record = item as Record<string, unknown>;
    const config = record['config'];
    return {
      requirementType: parseRequiredString(record, 'requirementType'),
      requirementLevel: parseRequiredString(record, 'requirementLevel') as ExecutionRequirementInput['requirementLevel'],
      config:
        config === undefined || config === null
          ? undefined
          : (config as ExecutionRequirementInput['config']),
      sortOrder:
        record['sortOrder'] === undefined ? undefined : parsePositiveInt(record['sortOrder'], 'sortOrder'),
    };
  });
}

function normalizeExecutionRequirements(
  requirements: ExecutionRequirementInput[],
): NormalizedExecutionRequirementInput[] {
  try {
    return assertExecutionRequirementsCatalog(requirements);
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      raiseCatalogValidation(error);
    }
    throw error;
  }
}

function raiseCatalogValidation(error: CatalogValidationError): never {
  const code =
    CATALOG_ERROR_CODES[error.code as keyof typeof CATALOG_ERROR_CODES] ??
    CATALOG_ERROR_CODES.VALIDATION_FAILED;
  throw new CatalogHttpException(HttpStatus.BAD_REQUEST, code, 'Invalid request body.');
}

function parsePricingModels(body: Record<string, unknown>, required = false): PricingModelInput[] {
  const raw = body['pricingModels'];
  if (raw === undefined) {
    if (required) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    const record = item as Record<string, unknown>;
    const salePrice = record['salePrice'];
    const internalCost = record['internalCost'];
    return {
      modelCode: parseRequiredString(record, 'modelCode'),
      unitCode: parseOptionalString(record, 'unitCode'),
      salePrice:
        salePrice === undefined || salePrice === null
          ? undefined
          : typeof salePrice === 'number'
            ? (() => {
                throw new CatalogHttpException(
                  HttpStatus.BAD_REQUEST,
                  CATALOG_ERROR_CODES.INVALID_MONEY_AMOUNT,
                  'Invalid request body.',
                );
              })()
            : parseRequiredString(record, 'salePrice'),
      internalCost:
        internalCost === undefined || internalCost === null
          ? undefined
          : typeof internalCost === 'number'
            ? (() => {
                throw new CatalogHttpException(
                  HttpStatus.BAD_REQUEST,
                  CATALOG_ERROR_CODES.INVALID_MONEY_AMOUNT,
                  'Invalid request body.',
                );
              })()
            : parseRequiredString(record, 'internalCost'),
      currencyCode: parseOptionalString(record, 'currencyCode'),
      sortOrder:
        record['sortOrder'] === undefined ? undefined : parsePositiveInt(record['sortOrder'], 'sortOrder'),
    };
  });
}

function parseMeasurementBasis(body: Record<string, unknown>): string {
  return parseRequiredString(body, 'measurementBasis').trim().toUpperCase();
}

function validateCommercialFields(
  measurementBasis: string,
  measurementMode: MeasurementMode,
  allowedUnits: AllowedUnitInput[],
  pricingModels: PricingModelInput[],
): NormalizedPricingModelInput[] {
  try {
    const result = assertCommercialCatalogInput({
      measurementBasis,
      measurementMode,
      allowedUnits,
      pricingModels,
    });
    return result.pricingModels;
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      raiseCatalogValidation(error);
    }
    throw error;
  }
}

export type CreateServiceDefinitionInput = {
  code: string;
  name: string;
  categoryId: string;
  archetype: string;
  measurementMode: string;
  measurementBasis: string;
  description?: string;
  defaultUnitCode?: string;
  allowedUnits: AllowedUnitInput[];
  resourceRequirements?: ResourceRequirementInput[];
  laborRequirements?: LaborRequirementInput[];
  pricingModels: PricingModelInput[];
  executionRequirements?: ExecutionRequirementInput[];
  billingEntitlementPolicy?: string | null;
  requiresPurchaseOrder?: boolean | null;
};

export function parseCreateServiceDefinitionInput(body: unknown): CreateServiceDefinitionInput {
  const record = assertObject(body);
  assertNoPrivilegedFields(record);
  const allowedUnits = parseAllowedUnits(record);
  const resourceRequirements = parseResourceRequirements(record);
  const laborRequirements = parseLaborRequirements(record);
  const executionRequirements = normalizeExecutionRequirements(parseExecutionRequirements(record));
  const measurementMode = assertMeasurementMode(parseRequiredString(record, 'measurementMode'));
  const measurementBasis = parseMeasurementBasis(record);
  const pricingModels = validateCommercialFields(
    measurementBasis,
    measurementMode,
    assertAllowedUnits(allowedUnits),
    parsePricingModels(record, true),
  );
  return {
    code: assertServiceCode(parseRequiredString(record, 'code')),
    name: assertNonEmptyName(parseRequiredString(record, 'name')),
    categoryId: assertUuid(parseRequiredString(record, 'categoryId'), 'INVALID_CATEGORY_ID'),
    archetype: assertArchetype(parseRequiredString(record, 'archetype')),
    measurementMode,
    measurementBasis,
    description: parseOptionalString(record, 'description'),
    defaultUnitCode: parseOptionalString(record, 'defaultUnitCode'),
    allowedUnits: assertAllowedUnits(allowedUnits),
    resourceRequirements: assertResourceRequirements(resourceRequirements),
    laborRequirements: assertLaborRequirements(laborRequirements),
    pricingModels,
    executionRequirements,
    billingEntitlementPolicy: assertBillingEntitlementPolicy(record['billingEntitlementPolicy']),
    requiresPurchaseOrder: assertRequiresPurchaseOrderFlag(record['requiresPurchaseOrder']),
  };
}

export type CreateServiceDefinitionVersionInput = {
  name: string;
  categoryId: string;
  archetype: string;
  measurementMode: string;
  measurementBasis: string;
  description?: string;
  defaultUnitCode?: string;
  allowedUnits: AllowedUnitInput[];
  resourceRequirements: ResourceRequirementInput[];
  laborRequirements: LaborRequirementInput[];
  pricingModels: PricingModelInput[];
  executionRequirements: ExecutionRequirementInput[];
  sourceVersion?: number;
  billingEntitlementPolicy?: string | null;
  requiresPurchaseOrder?: boolean | null;
};

export function parseCreateServiceDefinitionVersionInput(
  body: unknown,
): CreateServiceDefinitionVersionInput {
  const record = assertObject(body);
  const allowedUnits = parseAllowedUnits(record);
  const resourceRequirements = parseResourceRequirements(record, true);
  const laborRequirements = parseLaborRequirements(record, true);
  const executionRequirements = normalizeExecutionRequirements(parseExecutionRequirements(record, true));
  const measurementMode = assertMeasurementMode(parseRequiredString(record, 'measurementMode'));
  const measurementBasis = parseMeasurementBasis(record);
  const pricingModels = validateCommercialFields(
    measurementBasis,
    measurementMode,
    assertAllowedUnits(allowedUnits),
    parsePricingModels(record, true),
  );
  const sourceVersionRaw = record['sourceVersion'];
  return {
    name: assertNonEmptyName(parseRequiredString(record, 'name')),
    categoryId: assertUuid(parseRequiredString(record, 'categoryId'), 'INVALID_CATEGORY_ID'),
    archetype: assertArchetype(parseRequiredString(record, 'archetype')),
    measurementMode,
    measurementBasis,
    description: parseOptionalString(record, 'description'),
    defaultUnitCode: parseOptionalString(record, 'defaultUnitCode'),
    allowedUnits: assertAllowedUnits(allowedUnits),
    resourceRequirements: assertResourceRequirements(resourceRequirements),
    laborRequirements: assertLaborRequirements(laborRequirements),
    pricingModels,
    executionRequirements,
    billingEntitlementPolicy: assertBillingEntitlementPolicy(record['billingEntitlementPolicy']),
    requiresPurchaseOrder: assertRequiresPurchaseOrderFlag(record['requiresPurchaseOrder']),
    sourceVersion:
      sourceVersionRaw === undefined ? undefined : parsePositiveInt(sourceVersionRaw, 'sourceVersion'),
  };
}

export type UpdateDraftServiceDefinitionInput = {
  lineageVersion: number;
  name: string;
  categoryId: string;
  archetype: string;
  measurementMode: string;
  measurementBasis: string;
  description?: string | null;
  defaultUnitCode?: string | null;
  allowedUnits: AllowedUnitInput[];
  resourceRequirements?: ResourceRequirementInput[];
  laborRequirements?: LaborRequirementInput[];
  pricingModels: PricingModelInput[];
  executionRequirements: ExecutionRequirementInput[];
  billingEntitlementPolicy?: string | null;
  requiresPurchaseOrder?: boolean | null;
};

export function parseUpdateDraftServiceDefinitionInput(
  body: unknown,
): UpdateDraftServiceDefinitionInput {
  const record = assertObject(body);
  const allowedUnits = parseAllowedUnits(record);
  const resourceRequirements = parseResourceRequirements(record, true);
  const laborRequirements = parseLaborRequirements(record, true);
  const executionRequirements = normalizeExecutionRequirements(parseExecutionRequirements(record, true));
  const measurementMode = assertMeasurementMode(parseRequiredString(record, 'measurementMode'));
  const measurementBasis = parseMeasurementBasis(record);
  const pricingModels = validateCommercialFields(
    measurementBasis,
    measurementMode,
    assertAllowedUnits(allowedUnits),
    parsePricingModels(record, true),
  );
  const description = record['description'];
  const defaultUnitCode = record['defaultUnitCode'];
  return {
    lineageVersion: parsePositiveInt(record['lineageVersion'], 'lineageVersion'),
    name: assertNonEmptyName(parseRequiredString(record, 'name')),
    categoryId: assertUuid(parseRequiredString(record, 'categoryId'), 'INVALID_CATEGORY_ID'),
    archetype: assertArchetype(parseRequiredString(record, 'archetype')),
    measurementMode,
    measurementBasis,
    description:
      description === undefined ? undefined : description === null ? null : parseRequiredString(record, 'description'),
    defaultUnitCode:
      defaultUnitCode === undefined
        ? undefined
        : defaultUnitCode === null
          ? null
          : parseRequiredString(record, 'defaultUnitCode'),
    allowedUnits: assertAllowedUnits(allowedUnits),
    resourceRequirements: assertResourceRequirements(resourceRequirements),
    laborRequirements: assertLaborRequirements(laborRequirements),
    pricingModels,
    executionRequirements,
    billingEntitlementPolicy: assertBillingEntitlementPolicy(record['billingEntitlementPolicy']),
    requiresPurchaseOrder: assertRequiresPurchaseOrderFlag(record['requiresPurchaseOrder']),
  };
}

export function parseLineageTransitionInput(body: unknown): { lineageVersion: number } {
  const record = assertObject(body);
  return { lineageVersion: parsePositiveInt(record['lineageVersion'], 'lineageVersion') };
}

export function parseDeactivateServiceDefinitionInput(
  body: unknown,
): { lineageVersion: number; reason: string } {
  const record = assertObject(body);
  const reason = parseRequiredString(record, 'reason').trim();
  if (reason.length === 0) {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return {
    lineageVersion: parsePositiveInt(record['lineageVersion'], 'lineageVersion'),
    reason,
  };
}

export function parseListServiceDefinitionsQuery(query: Record<string, unknown>): {
  limit: number;
  offset: number;
  status?: LineageStatus;
  search?: string;
} {
  const limitRaw = query['limit'];
  const offsetRaw = query['offset'];
  const statusRaw = query['status'];
  const searchRaw = query['q'];

  let limit = 20;
  if (limitRaw !== undefined) {
    const parsed = parseQueryPositiveInt(limitRaw);
    if (parsed === null || parsed < 1 || parsed > 100) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid query parameters.',
      );
    }
    limit = parsed;
  }

  let offset = 0;
  if (offsetRaw !== undefined) {
    const parsed = parseQueryPositiveInt(offsetRaw);
    if (parsed === null || parsed < 0) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid query parameters.',
      );
    }
    offset = parsed;
  }

  let status: LineageStatus | undefined;
  if (statusRaw !== undefined) {
    if (statusRaw !== LINEAGE_STATUSES.Active && statusRaw !== LINEAGE_STATUSES.Inactive) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid query parameters.',
      );
    }
    status = statusRaw;
  }

  return { limit, offset, status, search: parseCatalogSearchQuery(searchRaw) };
}

/**
 * Busca do catalogo: NOME do servico ou CODE operacional.
 *
 * O `q` e TEXTO do operador, nunca padrao: `%`, `_` e `\` sao escapados antes de virar `ILIKE`.
 * CNAE nao entra aqui — o catalogo nao projeta CNAE em coluna propria e inventar essa busca
 * exigiria uma consulta nova so para isso.
 */
function parseCatalogSearchQuery(raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new CatalogHttpException(
      HttpStatus.BAD_REQUEST,
      CATALOG_ERROR_CODES.VALIDATION_FAILED,
      'Invalid query parameters.',
    );
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Escapa curingas de LIKE — o que o operador digita e texto, nao padrao. */
export function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function parseVersionNumberParam(value: string): number {
  return parsePositiveInt(value, 'version');
}

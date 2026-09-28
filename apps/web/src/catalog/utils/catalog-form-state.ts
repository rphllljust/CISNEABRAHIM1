import type {
  AllowedUnitInput,
  CreateServiceDefinitionPayload,
  ExecutionRequirementInput,
  LaborRequirementInput,
  PricingModelInput,
  ResourceRequirementInput,
  ServiceDefinitionVersion,
  UpdateDraftPayload,
  VersionMutationPayload,
} from '../types/service-catalog.types';

export type ServiceDefinitionFormState = {
  code: string;
  name: string;
  description: string;
  categoryId: string;
  archetype: string;
  measurementMode: string;
  measurementBasis: string;
  billingEntitlementPolicy: string;
  requiresPurchaseOrder: boolean;
  defaultUnitCode: string;
  allowedUnits: AllowedUnitInput[];
  pricingModels: PricingModelInput[];
  resourceRequirements: ResourceRequirementInput[];
  laborRequirements: LaborRequirementInput[];
  executionRequirements: ExecutionRequirementInput[];
};

export function createEmptyFormState(): ServiceDefinitionFormState {
  return {
    code: '',
    name: '',
    description: '',
    categoryId: '',
    archetype: 'RENTAL',
    measurementMode: 'BY_PERIOD',
    measurementBasis: 'TIME',
    billingEntitlementPolicy: 'MEASUREMENT_APPROVED',
    requiresPurchaseOrder: false,
    defaultUnitCode: '',
    allowedUnits: [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }],
    pricingModels: [
      {
        modelCode: 'DAILY',
        unitCode: 'DAY',
        salePrice: null,
        internalCost: null,
        currencyCode: 'BRL',
        sortOrder: 0,
      },
    ],
    resourceRequirements: [],
    laborRequirements: [],
    executionRequirements: [],
  };
}

export function formStateFromVersion(version: ServiceDefinitionVersion): ServiceDefinitionFormState {
  return {
    code: version.code,
    name: version.name,
    description: version.description ?? '',
    categoryId: version.categoryId,
    archetype: version.archetype,
    measurementMode: version.measurementMode,
    measurementBasis: version.measurementBasis,
    billingEntitlementPolicy: version.billingEntitlementPolicy ?? 'MEASUREMENT_APPROVED',
    requiresPurchaseOrder: version.requiresPurchaseOrder ?? false,
    defaultUnitCode: version.defaultUnitCode ?? '',
    allowedUnits: version.allowedUnits.map((unit, index) => ({
      ...unit,
      sortOrder: unit.sortOrder ?? index,
    })),
    pricingModels: version.pricingModels.map((model, index) => ({
      ...model,
      sortOrder: model.sortOrder ?? index,
    })),
    resourceRequirements: version.resourceRequirements.map((item, index) => ({
      ...item,
      sortOrder: item.sortOrder ?? index,
    })),
    laborRequirements: version.laborRequirements.map((item, index) => ({
      ...item,
      sortOrder: item.sortOrder ?? index,
    })),
    executionRequirements: version.executionRequirements.map((item, index) => ({
      ...item,
      sortOrder: item.sortOrder ?? index,
    })),
  };
}

export function toCreatePayload(state: ServiceDefinitionFormState): CreateServiceDefinitionPayload {
  return {
    code: state.code.trim().toUpperCase(),
    name: state.name.trim(),
    categoryId: state.categoryId.trim(),
    archetype: state.archetype,
    measurementMode: state.measurementMode,
    measurementBasis: state.measurementBasis,
    billingEntitlementPolicy: state.billingEntitlementPolicy,
    requiresPurchaseOrder: state.requiresPurchaseOrder,
    description: state.description.trim() || null,
    defaultUnitCode: state.defaultUnitCode.trim() || null,
    allowedUnits: state.allowedUnits,
    pricingModels: state.pricingModels.map((model) => ({
      ...model,
      salePrice: model.salePrice?.trim() || null,
      internalCost: model.internalCost?.trim() || null,
    })),
    resourceRequirements: state.resourceRequirements,
    laborRequirements: state.laborRequirements,
    executionRequirements: state.executionRequirements,
  };
}

export function toVersionMutationPayload(state: ServiceDefinitionFormState): VersionMutationPayload {
  const create = toCreatePayload(state);
  const { code: _code, ...rest } = create;
  return {
    ...rest,
    resourceRequirements: rest.resourceRequirements ?? [],
    laborRequirements: rest.laborRequirements ?? [],
    executionRequirements: rest.executionRequirements ?? [],
  };
}

export function toUpdateDraftPayload(
  state: ServiceDefinitionFormState,
  lineageVersion: number,
): UpdateDraftPayload {
  return {
    ...toVersionMutationPayload(state),
    lineageVersion,
  };
}

export type ServiceDefinitionFormErrors = Partial<Record<keyof ServiceDefinitionFormState, string>>;

export function validateServiceDefinitionForm(
  state: ServiceDefinitionFormState,
  options: { includeCode: boolean },
): ServiceDefinitionFormErrors {
  const errors: ServiceDefinitionFormErrors = {};
  if (options.includeCode && !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(state.code.trim().toUpperCase())) {
    errors.code = 'Informe um código válido (A-Z, 0-9, _, -).';
  }
  if (!state.name.trim()) {
    errors.name = 'Nome é obrigatório.';
  }
  if (!state.categoryId.trim()) {
    errors.categoryId = 'Categoria é obrigatória.';
  }
  if (state.allowedUnits.length === 0) {
    errors.allowedUnits = 'Informe ao menos uma unidade permitida.';
  }
  if (state.pricingModels.length === 0) {
    errors.pricingModels = 'Informe ao menos um modelo de preço.';
  }
  return errors;
}

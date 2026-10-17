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
    archetype: '',
    measurementMode: '',
    measurementBasis: '',
    billingEntitlementPolicy: '',
    requiresPurchaseOrder: false,
    defaultUnitCode: '',
    allowedUnits: [],
    pricingModels: [],
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
  if (!state.archetype.trim()) {
    errors.archetype = 'Arquétipo operacional é obrigatório.';
  }
  if (!state.measurementMode.trim()) {
    errors.measurementMode = 'Modo de medição é obrigatório.';
  }
  if (!state.measurementBasis.trim()) {
    errors.measurementBasis = 'Base de medição é obrigatória.';
  }

  if (state.allowedUnits.length === 0) {
    errors.allowedUnits = 'Informe ao menos uma unidade permitida.';
  } else {
    const unitCodes = state.allowedUnits.map((unit) => unit.unitCode.trim()).filter(Boolean);
    if (new Set(unitCodes).size !== unitCodes.length) {
      errors.allowedUnits = 'A mesma unidade não pode ser adicionada duas vezes.';
    } else {
      const markedDefaults = state.allowedUnits.filter((unit) => unit.isDefault);
      if (markedDefaults.length > 1) {
        errors.allowedUnits = 'Selecione no máximo uma unidade padrão.';
      } else if (state.defaultUnitCode) {
        const selected = state.allowedUnits.find(
          (unit) => unit.unitCode === state.defaultUnitCode && unit.isDefault,
        );
        if (!selected) {
          errors.allowedUnits = 'A unidade padrão deve pertencer às unidades permitidas.';
        }
      } else if (markedDefaults.length > 0) {
        errors.allowedUnits = 'A unidade marcada como padrão deve coincidir com a unidade padrão.';
      }
    }
  }

  if (state.pricingModels.length === 0) {
    errors.pricingModels = 'Informe ao menos um modelo de preço.';
  } else if (
    new Set(state.pricingModels.map((model) => model.modelCode)).size !==
    state.pricingModels.length
  ) {
    errors.pricingModels = 'O mesmo modelo de preço não pode ser adicionado duas vezes.';
  }

  if (
    state.resourceRequirements.some(
      (item) => !Number.isInteger(item.minQuantity) || item.minQuantity < 1,
    ) ||
    new Set(state.resourceRequirements.map((item) => item.resourceTypeCode)).size !==
      state.resourceRequirements.length
  ) {
    errors.resourceRequirements =
      'Recursos físicos não podem repetir tipo e exigem quantidade mínima inteira de pelo menos 1.';
  }

  if (
    state.laborRequirements.some(
      (item) => !Number.isInteger(item.minQuantity) || item.minQuantity < 1,
    ) ||
    new Set(state.laborRequirements.map((item) => item.laborTypeCode)).size !==
      state.laborRequirements.length
  ) {
    errors.laborRequirements =
      'Mão de obra não pode repetir função e exige quantidade mínima inteira de pelo menos 1.';
  }

  const evidenceTypes = state.executionRequirements.map((item) => item.requirementType);
  if (new Set(evidenceTypes).size !== evidenceTypes.length) {
    errors.executionRequirements = 'O mesmo tipo de evidência não pode ser adicionado duas vezes.';
  } else {
    const invalidConditional = state.executionRequirements.some((item) => {
      if (item.requirementLevel !== 'CONDITIONAL') {
        return Boolean(item.config?.conditional);
      }
      const condition = item.config?.conditional;
      if (!condition?.conditionType) {
        return true;
      }
      if (condition.conditionType === 'WHEN_MEASUREMENT_BASIS_IS') {
        return !condition.measurementBasis;
      }
      if (condition.conditionType === 'WHEN_ARCHETYPE_IS') {
        return !condition.archetype;
      }
      if (condition.conditionType === 'WHEN_RESOURCE_TYPE_IS') {
        return !condition.resourceTypeCode;
      }
      if (condition.conditionType === 'WHEN_LABOR_TYPE_IS') {
        return !condition.laborTypeCode;
      }
      return true;
    });
    if (invalidConditional) {
      errors.executionRequirements =
        'Evidência condicional exige uma condição válida e o respectivo valor.';
    }
  }
  return errors;
}

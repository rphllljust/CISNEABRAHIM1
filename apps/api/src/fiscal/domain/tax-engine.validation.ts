import { assertCurrencyCode, isPositiveMoneyAmount, normalizeMoneyAmount } from '../../platform/kernel/money-math';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  optionalFiscalWhitelist,
  requireFiscalPage,
  requireFiscalPageSize,
} from './fiscal-document.validation';
import {
  TAX_CALCULATION_METHODS,
  TAX_ROUNDING_MODES,
  TAX_RULE_STATUSES,
  TaxEngineError,
  assertNotOfficialTaxLabel,
} from './tax-engine';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class TaxEngineValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const TAX_RULE_STATUS_FILTERS = new Set<string>(Object.values(TAX_RULE_STATUSES));

export type TaxRuleListQuery = {
  unitId: string;
  status?: string;
  page: number;
  pageSize: number;
};

/** Filtros da lista de regras tributarias; `unitId` obrigatorio (escopo de unidade). */
export function validateTaxRuleListQuery(
  input: Omit<TaxRuleListQuery, 'page' | 'pageSize'> & { page?: unknown; pageSize?: unknown },
): TaxRuleListQuery {
  const unitId = input.unitId?.trim() ?? '';
  if (unitId === '') {
    throw new TaxEngineValidationError('unitId');
  }
  return {
    unitId,
    status: optionalFiscalWhitelist(input.status, TAX_RULE_STATUS_FILTERS, 'status'),
    page: requireFiscalPage(input.page, 'page'),
    pageSize: requireFiscalPageSize(input.pageSize, 'pageSize'),
  };
}

export type CreateTaxRuleInput = {
  unitId: string;
  code: string;
  name: string;
};

export type CreateTaxRuleVersionInput = {
  calculationMethod: string;
  roundingMode?: string;
  rate?: string | null;
  fixedAmount?: string | null;
  sourceReference: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  specification?: Record<string, unknown>;
};

export type CalculateTaxInput = {
  unitId: string;
  ruleVersionId?: string;
  ruleCode?: string;
  currencyCode: string;
  baseAmount: string;
  effectiveOn: string;
  attributes?: Record<string, unknown>;
  idempotencyKey: string;
  sourceKind?: string | null;
  sourceId?: string | null;
};

function requiredText(value: unknown, _field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TaxEngineValidationError('TAX_VALIDATION_FAILED');
  }
  return value.trim();
}

function requiredDate(value: unknown, field: string): string {
  const date = requiredText(value, field);
  if (!DATE_PATTERN.test(date)) {
    throw new TaxEngineValidationError('TAX_INVALID_CONTEXT');
  }
  return date;
}

export function validateCreateTaxRuleInput(input: CreateTaxRuleInput): CreateTaxRuleInput {
  const unitId = requiredText(input.unitId, 'unitId');
  const code = requiredText(input.code, 'code');
  const name = requiredText(input.name, 'name');
  assertNotOfficialTaxLabel(code);
  assertNotOfficialTaxLabel(name);
  return { unitId, code, name };
}

export function validateCreateTaxRuleVersionInput(
  input: CreateTaxRuleVersionInput,
): CreateTaxRuleVersionInput {
  const calculationMethod = requiredText(input.calculationMethod, 'calculationMethod');
  if (
    calculationMethod !== TAX_CALCULATION_METHODS.PercentOfBase &&
    calculationMethod !== TAX_CALCULATION_METHODS.FixedAmount
  ) {
    throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
  }
  const roundingMode = (input.roundingMode ?? TAX_ROUNDING_MODES.HalfUp).trim();
  if (roundingMode !== TAX_ROUNDING_MODES.HalfUp) {
    throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
  }
  const sourceReference = requiredText(input.sourceReference, 'sourceReference');
  const effectiveFrom = requiredDate(input.effectiveFrom, 'effectiveFrom');
  const effectiveTo =
    input.effectiveTo === undefined || input.effectiveTo === null || input.effectiveTo === ''
      ? null
      : requiredDate(input.effectiveTo, 'effectiveTo');
  if (effectiveTo !== null && effectiveTo < effectiveFrom) {
    throw new TaxEngineValidationError('TAX_INVALID_CONTEXT');
  }

  if (calculationMethod === TAX_CALCULATION_METHODS.PercentOfBase) {
    if (input.rate === undefined || input.rate === null || !isPositiveMoneyAmount(input.rate)) {
      throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
    }
    return {
      calculationMethod,
      roundingMode,
      rate: normalizeMoneyAmount(input.rate),
      fixedAmount: null,
      sourceReference,
      effectiveFrom,
      effectiveTo,
      specification: input.specification ?? {},
    };
  }

  if (input.fixedAmount === undefined || input.fixedAmount === null || !isPositiveMoneyAmount(input.fixedAmount)) {
    throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
  }
  return {
    calculationMethod,
    roundingMode,
    rate: null,
    fixedAmount: normalizeMoneyAmount(input.fixedAmount),
    sourceReference,
    effectiveFrom,
    effectiveTo,
    specification: input.specification ?? {},
  };
}

export function validateCalculateTaxInput(input: CalculateTaxInput): CalculateTaxInput {
  const unitId = requiredText(input.unitId, 'unitId');
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
  let currencyCode: string;
  try {
    currencyCode = assertCurrencyCode(input.currencyCode);
  } catch {
    throw new TaxEngineError('TAX_INVALID_CONTEXT');
  }
  if (input.baseAmount === undefined || input.baseAmount === null || !isPositiveMoneyAmount(String(input.baseAmount))) {
    throw new TaxEngineError('TAX_INVALID_CONTEXT');
  }
  const effectiveOn = requiredDate(input.effectiveOn, 'effectiveOn');
  const ruleVersionId =
    input.ruleVersionId === undefined || input.ruleVersionId === null || input.ruleVersionId === ''
      ? undefined
      : assertUuid(input.ruleVersionId, 'ruleVersionId');
  const ruleCode =
    input.ruleCode === undefined || input.ruleCode === null || input.ruleCode === ''
      ? undefined
      : requiredText(input.ruleCode, 'ruleCode');
  if (!ruleVersionId && !ruleCode) {
    throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
  }
  if (ruleCode) {
    assertNotOfficialTaxLabel(ruleCode);
  }
  const sourceId =
    input.sourceId === undefined || input.sourceId === null || input.sourceId === ''
      ? null
      : assertUuid(input.sourceId, 'sourceId');
  return {
    unitId,
    ruleVersionId,
    ruleCode,
    currencyCode,
    baseAmount: normalizeMoneyAmount(String(input.baseAmount)),
    effectiveOn,
    attributes: input.attributes ?? {},
    idempotencyKey,
    sourceKind: input.sourceKind ?? null,
    sourceId,
  };
}

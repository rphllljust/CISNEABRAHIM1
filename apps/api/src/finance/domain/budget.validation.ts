import { assertCurrencyCode, normalizeMoneyAmount } from '../../platform/kernel/money-math';
import { BudgetError, assertBudgetLineHasDimension, assertBudgetPeriodKey } from './budget';

export type CreateBudgetInput = {
  unitId: string;
  code: string;
  name: string;
  currencyCode: string;
};

export type CreateBudgetPeriodInput = {
  periodKey: string;
  startsOn: string;
  endsOn: string;
};

export type CreateBudgetLineInput = {
  periodId: string;
  amount: string;
  costCenterCode?: string | null;
  expenseCategoryId?: string | null;
  accountId?: string | null;
};

export type ApproveBudgetInput = {
  version: number;
};

/**
 * Precondicao de versao da aprovacao.
 *
 * O aprovador devolve o `version_number` da versao que tinha na tela. Ausente ou invalido
 * e RECUSADO — nao existe aprovacao "sem versao": aceitar a ausencia reintroduziria
 * exatamente o defeito que esta correcao fecha (aprovar estado velho).
 */
export function validateApproveBudgetInput(input: unknown): ApproveBudgetInput {
  const raw = (input ?? {}) as { version?: unknown };
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BudgetError('BUDGET_VERSION_REQUIRED');
  }
  return { version };
}

function requireNonEmpty(value: string | undefined | null, code: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new BudgetError(code);
  }
  return trimmed;
}

function requireDate(value: string | undefined | null): string {
  const day = requireNonEmpty(value, 'BUDGET_PERIOD_INVALID').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BudgetError('BUDGET_PERIOD_INVALID');
  }
  return day;
}

export function validateCreateBudgetInput(input: CreateBudgetInput): CreateBudgetInput {
  return {
    unitId: requireNonEmpty(input.unitId, 'BUDGET_INVALID'),
    code: requireNonEmpty(input.code, 'BUDGET_INVALID'),
    name: requireNonEmpty(input.name, 'BUDGET_INVALID'),
    currencyCode: assertCurrencyCode(input.currencyCode),
  };
}

export function validateCreateBudgetPeriodInput(input: CreateBudgetPeriodInput): CreateBudgetPeriodInput {
  const periodKey = assertBudgetPeriodKey(input.periodKey);
  const startsOn = requireDate(input.startsOn);
  const endsOn = requireDate(input.endsOn);
  if (startsOn > endsOn) {
    throw new BudgetError('BUDGET_PERIOD_INVALID');
  }
  return { periodKey, startsOn, endsOn };
}

export function validateCreateBudgetLineInput(input: CreateBudgetLineInput): CreateBudgetLineInput {
  const costCenterCode = input.costCenterCode?.trim() || null;
  const expenseCategoryId = input.expenseCategoryId?.trim() || null;
  const accountId = input.accountId?.trim() || null;
  assertBudgetLineHasDimension({ costCenterCode, expenseCategoryId, accountId });
  return {
    periodId: requireNonEmpty(input.periodId, 'BUDGET_INVALID'),
    amount: normalizeMoneyAmount(requireNonEmpty(input.amount, 'BUDGET_INVALID')),
    costCenterCode,
    expenseCategoryId,
    accountId,
  };
}

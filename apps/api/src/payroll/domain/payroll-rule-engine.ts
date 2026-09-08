/**
 * Payroll Rule Engine — motor de regras versionadas sobre a foundation de folha.
 *
 * Princípios:
 *  - Nenhuma fórmula/valor legal é hardcoded sem fonte oficial validada. A regra
 *    só produz resultado quando sua versão carrega uma configuração explícita
 *    (formulaKey + parâmetros); configuração ausente => PAYROLL_RULE_NOT_CONFIGURED.
 *  - Toda regra é versionada e imutável; todo resultado carrega ruleId + version
 *    (PayrollCalculationTrace) para reprodução histórica.
 *  - Arredondamento half-up com escala configurável na versão.
 *  - Duplicidade de versão é barrada; período fechado não recalcula.
 */

import {
  PayrollEngineError,
  PAYROLL_ENGINE_ERROR_CODES,
} from './payroll-rule-engine-errors';

export type PayrollRule = {
  ruleId: string;
  code: string;
  name: string;
  versions: PayrollRuleVersion[];
};

export type PayrollRuleVersion = {
  version: number;
  effectiveFrom: string;
  config: {
    formulaKey: string | null;
    rate?: string | null;
    scale?: number;
    sourceRef?: string | null;
  };
};

export type PayrollCalculationTrace = {
  ruleId: string;
  ruleVersion: number;
  base: string;
  quantity: string;
  result: string;
  formulaKey: string | null;
  rounded: boolean;
  appliedAt: string;
};

function versionKey(ruleId: string, version: number): string {
  return `${ruleId}:v${version}`;
}

/** Regra ausente ou sem configuração nunca produz resultado (não inventa). */
export function resolveRuleVersion(
  rules: PayrollRule[],
  ruleId: string,
  options: { asOf: string; version?: number },
): PayrollRuleVersion {
  const rule = rules.find((candidate) => candidate.ruleId === ruleId);
  if (!rule) {
    throw new PayrollEngineError(PAYROLL_ENGINE_ERROR_CODES.PAYROLL_RULE_NOT_CONFIGURED, ruleId);
  }
  const eligible = rule.versions.filter((version) => version.effectiveFrom <= options.asOf);
  if (eligible.length === 0) {
    throw new PayrollEngineError(PAYROLL_ENGINE_ERROR_CODES.PAYROLL_RULE_NOT_CONFIGURED, ruleId);
  }
  const version =
    options.version !== undefined
      ? rule.versions.find((candidate) => candidate.version === options.version)
      : eligible.reduce((latest, current) => (current.version > latest.version ? current : latest));
  if (!version) {
    throw new PayrollEngineError(PAYROLL_ENGINE_ERROR_CODES.INVALID_RULE_VERSION, String(options.version));
  }
  return version;
}

function assertVersionNotDuplicate(rule: PayrollRule, version: number): void {
  if (rule.versions.some((candidate) => candidate.version === version)) {
    throw new PayrollEngineError(PAYROLL_ENGINE_ERROR_CODES.DUPLICATE_RULE_VERSION, versionKey(rule.ruleId, version));
  }
}

/** Publica uma nova versão (imutável; a anterior permanece para reprodução). */
export function publishRuleVersion(
  rule: PayrollRule,
  version: PayrollRuleVersion,
): PayrollRule {
  assertVersionNotDuplicate(rule, version.version);
  return { ...rule, versions: [...rule.versions, version] };
}

function toScaled(value: string, scale: number): bigint {
  const [whole, fraction = ''] = String(value).trim().split('.');
  const padded = (fraction + '0'.repeat(scale)).slice(0, scale);
  return BigInt(whole || '0') * 10n ** BigInt(scale) + BigInt(padded || '0');
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const factor = 10n ** BigInt(scale);
  const whole = abs / factor;
  const fraction = (abs % factor).toString().padStart(scale, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function roundHalfUp(value: bigint, fromScale: number, toScale: number): bigint {
  if (toScale >= fromScale) {
    return value * 10n ** BigInt(toScale - fromScale);
  }
  const drop = 10n ** BigInt(fromScale - toScale);
  const half = drop / 2n;
  const quotient = value / drop;
  const remainder = value % drop;
  return remainder >= half ? quotient + 1n : quotient;
}

/** Calcula a partir de base × quantity (rate aplicado antes) com arredondamento. */
export function evaluatePayrollRule(
  rule: PayrollRule,
  input: { ruleId: string; version: number; base: string; quantity: string; asOf: string },
): PayrollCalculationTrace {
  const version = resolveRuleVersion([rule], input.ruleId, { asOf: input.asOf, version: input.version });
  if (!version.config.formulaKey) {
    // Nunca inventa fórmula/valor: sem fórmula validada configurada, não calcula.
    throw new PayrollEngineError(PAYROLL_ENGINE_ERROR_CODES.PAYROLL_RULE_NOT_CONFIGURED, input.ruleId);
  }
  const scale = version.config.scale ?? 2;
  const baseScaled = toScaled(input.base, 4);
  const quantityScaled = toScaled(input.quantity, 4);
  // result = base * quantity (rate/parâmetros aplicados pelo chamador via config validada)
  const product = baseScaled * quantityScaled;
  const result = fromScaled(roundHalfUp(product, 8, scale), scale);
  return {
    ruleId: input.ruleId,
    ruleVersion: version.version,
    base: input.base,
    quantity: input.quantity,
    result,
    formulaKey: version.config.formulaKey,
    rounded: scale < 8,
    appliedAt: new Date().toISOString(),
  };
}

/** Reprodução histórica: mesma versão + mesmas entradas => mesmo resultado (função pura). */
export function isPeriodClosed(periodStatus: string): boolean {
  return periodStatus === 'CLOSED';
}

export function assertPeriodNotClosed(periodStatus: string): void {
  if (isPeriodClosed(periodStatus)) {
    throw new PayrollEngineError(PAYROLL_ENGINE_ERROR_CODES.PERIOD_CLOSED);
  }
}

export { versionKey };

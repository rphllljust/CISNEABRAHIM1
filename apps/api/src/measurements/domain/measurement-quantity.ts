import { assertQuantityDecimalScale } from '../../catalog/domain/measured-quantity';
import { multiplyDecimalStrings } from '../../platform/kernel/decimal-math';
import { MeasurementError } from './measurement';

export const MEASURED_QUANTITY_SCALE = 6;

const MEASURED_QUANTITY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

export function normalizeMeasuredQuantity(value: string): string {
  const trimmed = value.trim();
  if (!MEASURED_QUANTITY_PATTERN.test(trimmed)) {
    throw new MeasurementError('INVALID_MEASURED_QUANTITY');
  }
  if (!trimmed.includes('.')) {
    return trimmed;
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction.length > 0 ? `${whole}.${normalizedFraction}` : whole!;
}

export function parseMeasuredQuantityDecimal(value: string): number {
  const normalized = normalizeMeasuredQuantity(value);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new MeasurementError('INVALID_MEASURED_QUANTITY');
  }
  return parsed;
}

export function assertMeasuredQuantityScale(value: string, decimalScale: number): void {
  const parsed = parseMeasuredQuantityDecimal(value);
  try {
    assertQuantityDecimalScale(parsed, decimalScale);
  } catch {
    throw new MeasurementError('QUANTITY_PRECISION_EXCEEDED');
  }
}

export function compareMeasuredQuantities(left: string, right: string): number {
  const l = parseMeasuredQuantityDecimal(left);
  const r = parseMeasuredQuantityDecimal(right);
  if (l < r) {
    return -1;
  }
  if (l > r) {
    return 1;
  }
  return 0;
}

export function addMeasuredQuantities(...values: string[]): string {
  let sum = 0;
  for (const value of values) {
    sum += parseMeasuredQuantityDecimal(normalizeMeasuredQuantity(value));
  }
  return normalizeMeasuredQuantity(sum.toFixed(MEASURED_QUANTITY_SCALE));
}

export function subtractMeasuredQuantities(minuend: string, subtrahend: string): string {
  const result =
    parseMeasuredQuantityDecimal(minuend) - parseMeasuredQuantityDecimal(subtrahend);
  if (result < 0) {
    throw new MeasurementError('INVALID_MEASURED_QUANTITY');
  }
  return normalizeMeasuredQuantity(result.toFixed(MEASURED_QUANTITY_SCALE));
}

export function assertMeasuredQuantityWithinAuthorizedBounds(input: {
  actualQuantity: string;
  measuredQuantity: string;
  authorizedAdjustmentTotal: string;
}): void {
  const maxAllowed = addMeasuredQuantities(input.actualQuantity, input.authorizedAdjustmentTotal);
  if (compareMeasuredQuantities(input.measuredQuantity, maxAllowed) > 0) {
    throw new MeasurementError('MEASUREMENT_DIVERGENCE_NOT_AUTHORIZED');
  }
}

export function computeLineAmount(input: {
  modelCode: string;
  measuredQuantity: string;
  unitPrice: string | null;
  salePrice: string | null;
}): string | null {
  if (
    input.modelCode === 'GLOBAL_PRICE' ||
    input.modelCode === 'FIXED' ||
    input.modelCode === 'NEGOTIATED_PO_PRICE' ||
    input.modelCode === 'HEADER_TOTAL'
  ) {
    return input.salePrice;
  }
  if (!input.unitPrice) {
    return null;
  }
  // Aritmética decimal exata (BigInt): quantidade (até 6 casas) × preço, arredondado half-up a 4 casas.
  return multiplyDecimalStrings(
    normalizeMeasuredQuantity(input.measuredQuantity),
    input.unitPrice,
    4,
  );
}

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

type ScaledDecimal = { negative: boolean; digits: bigint; scale: number };

function parseDecimal(value: string): ScaledDecimal | null {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const fraction = match[3] ?? '';
  return {
    negative: match[1] === '-',
    digits: BigInt(`${match[2]}${fraction}`),
    scale: fraction.length,
  };
}

/**
 * Multiplicação decimal EXATA entre duas strings, arredondada half-up (afastando do zero)
 * para `resultScale` casas. Usa BigInt: sem ponto flutuante, sem erro binário.
 *
 * Devolve `null` se algum operando não for um decimal válido (`-?\d+(\.\d+)?`).
 * O resultado tem sempre exatamente `resultScale` casas (ex.: "11616.6183").
 */
export function multiplyDecimalStrings(
  left: string,
  right: string,
  resultScale: number,
): string | null {
  if (!Number.isInteger(resultScale) || resultScale < 0) {
    throw new RangeError('resultScale must be a non-negative integer');
  }
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (!a || !b) {
    return null;
  }

  const product = a.digits * b.digits; // escala a.scale + b.scale
  const productScale = a.scale + b.scale;
  let scaled: bigint;
  if (productScale <= resultScale) {
    scaled = product * 10n ** BigInt(resultScale - productScale);
  } else {
    const divisor = 10n ** BigInt(productScale - resultScale);
    scaled = product / divisor;
    if (product % divisor >= divisor / 2n) {
      scaled += 1n;
    }
  }

  const text = scaled.toString().padStart(resultScale + 1, '0');
  const whole = text.slice(0, text.length - resultScale);
  const fraction = text.slice(text.length - resultScale);
  const body = resultScale > 0 ? `${whole}.${fraction}` : whole;
  const isZero = scaled === 0n;
  return a.negative !== b.negative && !isZero ? `-${body}` : body;
}

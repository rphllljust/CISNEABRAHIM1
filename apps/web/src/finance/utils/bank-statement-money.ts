/**
 * Absolute display-only difference of two persisted NUMERIC(18,4) money amounts.
 * Never convert monetary values to JS Number: 0.0001 must not be rounded away.
 * Invalid input has no trustworthy difference and is rendered as unavailable.
 */
const MONEY = /^(-?)(\d{1,14})(?:\.(\d{1,4}))?$/;

function units(value: string): bigint | null {
  const match = MONEY.exec(value.trim());
  if (!match) return null;
  const integer = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? '').padEnd(4, '0'));
  const amount = integer * 10_000n + fraction;
  return match[1] === '-' ? -amount : amount;
}

export function bankStatementAbsoluteDifference(bankAmount: string, systemAmount: string): string | null {
  const bank = units(bankAmount);
  const system = units(systemAmount);
  if (bank === null || system === null) return null;
  const difference = bank >= system ? bank - system : system - bank;
  return `${difference / 10_000n}.${String(difference % 10_000n).padStart(4, '0')}`;
}
